// Accounts: one per person. An account logs in to the dashboard (password, session gtvs_…) and is the identity of
// that person's agents through the computers they connected (device key gtvd_…, or an old gtv_ token moved here).
//   system role: admin (everything) | member (what their project access allows, see hub.projectAccess)
// Admins create accounts and send a one-time activation link; people set their own password.
// A share link (gtvl_…) is a read-only viewer limited to one project, for showing the project to others.

import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import type { Db } from "../../shared/db.ts";
import { newId, nowIso } from "../../shared/util.ts";

export type Role = "admin" | "member";
export const ROLES: Role[] = ["admin", "member"];

/** Who is calling. */
export interface Principal {
  kind: "user" | "device" | "admin_token" | "share" | "open";
  name: string;
  role: Role;
  /** Share links only see this project. */
  project?: string;
  /** Device principals: which computer. */
  device?: string;
}

const SESSION_DAYS = 14;
const ACTIVATION_HOURS = 48;
const CONNECT_MINUTES = 10;
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const future = (ms: number) => new Date(Date.now() + ms).toISOString();

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`;
}

function checkPassword(password: string, stored: string | null): boolean {
  const [, salt, expected] = (stored ?? "").split(":");
  if (!salt || !expected) return false;
  const got = scryptSync(password, Buffer.from(salt, "hex"), 32);
  const want = Buffer.from(expected, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Account names appear in every project record (tasks, footprints, conflicts), so they follow the dev name rule. */
export function checkName(name: string): void {
  if (!/^[a-zA-Z0-9._-]{1,40}$/.test(name)) throw new Error("name: 1-40 letters, digits, . _ -");
}

function checkPasswordRule(password: string): void {
  if (typeof password !== "string" || password.length < 8) throw new Error("password: at least 8 characters");
}

/** KQ7M-2XPD: no 0/O/1/I, so it can be read aloud and typed. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function userCode(): string {
  const c = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

export interface UserRow {
  name: string;
  role: Role;
  activated: boolean;
  created_at: string;
  created_by: string | null;
  last_login: string | null;
}

export interface DeviceRow {
  id: string;
  user: string;
  name: string;
  platform: string;
  created_at: string;
  last_seen: string | null;
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

interface ConnectRow {
  id: string;
  user_code: string;
  device_name: string;
  platform: string;
  status: "pending" | "approved" | "denied";
  user: string | null;
  token: string | null;
  expires_at: string;
  created_at: string;
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

  user(name: string): UserRow | undefined {
    return this.users().find((u) => u.name === name);
  }

  users(): UserRow[] {
    return this.db
      .all<Omit<UserRow, "activated"> & { activated: number }>(
        `SELECT name, role, pass_hash IS NOT NULL AS activated, created_at, created_by, last_login FROM users ORDER BY name`,
      )
      .map((u) => ({ ...u, activated: !!u.activated }));
  }

  /** A new account without a password: the person sets one through the activation link. */
  createUser(name: string, role: Role, by: string | null): UserRow {
    checkName(name);
    if (!ROLES.includes(role)) throw new Error(`role must be one of ${ROLES.join(", ")}`);
    if (this.user(name)) throw new Error(`an account named ${name} already exists`);
    this.db.run(`INSERT INTO users (name, role, pass_hash, created_at, created_by) VALUES (?,?,NULL,?,?)`, name, role, nowIso(), by);
    return this.user(name)!;
  }

  setRole(name: string, role: Role): UserRow {
    if (!ROLES.includes(role)) throw new Error(`role must be one of ${ROLES.join(", ")}`);
    const prev = this.user(name);
    if (!prev) throw new Error(`unknown account ${name}`);
    this.db.run(`UPDATE users SET role = ? WHERE name = ?`, role, name);
    // A lower role logs the person out everywhere (their computers keep working: project access decides there).
    if (prev.role === "admin" && role !== "admin") this.db.run(`DELETE FROM user_sessions WHERE user = ?`, name);
    return this.user(name)!;
  }

  /** Sets a password directly (scripts, the demo); people use activation links or changePassword. */
  setPassword(name: string, password: string): void {
    checkPasswordRule(password);
    if (!this.user(name)) throw new Error(`unknown account ${name}`);
    this.db.run(`UPDATE users SET pass_hash = ? WHERE name = ?`, hashPassword(password), name);
    this.db.run(`DELETE FROM user_sessions WHERE user = ?`, name);
  }

  changePassword(name: string, current: string, password: string): void {
    const row = this.db.get<{ pass_hash: string | null }>(`SELECT pass_hash FROM users WHERE name = ?`, name);
    if (!row || !checkPassword(current, row.pass_hash)) throw new Error("the current password is wrong");
    this.setPassword(name, password);
  }

  removeUser(name: string): void {
    this.db.run(`DELETE FROM users WHERE name = ?`, name);
    for (const t of ["user_sessions", "devices", "activations", "device_requests"]) this.db.run(`DELETE FROM ${t} WHERE user = ?`, name);
  }

  /** Name + password → a session token (shown once, sent as Bearer). */
  login(name: string, password: string): { token: string; user: UserRow; expires_at: string } {
    const row = this.db.get<{ pass_hash: string | null }>(`SELECT pass_hash FROM users WHERE name = ?`, name);
    if (row && row.pass_hash === null) throw new Error("this account is not activated yet: open the link your admin sent you");
    if (!row || !checkPassword(password, row.pass_hash)) throw new Error("wrong user name or password");
    return this.session(name);
  }

  private session(name: string): { token: string; user: UserRow; expires_at: string } {
    const token = `gtvs_${randomBytes(24).toString("base64url")}`;
    const now = nowIso();
    const expires_at = future(SESSION_DAYS * 86_400_000);
    this.db.run(`DELETE FROM user_sessions WHERE expires_at < ?`, now);
    this.db.run(`INSERT INTO user_sessions (token_hash, user, expires_at, created_at) VALUES (?,?,?,?)`, hashToken(token), name, expires_at, now);
    this.db.run(`UPDATE users SET last_login = ? WHERE name = ?`, now, name);
    return { token, expires_at, user: this.user(name)! };
  }

  logout(token: string): void {
    this.db.run(`DELETE FROM user_sessions WHERE token_hash = ?`, hashToken(token));
  }

  // ---- activation links (first password, or a reset) ------------------------------------------

  /** A new one-time code for the account; earlier codes stop working. */
  createActivation(name: string): { code: string; expires_at: string } {
    if (!this.user(name)) throw new Error(`unknown account ${name}`);
    const code = randomBytes(24).toString("base64url");
    const expires_at = future(ACTIVATION_HOURS * 3600_000);
    this.db.run(`DELETE FROM activations WHERE user = ? OR expires_at < ?`, name, nowIso());
    this.db.run(`INSERT INTO activations (code_hash, user, expires_at, created_at) VALUES (?,?,?,?)`, hashToken(code), name, expires_at, nowIso());
    return { code, expires_at };
  }

  activationInfo(code: string): { user: string; kind: "activate" | "reset" } {
    const row = this.db.get<{ user: string; expires_at: string }>(`SELECT user, expires_at FROM activations WHERE code_hash = ?`, hashToken(code));
    const u = row && row.expires_at > nowIso() ? this.user(row.user) : undefined;
    if (!u) throw new Error("this link is invalid, used or expired: ask your admin for a new one");
    return { user: u.name, kind: u.activated ? "reset" : "activate" };
  }

  /** Sets the password and logs the person in. */
  activate(code: string, password: string): { token: string; user: UserRow; expires_at: string } {
    const { user } = this.activationInfo(code);
    checkPasswordRule(password);
    this.db.run(`DELETE FROM activations WHERE code_hash = ?`, hashToken(code));
    this.setPassword(user, password);
    return this.session(user);
  }

  // ---- devices (computers connected to an account) -----------------------------------------

  devices(user?: string): DeviceRow[] {
    const cols = `id, user, name, platform, created_at, last_seen`;
    return user
      ? this.db.all<DeviceRow>(`SELECT ${cols} FROM devices WHERE user = ? ORDER BY created_at`, user)
      : this.db.all<DeviceRow>(`SELECT ${cols} FROM devices ORDER BY created_at`);
  }

  /** Adds a computer with a known token (moved old developer tokens, GTV_TOKENS); no-op if the token is known. */
  addDevice(user: string, tokenHash: string, name: string, platform: string, createdAt = nowIso(), lastSeen: string | null = null): void {
    this.db.run(
      `INSERT OR IGNORE INTO devices (id, user, name, platform, token_hash, created_at, last_seen) VALUES (?,?,?,?,?,?,?)`,
      newId("dv"),
      user,
      name,
      platform,
      tokenHash,
      createdAt,
      lastSeen,
    );
  }

  removeDevice(id: string, user?: string): boolean {
    const before = this.devices().length;
    if (user) this.db.run(`DELETE FROM devices WHERE id = ? AND user = ?`, id, user);
    else this.db.run(`DELETE FROM devices WHERE id = ?`, id);
    return this.devices().length < before;
  }

  /** The computer a token belongs to (and marks it seen). */
  deviceFor(token: string): (DeviceRow & { role: Role }) | undefined {
    const row = this.db.get<DeviceRow & { role: Role }>(
      `SELECT d.id, d.user, d.name, d.platform, d.created_at, d.last_seen, u.role FROM devices d JOIN users u ON u.name = d.user WHERE d.token_hash = ?`,
      hashToken(token),
    );
    if (row) this.db.run(`UPDATE devices SET last_seen = ? WHERE id = ?`, nowIso(), row.id);
    return row;
  }

  // ---- connecting a computer (device flow: gtv login) ------------------------------------------

  startConnect(deviceName: string, platform: string): { device_code: string; user_code: string; expires_at: string } {
    const now = nowIso();
    this.db.run(`DELETE FROM device_requests WHERE expires_at < ?`, now);
    const device_code = randomBytes(32).toString("base64url");
    let code = userCode();
    while (this.db.get(`SELECT 1 FROM device_requests WHERE user_code = ?`, code)) code = userCode();
    const expires_at = future(CONNECT_MINUTES * 60_000);
    this.db.run(
      `INSERT INTO device_requests (id, device_code_hash, user_code, device_name, platform, status, expires_at, created_at) VALUES (?,?,?,?,?,'pending',?,?)`,
      newId("cr"),
      hashToken(device_code),
      code,
      String(deviceName || "computer").slice(0, 80),
      String(platform || "unknown").slice(0, 20),
      expires_at,
      now,
    );
    return { device_code, user_code: code, expires_at };
  }

  /** A waiting request by the code the person typed; undefined when unknown, decided or expired. */
  connectRequest(code: string): { device_name: string; platform: string; created_at: string } | undefined {
    const row = this.db.get<ConnectRow>(`SELECT * FROM device_requests WHERE user_code = ?`, code.trim().toUpperCase());
    if (!row || row.status !== "pending" || row.expires_at < nowIso()) return undefined;
    return { device_name: row.device_name, platform: row.platform, created_at: row.created_at };
  }

  /** Approve (creates the computer's key, kept until the CLI collects it) or deny a request. */
  decideConnect(code: string, user: string, approve: boolean): void {
    const req = this.connectRequest(code);
    if (!req) throw new Error("unknown or expired code: run gtv login again");
    const key = code.trim().toUpperCase();
    if (!approve) {
      this.db.run(`UPDATE device_requests SET status = 'denied', user = ? WHERE user_code = ?`, user, key);
      return;
    }
    const token = `gtvd_${randomBytes(24).toString("base64url")}`;
    this.addDevice(user, hashToken(token), req.device_name, req.platform);
    this.db.run(`UPDATE device_requests SET status = 'approved', user = ?, token = ? WHERE user_code = ?`, user, token, key);
  }

  /** What the CLI sees while it waits. The key is handed over once, then the request is gone. */
  pollConnect(deviceCode: string): { status: "pending" } | { status: "approved"; user: string; token: string; device_id: string } {
    const h = hashToken(String(deviceCode ?? ""));
    const row = this.db.get<ConnectRow>(`SELECT * FROM device_requests WHERE device_code_hash = ?`, h);
    if (!row) throw new Error("unknown or used code: run gtv login again");
    if (row.status === "denied") {
      this.db.run(`DELETE FROM device_requests WHERE id = ?`, row.id);
      throw new Error("the request was denied on the dashboard");
    }
    if (row.status === "approved" && row.token) {
      this.db.run(`DELETE FROM device_requests WHERE id = ?`, row.id);
      const dev = this.db.get<{ id: string }>(`SELECT id FROM devices WHERE token_hash = ?`, hashToken(row.token));
      return { status: "approved", user: row.user!, token: row.token, device_id: dev?.id ?? "" };
    }
    if (row.expires_at < nowIso()) {
      this.db.run(`DELETE FROM device_requests WHERE id = ?`, row.id);
      throw new Error("the code expired: run gtv login again");
    }
    return { status: "pending" };
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
      expires_at: opts.days ? future(opts.days * 86_400_000) : null,
      last_used: null,
    };
    this.db.upsert("share_links", { ...row, code_hash: hashToken(code) });
    return { ...row, code };
  }

  revokeShareLink(id: string): void {
    this.db.run(`DELETE FROM share_links WHERE id = ?`, id);
  }

  // ---- token → principal ---------------------------------------------------------------

  /** Resolves a session, share-link or computer token; undefined for anything else. */
  principal(token: string): Principal | undefined {
    const now = nowIso();
    if (token.startsWith("gtvs_")) {
      const row = this.db.get<{ name: string; role: Role }>(
        `SELECT u.name, u.role FROM user_sessions s JOIN users u ON u.name = s.user WHERE s.token_hash = ? AND s.expires_at > ?`,
        hashToken(token),
        now,
      );
      return row ? { kind: "user", name: row.name, role: row.role } : undefined;
    }
    if (token.startsWith("gtvl_")) {
      const row = this.db.get<{ id: string; project: string; label: string | null }>(
        `SELECT id, project, label FROM share_links WHERE code_hash = ? AND (expires_at IS NULL OR expires_at > ?)`,
        hashToken(token),
        now,
      );
      if (!row) return undefined;
      this.db.run(`UPDATE share_links SET last_used = ? WHERE id = ?`, now, row.id);
      return { kind: "share", name: row.label ? `link: ${row.label}` : "share link", role: "member", project: row.project };
    }
    const d = this.deviceFor(token); // gtvd_… and old gtv_… developer tokens
    return d ? { kind: "device", name: d.user, role: d.role, device: d.id } : undefined;
  }
}
