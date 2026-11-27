// Accounts: one per person, made by signing up (the first one, on an empty server, is the admin: /setup). An account
// logs in to the dashboard (password → session gtvs_… in the gtv_session cookie) and is the identity of that person's
// agents through the computers they connected (device key gtvd_…).
//   system role: admin (the server: accounts, brain, sign-up mode) | member (what their project access allows, see hub.projectAccess)
// Names appear in every project record, so they never change and a deleted account's name is never given out again.
// A share link (gtvl_…) is a read-only viewer limited to one project.

import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { parseJson, type Db } from "../../shared/db.ts";
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
  /** Dashboard sessions: the session's token hash (its id is the first 16 characters). */
  session?: string;
}

export const SESSION_DAYS = 30;
const RESET_MINUTES = 60;
const CONNECT_MINUTES = 10;
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const future = (ms: number) => new Date(Date.now() + ms).toISOString();
/** Names that would read as something other than a person in project records and messages. */
const RESERVED = new Set(["admin", "root", "gtv", "system", "everyone", "all", "share", "me", "api"]);

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`;
}

function checkPassword(password: string, stored: string | null | undefined): boolean {
  const [, salt, expected] = (stored ?? "").split(":");
  if (!salt || !expected) return false;
  const got = scryptSync(password, Buffer.from(salt, "hex"), 32);
  const want = Buffer.from(expected, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

export function checkName(name: string): void {
  if (!/^[a-z0-9._-]{3,32}$/.test(name)) throw new Error("user name: 3-32 lowercase letters, digits, . _ -");
  if (RESERVED.has(name)) throw new Error(`the name ${name} is reserved: pick another one`);
}

function checkPasswordRule(password: string): void {
  if (typeof password !== "string" || password.length < 8) throw new Error("password: at least 8 characters");
}

const displayName = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 60) : fallback);

/** KQ7M-2XPD: no 0/O/1/I, so it can be read aloud and typed. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function userCode(): string {
  const c = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

export interface UserRow {
  name: string;
  display_name: string;
  role: Role;
  created_at: string;
  last_login: string | null;
  disabled_at: string | null;
}

export interface SessionRow {
  id: string;
  created_at: string;
  expires_at: string;
  last_used: string | null;
  user_agent: string | null;
  ip: string | null;
}

export interface DeviceRow {
  id: string;
  user: string;
  name: string;
  platform: string;
  created_at: string;
  last_seen: string | null;
  gtv_version: string | null;
  agents: { kind: string; version: string | null }[];
  reported_at: string | null;
}

export interface DeviceRepo {
  path: string;
  project: string;
  agents: string[];
  updated_at: string;
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

export interface SessionMeta {
  user_agent?: string;
  ip?: string;
}

const USER_COLS = `name, display_name, role, created_at, last_login, disabled_at`;
/** Accounts that may act: not locked, not deleted. */
const ACTIVE = `u.disabled_at IS NULL AND u.deleted_at IS NULL`;

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
    return this.db.get<UserRow>(`SELECT ${USER_COLS} FROM users WHERE name = ? AND deleted_at IS NULL`, name);
  }

  users(): UserRow[] {
    return this.db.all<UserRow>(`SELECT ${USER_COLS} FROM users WHERE deleted_at IS NULL ORDER BY name`);
  }

  /** A new account; without a password (GTV_TOKENS accounts) it cannot log in to the dashboard. */
  createUser(name: string, opts: { display_name?: string; role?: Role; password: string | null }): UserRow {
    checkName(name);
    const role = opts.role ?? "member";
    if (!ROLES.includes(role)) throw new Error(`role must be one of ${ROLES.join(", ")}`);
    if (opts.password !== null) checkPasswordRule(opts.password);
    if (this.db.get(`SELECT 1 FROM users WHERE name = ?`, name)) throw new Error(`the name ${name} is taken: pick another one`);
    this.db.run(
      `INSERT INTO users (name, display_name, role, pass_hash, created_at) VALUES (?,?,?,?,?)`,
      name,
      displayName(opts.display_name, name),
      role,
      opts.password === null ? "" : hashPassword(opts.password),
      nowIso(),
    );
    return this.user(name)!;
  }

  private activeAdmins(): string[] {
    return this.db.all<{ name: string }>(`SELECT name FROM users u WHERE role = 'admin' AND ${ACTIVE}`).map((r) => r.name);
  }

  /** The server always keeps one admin who can log in. */
  private keepAnAdmin(name: string): void {
    const admins = this.activeAdmins();
    if (admins.length === 1 && admins[0] === name) throw new Error(`${name} is the last admin: make someone else an admin first`);
  }

  update(name: string, patch: { role?: Role; disabled?: boolean; display_name?: string }): UserRow {
    const prev = this.user(name);
    if (!prev) throw new Error(`unknown account ${name}`);
    if (patch.role !== undefined && !ROLES.includes(patch.role)) throw new Error(`role must be one of ${ROLES.join(", ")}`);
    if ((patch.role && patch.role !== "admin") || patch.disabled) this.keepAnAdmin(name);
    if (patch.role) this.db.run(`UPDATE users SET role = ? WHERE name = ?`, patch.role, name);
    if (patch.disabled !== undefined)
      this.db.run(`UPDATE users SET disabled_at = ? WHERE name = ?`, patch.disabled ? (prev.disabled_at ?? nowIso()) : null, name);
    if (patch.display_name !== undefined) this.db.run(`UPDATE users SET display_name = ? WHERE name = ?`, displayName(patch.display_name, name), name);
    return this.user(name)!;
  }

  verifyPassword(name: string, password: string): boolean {
    const row = this.db.get<{ pass_hash: string }>(`SELECT pass_hash FROM users WHERE name = ? AND deleted_at IS NULL`, name);
    return checkPassword(String(password ?? ""), row?.pass_hash);
  }

  /** Sets a password and logs out every session but `keep` (computers stay connected). */
  setPassword(name: string, password: string, keep?: string): void {
    checkPasswordRule(password);
    if (!this.user(name)) throw new Error(`unknown account ${name}`);
    this.db.run(`UPDATE users SET pass_hash = ? WHERE name = ?`, hashPassword(password), name);
    this.db.run(`DELETE FROM user_sessions WHERE user = ? AND token_hash IS NOT ?`, name, keep ?? null);
  }

  changePassword(name: string, current: string, password: string, keep?: string): void {
    if (!this.verifyPassword(name, current)) throw new Error("the current password is wrong");
    this.setPassword(name, password, keep);
  }

  /**
   * Marks the account deleted and removes its sessions, computers and links; the row stays so the name is not
   * given out again. Project memberships are the hub's (Hub.deleteAccount).
   */
  deleteUser(name: string): void {
    if (!this.user(name)) throw new Error(`unknown account ${name}`);
    this.keepAnAdmin(name);
    this.db.run(`UPDATE users SET deleted_at = ?, pass_hash = '', role = 'member' WHERE name = ?`, nowIso(), name);
    this.db.run(`DELETE FROM device_repos WHERE device IN (SELECT id FROM devices WHERE user = ?)`, name);
    for (const t of ["user_sessions", "devices", "password_resets", "device_requests"]) this.db.run(`DELETE FROM ${t} WHERE user = ?`, name);
  }

  // ---- dashboard sessions ---------------------------------------------------------------

  /** Name + password → a session token for the cookie. */
  login(name: string, password: string, meta: SessionMeta = {}): { token: string; user: UserRow } {
    const user = this.user(name);
    if (!user || !this.verifyPassword(name, password)) throw new Error("wrong user name or password");
    if (user.disabled_at) throw new Error("this account is locked: ask an admin");
    return this.newSession(name, meta);
  }

  newSession(name: string, meta: SessionMeta = {}): { token: string; user: UserRow } {
    const token = `gtvs_${randomBytes(24).toString("base64url")}`;
    const now = nowIso();
    this.db.run(`DELETE FROM user_sessions WHERE expires_at < ?`, now);
    this.db.run(
      `INSERT INTO user_sessions (token_hash, user, created_at, expires_at, last_used, user_agent, ip) VALUES (?,?,?,?,?,?,?)`,
      hashToken(token),
      name,
      now,
      future(SESSION_DAYS * 86_400_000),
      now,
      meta.user_agent?.slice(0, 300) ?? null,
      meta.ip?.slice(0, 64) ?? null,
    );
    this.db.run(`UPDATE users SET last_login = ? WHERE name = ?`, now, name);
    return { token, user: this.user(name)! };
  }

  /** Ends one session by its token hash. */
  endSession(tokenHash: string): void {
    this.db.run(`DELETE FROM user_sessions WHERE token_hash = ?`, tokenHash);
  }

  sessions(user: string): SessionRow[] {
    return this.db.all<SessionRow>(
      `SELECT substr(token_hash, 1, 16) AS id, created_at, expires_at, last_used, user_agent, ip FROM user_sessions WHERE user = ? AND expires_at > ? ORDER BY last_used DESC`,
      user,
      nowIso(),
    );
  }

  /** Ends one of a person's sessions by id, or every session but `keep` when no id is given. */
  endSessions(user: string, opts: { id?: string; keep?: string }): void {
    if (opts.id) this.db.run(`DELETE FROM user_sessions WHERE user = ? AND substr(token_hash, 1, 16) = ?`, user, opts.id);
    else this.db.run(`DELETE FROM user_sessions WHERE user = ? AND token_hash IS NOT ?`, user, opts.keep ?? null);
  }

  // ---- password reset links (made by an admin, sent by chat: the server sends no email) -----------------

  /** A new one-time code for the account; earlier codes stop working. */
  createReset(name: string): { code: string; expires_at: string } {
    if (!this.user(name)) throw new Error(`unknown account ${name}`);
    const code = randomBytes(24).toString("base64url");
    const expires_at = future(RESET_MINUTES * 60_000);
    this.db.run(`DELETE FROM password_resets WHERE user = ? OR expires_at < ?`, name, nowIso());
    this.db.run(`INSERT INTO password_resets (code_hash, user, expires_at, created_at) VALUES (?,?,?,?)`, hashToken(code), name, expires_at, nowIso());
    return { code, expires_at };
  }

  resetInfo(code: string): { user: string; display_name: string; expires_at: string } {
    const row = this.db.get<{ user: string; expires_at: string }>(`SELECT user, expires_at FROM password_resets WHERE code_hash = ?`, hashToken(code));
    const u = row && row.expires_at > nowIso() ? this.user(row.user) : undefined;
    if (!u) throw new Error("this link is invalid, used or expired: ask your admin for a new one");
    return { user: u.name, display_name: u.display_name, expires_at: row!.expires_at };
  }

  /** Sets the new password (every earlier session ends, computers stay) and logs the person in. */
  resetPassword(code: string, password: string, meta: SessionMeta = {}): { token: string; user: UserRow } {
    const { user } = this.resetInfo(code);
    checkPasswordRule(password);
    if (this.user(user)!.disabled_at) throw new Error("this account is locked: ask an admin");
    this.db.run(`DELETE FROM password_resets WHERE user = ?`, user);
    this.setPassword(user, password);
    return this.newSession(user, meta);
  }

  // ---- devices (computers connected to an account) -----------------------------------------

  devices(user?: string): DeviceRow[] {
    const cols = `id, user, name, platform, created_at, last_seen, gtv_version, agents, reported_at`;
    const rows = user
      ? this.db.all<DeviceRow & { agents: string | null }>(`SELECT ${cols} FROM devices WHERE user = ? ORDER BY created_at`, user)
      : this.db.all<DeviceRow & { agents: string | null }>(`SELECT ${cols} FROM devices ORDER BY created_at`);
    return rows.map((d) => ({ ...d, agents: parseJson(d.agents, []) }));
  }

  deviceRepos(device: string): DeviceRepo[] {
    return this.db
      .all<DeviceRepo & { agents: string }>(`SELECT path, project, agents, updated_at FROM device_repos WHERE device = ? ORDER BY path`, device)
      .map((r) => ({ ...r, agents: parseJson(r.agents, []) }));
  }

  /** What a computer's daemon reports (untrusted, so trimmed): its gtv version, agents, and the repos where gtv is on. */
  reportDevice(id: string, report: unknown): void {
    const b = (report ?? {}) as { gtv_version?: unknown; agents?: unknown; repos?: unknown };
    const text = (v: unknown, max: number) => (typeof v === "string" && v ? v.slice(0, max) : null);
    const list = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max) : []) as Record<string, unknown>[];
    const agents = list(b.agents, 10).flatMap((a) => (text(a?.kind, 20) ? [{ kind: text(a.kind, 20)!, version: text(a.version, 40) }] : []));
    const repos = list(b.repos, 200).flatMap((r) =>
      text(r?.path, 500) && text(r?.project, 60)
        ? [{ path: text(r.path, 500)!, project: text(r.project, 60)!, agents: (list(r.agents, 10) as unknown[]).flatMap((k) => text(k, 20) ?? []) }]
        : [],
    );
    const now = nowIso();
    this.db.tx(() => {
      this.db.run(`UPDATE devices SET gtv_version = ?, agents = ?, reported_at = ? WHERE id = ?`, text(b.gtv_version, 40), JSON.stringify(agents), now, id);
      this.db.run(`DELETE FROM device_repos WHERE device = ?`, id);
      for (const r of repos) this.db.upsert("device_repos", { device: id, ...r, updated_at: now });
    });
  }

  renameDevice(id: string, user: string, name: string): void {
    const n = String(name ?? "").trim();
    if (!n || n.length > 80) throw new Error("computer name: 1-80 characters");
    if (!this.devices(user).some((d) => d.id === id)) throw new Error("unknown computer");
    this.db.run(`UPDATE devices SET name = ? WHERE id = ?`, n, id);
  }

  /** Adds a computer with a known token (GTV_TOKENS, tests); no-op if the token is known. */
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
    const d = this.devices(user).find((x) => x.id === id);
    if (!d) return false;
    this.db.run(`DELETE FROM devices WHERE id = ?`, id);
    this.db.run(`DELETE FROM device_repos WHERE device = ?`, id);
    return true;
  }

  /** The computer a token belongs to (and marks it seen). */
  deviceFor(token: string): { id: string; user: string; role: Role } | undefined {
    const row = this.db.get<{ id: string; user: string; role: Role }>(
      `SELECT d.id, d.user, u.role FROM devices d JOIN users u ON u.name = d.user WHERE d.token_hash = ? AND ${ACTIVE}`,
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

  revokeShareLink(id: string, project: string): void {
    this.db.run(`DELETE FROM share_links WHERE id = ? AND project = ?`, id, project);
  }

  // ---- token → principal ---------------------------------------------------------------

  /** Resolves a session, share-link or computer token; undefined for anything else. */
  principal(token: string): Principal | undefined {
    const now = nowIso();
    if (token.startsWith("gtvs_")) {
      const h = hashToken(token);
      const row = this.db.get<{ name: string; role: Role; last_used: string | null }>(
        `SELECT u.name, u.role, s.last_used FROM user_sessions s JOIN users u ON u.name = s.user WHERE s.token_hash = ? AND s.expires_at > ? AND ${ACTIVE}`,
        h,
        now,
      );
      if (!row) return undefined;
      // A session in use stays alive (30 days from the last use); written at most once a minute.
      if (!row.last_used || Date.parse(row.last_used) < Date.now() - 60_000)
        this.db.run(`UPDATE user_sessions SET last_used = ?, expires_at = ? WHERE token_hash = ?`, now, future(SESSION_DAYS * 86_400_000), h);
      return { kind: "user", name: row.name, role: row.role, session: h };
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
    const d = this.deviceFor(token); // gtvd_… (and GTV_TOKENS keys)
    return d ? { kind: "device", name: d.user, role: d.role, device: d.id } : undefined;
  }
}
