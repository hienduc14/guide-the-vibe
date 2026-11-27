// The hub owns all projects (one repo each), accounts and their computers, who may do what in each project, the shared brain and its
// usage statistics. HTTP routes resolve a ProjectRuntime through it.

import { join } from "node:path";
import { Db, parseJson } from "../../shared/db.ts";
import { HUB_SCHEMA } from "./hub-db.ts";
import { Accounts, hashToken, type Principal } from "./accounts.ts";
import { Members } from "./members.ts";
import { checkRepoAddress, lsRemote } from "./repo-check.ts";
import { ProjectRuntime, type ProjectRecord } from "../project/runtime.ts";
import { MeteredBrain, type ProjectScopedBackend } from "../brain/metered.ts";
import { PiBrain } from "../brain/pi.ts";
import type { ServerConfig } from "../config.ts";
import type { Charter, Policy } from "../../shared/types.ts";
import { log, nowIso, repoKey } from "../../shared/util.ts";

export const PROJECT_ID = /^[a-z0-9][a-z0-9-]{1,40}$/;

/** A caller's access in one project: their project_members row, or none. */
export type ProjectAccess = "manager" | "developer" | "viewer" | "none";
export const ACCESS_RANK: Record<ProjectAccess, number> = { none: 0, viewer: 1, developer: 2, manager: 3 };

export { repoKey };

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
  readonly members: Members;
  private runtimes = new Map<string, ProjectRuntime>();
  private opening = new Map<string, Promise<ProjectRuntime>>();

  constructor(cfg: ServerConfig, brain: ProjectScopedBackend) {
    this.cfg = cfg;
    this.brain = brain;
    this.db = new Db(cfg.dataDir === ":memory:" ? ":memory:" : join(cfg.dataDir, "hub.db"), HUB_SCHEMA);
    this.db.ensureColumn("projects", "charter", "TEXT NOT NULL DEFAULT '{}'");
    this.db.ensureColumn("projects", "created_by", "TEXT");
    this.accounts = new Accounts(this.db);
    this.members = new Members(this.db);
  }

  async init(): Promise<void> {
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
    // Env tokens (GTV_TOKENS: scripts, sandboxes) are computers of accounts of that name.
    for (const [token, dev] of this.cfg.tokens) {
      if (!this.accounts.user(dev)) this.accounts.createUser(dev, { password: null });
      this.accounts.addDevice(dev, hashToken(token), "GTV_TOKENS", "unknown");
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

  private saveRecord(input: ProjectInput, prev?: ProjectRecord, by?: string): ProjectRecord {
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
      created_by: prev?.created_by ?? by ?? null,
      created_at: prev?.created_at ?? now,
      updated_at: now,
    };
    this.db.upsert("projects", { ...rec, aliases: rec.aliases, policy: rec.policy, charter: rec.charter, archived: rec.archived });
    return rec;
  }

  /**
   * A new project; a person who creates one is its manager. Only a server admin may bring back an archived project
   * under its old id (with its data and members).
   */
  async createProject(input: ProjectInput, by?: Principal): Promise<ProjectRuntime> {
    if (!PROJECT_ID.test(input.id)) throw new Error("project id: lowercase letters, digits and dashes (2-41 chars)");
    if (!input.repo_url) throw new Error("repo_url is required");
    const prev = this.record(input.id);
    if (prev && (!prev.archived || (by && by.role !== "admin"))) throw new Error(`the project id ${input.id} is taken: pick another one`);
    if (prev) this.db.run(`UPDATE projects SET archived = 0 WHERE id = ?`, input.id);
    this.saveRecord(input, prev ? { ...prev, archived: false } : undefined, by?.name);
    if (by?.kind === "user" && !this.members.access(input.id, by.name)) this.members.add(input.id, by.name, "manager", null);
    return this.runtime(input.id);
  }

  /** Can the server read this repo, and what is its default branch? Only server admins may use local paths. */
  async checkRepo(url: string, admin: boolean): Promise<{ default_branch: string | null }> {
    if (!admin) await checkRepoAddress(url);
    return lsRemote(url, { local: admin });
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
    const brain = new MeteredBrain(this.brain, id, this.db, () => this.runtimes.get(id)?.engine);
    const p = ProjectRuntime.open(rec, this.cfg, brain, () => this.members.list(id))
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

  // ---- access ---------------------------------------------------------------------

  /**
   * What a caller may do in one project. System admins, the admin token and open mode manage every project;
   * a share link views its own; everyone else has the access of their membership, or none.
   */
  projectAccess(p: Principal, projectId: string): ProjectAccess {
    if (p.kind === "share") return p.project === projectId ? "viewer" : "none";
    if (p.role === "admin" || p.kind === "admin_token" || p.kind === "open") return "manager";
    return this.members.access(projectId, p.name) ?? "none";
  }

  /** Projects a caller can see, with their access in each. */
  myProjects(p: Principal): { record: ProjectRecord; access: Exclude<ProjectAccess, "none"> }[] {
    return this.records().flatMap((record) => {
      const access = this.projectAccess(p, record.id);
      return access === "none" ? [] : [{ record, access }];
    });
  }

  // ---- accounts ------------------------------------------------------------------------

  /** Deletes an account everywhere: sessions, computers and memberships go; project records keep the name. */
  deleteAccount(name: string): void {
    const sole = this.members.soleManagerOf(name).filter((id) => this.record(id) && !this.record(id)!.archived);
    if (sole.length) throw new Error(`${name} is the last manager of ${sole.join(", ")}: make someone else a manager first`);
    this.accounts.deleteUser(name);
    this.members.removeUser(name);
  }

  // ---- invites ------------------------------------------------------------------------

  /** What an invite link shows anyone: the project's name, the access it gives and who made it, nothing else. */
  inviteInfo(
    code: string,
  ): { valid: false } | { valid: true; project_id: string; project_name: string; access: string; invited_by: string; invited_by_name: string } {
    const inv = this.members.invite(code);
    const rec = inv && this.record(inv.project);
    if (!inv || !rec || rec.archived) return { valid: false };
    const by = this.accounts.user(inv.created_by);
    return {
      valid: true,
      project_id: rec.id,
      project_name: rec.name,
      access: inv.access,
      invited_by: inv.created_by,
      invited_by_name: by?.display_name ?? inv.created_by,
    };
  }

  acceptInvite(code: string, user: string): ReturnType<Members["acceptInvite"]> {
    if (!this.inviteInfo(code).valid) throw new Error("this invite link no longer works: ask for a new one");
    return this.members.acceptInvite(code, user);
  }

  // ---- settings & brain stats ---------------------------------------------------------

  setting(key: string): string | undefined {
    return this.db.get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, key)?.value;
  }

  setSetting(key: string, value: string | null): void {
    if (value === null) this.db.run(`DELETE FROM settings WHERE key = ?`, key);
    else this.db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, key, value);
  }

  /** Brain jobs that failed in the last 10 minutes, and the latest error: a provider can be configured yet refuse every job. */
  brainFailing(): { count: number; error: string | null } {
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const n = this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM brain_jobs WHERE ts >= ? AND ok = 0`, since)!.n;
    const last = n ? this.db.get<{ error: string | null }>(`SELECT error FROM brain_jobs WHERE ts >= ? AND ok = 0 ORDER BY id DESC LIMIT 1`, since) : undefined;
    return { count: n, error: last?.error ?? null };
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
