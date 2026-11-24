// Dashboard accounts: people who look at the dashboard (not the developers' daemons).
//   admin    everything, including brain providers, developer tokens and accounts
//   manager  a project's content: task board, charter, members, conflicts, layers, messages
//   viewer   read only
// A share link is a read-only viewer limited to one project, for showing the project to others.

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Db } from "../../shared/db.ts";
import { newId, nowIso } from "../../shared/util.ts";

export type Role = "admin" | "manager" | "viewer";
export const ROLES: Role[] = ["admin", "manager", "viewer"];
export const ROLE_RANK: Record<Role, number> = { viewer: 0, manager: 1, admin: 2 };

/** Who is calling the dashboard API. */
export interface Principal {
  kind: "admin_token" | "user" | "share" | "open";
  name: string;
  role: Role;
  /** Share links only see this project. */
  project?: string;
}

const SESSION_DAYS = 14;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`;
}

function checkPassword(password: string, stored: string): boolean {
  const [, salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const got = scryptSync(password, Buffer.from(salt, "hex"), 32);
  const want = Buffer.from(expected, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

export interface UserRow {
  name: string;
  role: Role;
  created_at: string;
  last_login: string | null;
}

export interface ShareLinkRow {
  id: string;
  project: string;
  label: string | null;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
  last_used: string | null;
}

export class Accounts {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }

  // ---- users -----------------------------------------------------------------------

  hasUsers(): boolean {
    return (this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM users`)?.n ?? 0) > 0;
  }

  users(): UserRow[] {
    return this.db.all<UserRow>(`SELECT name, role, created_at, last_login FROM users ORDER BY name`);
  }

  /** Create a user, or change an existing user's role and/or password. */
  saveUser(name: string, input: { role?: Role; password?: string }): UserRow {
    if (!/^[a-zA-Z0-9._@-]{1,60}$/.test(name)) throw new Error("user name: letters, digits, . _ @ -");
    if (input.role && !ROLES.includes(input.role)) throw new Error(`role must be one of ${ROLES.join(", ")}`);
    if (input.password !== undefined && input.password.length < 8) throw new Error("password: at least 8 characters");
    const prev = this.db.get<{ role: Role; pass_hash: string; created_at: string; last_login: string | null }>(`SELECT * FROM users WHERE name = ?`, name);
    if (!prev && !input.password) throw new Error("a new user needs a password");
    const row = {
      name,
      role: input.role ?? prev?.role ?? "viewer",
      pass_hash: input.password ? hashPassword(input.password) : prev!.pass_hash,
      created_at: prev?.created_at ?? nowIso(),
      last_login: prev?.last_login ?? null,
    };
    this.db.upsert("users", row);
    // A new password or a lower role logs the user out everywhere.
    if (prev && (input.password || row.role !== prev.role)) this.db.run(`DELETE FROM user_sessions WHERE user = ?`, name);
    return { name, role: row.role, created_at: row.created_at, last_login: row.last_login };
  }

  removeUser(name: string): void {
    this.db.run(`DELETE FROM users WHERE name = ?`, name);
    this.db.run(`DELETE FROM user_sessions WHERE user = ?`, name);
  }

  /** Name + password → a session token (shown once, sent as Bearer). */
  login(name: string, password: string): { token: string; user: UserRow; expires_at: string } {
    const row = this.db.get<{ name: string; role: Role; pass_hash: string; created_at: string }>(`SELECT * FROM users WHERE name = ?`, name);
    if (!row || !checkPassword(password, row.pass_hash)) throw new Error("wrong user name or password");
    const token = `gtvs_${randomBytes(24).toString("base64url")}`;
    const now = nowIso();
    const expires_at = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
    this.db.run(`DELETE FROM user_sessions WHERE expires_at < ?`, now);
    this.db.run(`INSERT INTO user_sessions (token_hash, user, expires_at, created_at) VALUES (?,?,?,?)`, hash(token), name, expires_at, now);
    this.db.run(`UPDATE users SET last_login = ? WHERE name = ?`, now, name);
    return { token, expires_at, user: { name, role: row.role, created_at: row.created_at, last_login: now } };
  }

  logout(token: string): void {
    this.db.run(`DELETE FROM user_sessions WHERE token_hash = ?`, hash(token));
  }

  // ---- share links -----------------------------------------------------------------------

  shareLinks(project?: string): ShareLinkRow[] {
    return project
      ? this.db.all<ShareLinkRow>(
          `SELECT id, project, label, created_by, created_at, expires_at, last_used FROM share_links WHERE project = ? ORDER BY created_at DESC`,
          project,
        )
      : this.db.all<ShareLinkRow>(`SELECT id, project, label, created_by, created_at, expires_at, last_used FROM share_links ORDER BY created_at DESC`);
  }

  /** A read-only link for one project. The code is returned once. */
  createShareLink(project: string, opts: { label?: string; days?: number; by?: string }): ShareLinkRow & { code: string } {
    const code = `gtvl_${randomBytes(18).toString("base64url")}`;
    const row: ShareLinkRow = {
      id: newId("share"),
      project,
      label: opts.label?.trim() || null,
      created_by: opts.by ?? null,
      created_at: nowIso(),
      expires_at: opts.days ? new Date(Date.now() + opts.days * 86_400_000).toISOString() : null,
      last_used: null,
    };
    this.db.upsert("share_links", { ...row, code_hash: hash(code) });
    return { ...row, code };
  }

  revokeShareLink(id: string): void {
    this.db.run(`DELETE FROM share_links WHERE id = ?`, id);
  }

  // ---- token → principal ---------------------------------------------------------------

  /** Resolves a user session or share-link token; undefined for anything else. */
  principal(token: string): Principal | undefined {
    const now = nowIso();
    if (token.startsWith("gtvs_")) {
      const row = this.db.get<{ name: string; role: Role }>(
        `SELECT u.name, u.role FROM user_sessions s JOIN users u ON u.name = s.user WHERE s.token_hash = ? AND s.expires_at > ?`,
        hash(token),
        now,
      );
      return row ? { kind: "user", name: row.name, role: row.role } : undefined;
    }
    if (token.startsWith("gtvl_")) {
      const row = this.db.get<{ id: string; project: string; label: string | null }>(
        `SELECT id, project, label FROM share_links WHERE code_hash = ? AND (expires_at IS NULL OR expires_at > ?)`,
        hash(token),
        now,
      );
      if (!row) return undefined;
      this.db.run(`UPDATE share_links SET last_used = ? WHERE id = ?`, now, row.id);
      return { kind: "share", name: row.label ? `link: ${row.label}` : "share link", role: "viewer", project: row.project };
    }
    return undefined;
  }
}
