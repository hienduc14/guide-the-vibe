// LLM credentials entered on the dashboard, kept in hub.db and handed to Pi through its CredentialStore
// interface, so Pi resolves auth (stored key first, then the provider's env vars) as it does on its own.
// Secrets are sealed with AES-256-GCM under GTV_SECRET_KEY; without that key they are stored as plain
// JSON (the dashboard warns). The API never returns a secret, only a hint like "…a1b2".

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import type { Db } from "../../shared/db.ts";
import { log, nowIso } from "../../shared/util.ts";

export class Sealer {
  private readonly key?: Buffer;

  constructor(secret?: string) {
    if (secret) this.key = createHash("sha256").update(secret).digest();
  }

  get encrypted(): boolean {
    return !!this.key;
  }

  seal(plain: string): string {
    if (!this.key) return `plain:${plain}`;
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return `v1:${Buffer.concat([iv, c.getAuthTag(), body]).toString("base64")}`;
  }

  /** undefined when the value was sealed with another key (or the key is missing). */
  open(sealed: string): string | undefined {
    if (sealed.startsWith("plain:")) return sealed.slice(6);
    if (!sealed.startsWith("v1:") || !this.key) return undefined;
    const raw = Buffer.from(sealed.slice(3), "base64");
    try {
      const d = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
      d.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
    } catch {
      return undefined;
    }
  }
}

/** "…a1b2" — enough to tell keys apart, never enough to use one. */
export function keyHint(key: string | undefined): string | undefined {
  return key ? `…${key.slice(-4)}` : undefined;
}

export class DbCredentialStore implements CredentialStore {
  private readonly db: Db;
  private readonly sealer: Sealer;
  private locks = new Map<string, Promise<unknown>>();

  constructor(db: Db, sealer: Sealer) {
    this.db = db;
    this.sealer = sealer;
  }

  async read(providerId: string): Promise<Credential | undefined> {
    const row = this.db.get<{ data: string }>(`SELECT data FROM brain_credentials WHERE provider = ?`, providerId);
    if (!row) return undefined;
    const plain = this.sealer.open(row.data);
    if (plain === undefined) {
      log("brain", `credential for ${providerId} cannot be decrypted (GTV_SECRET_KEY changed or missing); enter it again`);
      return undefined;
    }
    return JSON.parse(plain) as Credential;
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return this.db
      .all<{ provider: string; type: Credential["type"] }>(`SELECT provider, type FROM brain_credentials`)
      .map((r) => ({ providerId: r.provider, type: r.type }));
  }

  /** Writes for one provider run one at a time (Pi refreshes OAuth tokens inside `fn`). */
  modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined> {
    const prev = this.locks.get(providerId) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        const updated = await fn(await this.read(providerId));
        if (updated) {
          this.db.run(
            `INSERT OR REPLACE INTO brain_credentials (provider, type, data, updated_at) VALUES (?,?,?,?)`,
            providerId,
            updated.type,
            this.sealer.seal(JSON.stringify(updated)),
            nowIso(),
          );
        }
        return updated ?? (await this.read(providerId));
      });
    this.locks.set(providerId, next);
    return next;
  }

  async delete(providerId: string): Promise<void> {
    await this.modify(providerId, async () => undefined).catch(() => undefined);
    this.db.run(`DELETE FROM brain_credentials WHERE provider = ?`, providerId);
  }
}
