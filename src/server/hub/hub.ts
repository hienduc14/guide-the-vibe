// The hub owns all projects (one repo each), developers and their tokens, the shared brain and its
// usage statistics. HTTP routes resolve a ProjectRuntime through it.

import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { Db, parseJson } from "../../shared/db.ts";
import { HUB_SCHEMA } from "./hub-db.ts";
import { Accounts } from "./accounts.ts";
import { ProjectRuntime, type ProjectRecord } from "../project/runtime.ts";
import { MeteredBrain, type ProjectScopedBackend } from "../brain/metered.ts";
import { PiBrain } from "../brain/pi.ts";
import type { ServerConfig } from "../config.ts";
import type { Charter, Policy } from "../../shared/types.ts";
import { log, nowIso } from "../../shared/util.ts";

export const PROJECT_ID = /^[a-z0-9][a-z0-9-]{1,40}$/;

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** "owner/repo" style key of a remote URL or path, for matching daemons' remotes to projects. */
export function repoKey(url: string): string {
  const cleaned = url
    .trim()
    .replace(/\\/g, "/")
    .replace(/^[a-z]+:\/\/([^@/]+@)?/i, "")
    .replace(/^git@([^:]+):/, "$1/")
    .replace(/\.git\/?$/, "")
    .replace(/\/+$/, "");
  return cleaned.split("/").slice(-2).join("/").toLowerCase();
}

export interface ProjectInput {
  id: string;
  name?: string;
  repo_url: string;
  main_branch?: string;
  aliases?: string[];
  policy?: Partial<Policy>;
  description?: string;
  charter?: Charter;
}

export class Hub {
  readonly db: Db;
  readonly cfg: ServerConfig;
  readonly brain: ProjectScopedBackend;
  readonly accounts: Accounts;
  private runtimes = new Map<string, ProjectRuntime>();
  private opening = new Map<string, Promise<ProjectRuntime>>();

  constructor(cfg: ServerConfig, brain: ProjectScopedBackend) {
    this.cfg = cfg;
    this.brain = brain;
    this.db = new Db(cfg.dataDir === ":memory:" ? ":memory:" : join(cfg.dataDir, "hub.db"), HUB_SCHEMA);
    this.db.ensureColumn("projects", "charter", "TEXT NOT NULL DEFAULT '{}'");
    this.accounts = new Accounts(this.db);
  }

  async init(): Promise<void> {
    // Env tokens (GTV_TOKENS) become developers.
    for (const [token, dev] of this.cfg.tokens) {
      this.db.run(`INSERT OR IGNORE INTO devs (name, token_hash, created_at) VALUES (?,?,?)`, dev, hashToken(token), nowIso());
    }
    // Backwards compatible single-repo setup: GTV_REPO_URL creates the "default" project once.
    if (this.cfg.repoUrl && !this.records(true).length) {
      this.saveRecord({ id: this.cfg.defaultProject, repo_url: this.cfg.repoUrl, main_branch: this.cfg.mainBranch, name: this.cfg.defaultProject });
    }
    this.brain.init?.(this.db);
    const model = this.setting("brain.model");
    if (model) this.brain.setModel?.(model);
    const thinking = this.setting("brain.thinking");
    if (thinking && this.brain instanceof PiBrain) this.brain.setThinking(thinking);
    for (const r of this.records()) {
      await this.runtime(r.id).catch((e) => log("hub", `project ${r.id} failed to open: ${(e as Error).message}`));
    }
  }

  // ---- projects ------------------------------------------------------------------

  records(includeArchived = false): ProjectRecord[] {
    return this.db.all<Record<string, unknown>>(`SELECT * FROM projects ${includeArchived ? "" : "WHERE archived = 0"} ORDER BY created_at`).map(rowToRecord);
  }

  record(id: string): ProjectRecord | undefined {
    const r = this.db.get<Record<string, unknown>>(`SELECT * FROM projects WHERE id = ?`, id);
    return r ? rowToRecord(r) : undefined;
  }

  private saveRecord(input: ProjectInput, prev?: ProjectRecord): ProjectRecord {
    const now = nowIso();
    const rec: ProjectRecord = {
      id: input.id,
      name: input.name ?? prev?.name ?? input.id,
      repo_url: input.repo_url ?? prev?.repo_url,
      main_branch: input.main_branch ?? prev?.main_branch ?? "main",
      aliases: input.aliases ?? prev?.aliases ?? [],
      policy: {
        critical_paths: input.policy?.critical_paths ?? prev?.policy.critical_paths ?? [],
        modules: input.policy?.modules ?? prev?.policy.modules ?? {},
      },
      description: input.description ?? prev?.description,
      charter: input.charter ? cleanCharter(input.charter) : (prev?.charter ?? {}),
      archived: prev?.archived ?? false,
      created_at: prev?.created_at ?? now,
      updated_at: now,
    };
    this.db.upsert("projects", { ...rec, aliases: rec.aliases, policy: rec.policy, charter: rec.charter, archived: rec.archived });
    return rec;
  }

  async createProject(input: ProjectInput): Promise<ProjectRuntime> {
    if (!PROJECT_ID.test(input.id)) throw new Error("project id: lowercase letters, digits and dashes (2-41 chars)");
    if (!input.repo_url) throw new Error("repo_url is required");
    const prev = this.record(input.id);
    if (prev && !prev.archived) throw new Error(`project ${input.id} already exists`);
    if (prev) this.db.run(`UPDATE projects SET archived = 0 WHERE id = ?`, input.id);
    this.saveRecord(input, prev ? { ...prev, archived: false } : undefined);
    return this.runtime(input.id);
  }

  async updateProject(id: string, patch: Partial<ProjectInput>): Promise<ProjectRecord> {
    const prev = this.record(id);
    if (!prev) throw new Error(`unknown project ${id}`);
    const rec = this.saveRecord({ ...patch, id, repo_url: patch.repo_url ?? prev.repo_url, policy: { ...prev.policy, ...patch.policy } }, prev);
    if (rec.repo_url !== prev.repo_url || rec.main_branch !== prev.main_branch) {
      // Git settings changed: reopen the runtime so the mirror follows the new remote/branch.
      this.runtimes.get(id)?.stop();
      this.runtimes.delete(id);
      await this.runtime(id);
    } else {
      this.runtimes.get(id)?.applyRecord(rec, this.cfg.policy);
    }
    return rec;
  }

  archiveProject(id: string): void {
    this.db.run(`UPDATE projects SET archived = 1, updated_at = ? WHERE id = ?`, nowIso(), id);
    this.runtimes.get(id)?.stop();
    this.runtimes.delete(id);
  }

  /** Open (once) and return the runtime of an active project. */
  runtime(id: string): Promise<ProjectRuntime> {
    const live = this.runtimes.get(id);
    if (live) return Promise.resolve(live);
    const pending = this.opening.get(id);
    if (pending) return pending;
    const rec = this.record(id);
    if (!rec || rec.archived) return Promise.reject(new Error(`unknown project ${id}`));
    const p = ProjectRuntime.open(rec, this.cfg, new MeteredBrain(this.brain, id, this.db, () => this.runtimes.get(id)?.engine))
      .then((rt) => {
        this.runtimes.set(id, rt);
        log("hub", `project ${id} ready (${rec.repo_url})`);
        return rt;
      })
      .finally(() => this.opening.delete(id));
    this.opening.set(id, p);
    return p;
  }

  live(id: string): ProjectRuntime | undefined {
    return this.runtimes.get(id);
  }

  /** Which project does a working copy belong to? Match its remote URL against repo URLs and aliases. */
  resolve(remote: string): ProjectRecord | undefined {
    const key = repoKey(remote);
    return this.records().find((p) => [p.repo_url, ...p.aliases].some((u) => repoKey(u) === key || u === remote));
  }

  // ---- developers ------------------------------------------------------------------

  devs(): { name: string; created_at: string; last_seen: string | null }[] {
    return this.db.all(`SELECT name, created_at, last_seen FROM devs ORDER BY name`);
  }

  /** Create or rotate a developer token. Returns the plain token (shown once). */
  issueToken(name: string): string {
    checkDevName(name);
    const token = `gtv_${randomBytes(18).toString("base64url")}`;
    this.db.run(
      `INSERT INTO devs (name, token_hash, created_at) VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET token_hash = excluded.token_hash`,
      name,
      hashToken(token),
      nowIso(),
    );
    return token;
  }

  /** A one-time code for `gtv join`, valid for 24 hours. */
  createInvite(name: string): { code: string; expires_at: string } {
    checkDevName(name);
    const code = randomBytes(18).toString("base64url");
    const expires_at = new Date(Date.now() + 24 * 3600_000).toISOString();
    this.db.run(`DELETE FROM invites WHERE expires_at < ?`, nowIso());
    this.db.run(`INSERT INTO invites (code_hash, dev, expires_at, created_at) VALUES (?,?,?,?)`, hashToken(code), name, expires_at, nowIso());
    return { code, expires_at };
  }

  /** Uses up the invite and issues (or rotates) the dev's token. */
  redeemInvite(code: string): { dev: string; token: string } {
    const row = this.db.get<{ dev: string; expires_at: string }>(`SELECT dev, expires_at FROM invites WHERE code_hash = ?`, hashToken(code));
    this.db.run(`DELETE FROM invites WHERE code_hash = ?`, hashToken(code));
    if (!row || row.expires_at < nowIso()) throw new Error("invite link is invalid, used or expired: ask for a new one");
    return { dev: row.dev, token: this.issueToken(row.dev) };
  }

  removeDev(name: string): void {
    this.db.run(`DELETE FROM devs WHERE name = ?`, name);
  }

  devForToken(token: string): string | undefined {
    const row = this.db.get<{ name: string }>(`SELECT name FROM devs WHERE token_hash = ?`, hashToken(token));
    if (row) this.db.run(`UPDATE devs SET last_seen = ? WHERE name = ?`, nowIso(), row.name);
    return row?.name;
  }

  hasDevs(): boolean {
    return (this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM devs`)?.n ?? 0) > 0;
  }

  // ---- settings & brain stats ---------------------------------------------------------

  setting(key: string): string | undefined {
    return this.db.get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, key)?.value;
  }

  setSetting(key: string, value: string | null): void {
    if (value === null) this.db.run(`DELETE FROM settings WHERE key = ?`, key);
    else this.db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, key, value);
  }

  brainStats(opts: { project?: string; days?: number } = {}) {
    const since = new Date(Date.now() - (opts.days ?? 7) * 86_400_000).toISOString();
    const where = `ts >= ?${opts.project ? " AND project = ?" : ""}`;
    const params = opts.project ? [since, opts.project] : [since];
    const totals = this.db.get<{ jobs: number; failed: number; avg_ms: number | null }>(
      `SELECT COUNT(*) AS jobs, SUM(1 - ok) AS failed, AVG(ms) AS avg_ms FROM brain_jobs WHERE ${where}`,
      ...params,
    )!;
    const ms = this.db.all<{ ms: number }>(`SELECT ms FROM brain_jobs WHERE ${where} AND ok = 1 ORDER BY ms`, ...params).map((r) => r.ms);
    const pct = (p: number) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : null);
    return {
      totals: { jobs: totals.jobs, failed: totals.failed ?? 0, avg_ms: totals.avg_ms ? Math.round(totals.avg_ms) : null, p50_ms: pct(0.5), p95_ms: pct(0.95) },
      byKind: this.db.all<{ kind: string; jobs: number; failed: number }>(
        `SELECT kind, COUNT(*) AS jobs, SUM(1 - ok) AS failed FROM brain_jobs WHERE ${where} GROUP BY kind ORDER BY jobs DESC`,
        ...params,
      ),
      byProject: this.db.all<{ project: string; jobs: number }>(
        `SELECT project, COUNT(*) AS jobs FROM brain_jobs WHERE ${where} GROUP BY project ORDER BY jobs DESC`,
        ...params,
      ),
      byDay: this.db.all<{ day: string; jobs: number; failed: number }>(
        `SELECT substr(ts, 1, 10) AS day, COUNT(*) AS jobs, SUM(1 - ok) AS failed FROM brain_jobs WHERE ${where} GROUP BY day ORDER BY day`,
        ...params,
      ),
      recent: this.db.all(`SELECT * FROM brain_jobs WHERE ${where} ORDER BY id DESC LIMIT 25`, ...params),
    };
  }

  async close(): Promise<void> {
    for (const rt of this.runtimes.values()) rt.stop();
    this.runtimes.clear();
    this.db.close();
  }
}

function rowToRecord(r: Record<string, unknown>): ProjectRecord {
  return {
    ...(r as unknown as ProjectRecord),
    aliases: parseJson(r.aliases, []),
    policy: { critical_paths: [], modules: {}, ...parseJson<Partial<Policy>>(r.policy, {}) },
    charter: parseJson<Charter>(r.charter, {}),
    archived: !!r.archived,
  };
}

/** Keep only known charter fields, trimmed; empty strings drop out. */
function cleanCharter(c: Charter): Charter {
  const out: Charter = {};
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 2000) : undefined);
  for (const k of ["goal", "users", "milestones", "constraints", "non_goals", "notes"] as const) {
    const v = text(c[k]);
    if (v) out[k] = v;
  }
  const d = text(c.deadline);
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) out.deadline = d;
  if (c.quality && ["prototype", "mvp", "production"].includes(c.quality)) out.quality = c.quality;
  if (c.language === "vi" || c.language === "en") out.language = c.language;
  const stack = (c.stack ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (stack.length) out.stack = stack.slice(0, 30);
  return out;
}

function checkDevName(name: string): void {
  if (!/^[a-zA-Z0-9._-]{1,40}$/.test(name)) throw new Error("dev name: letters, digits, . _ -");
}
