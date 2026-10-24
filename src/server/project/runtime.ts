// Everything one project needs at runtime: its database, git mirror, engine, Q&A service and loops.

import { join } from "node:path";
import { Db } from "../../shared/db.ts";
import { PROJECT_SCHEMA } from "./schema.ts";
import { Repo } from "./repo.ts";
import { Engine } from "./engine.ts";
import { TicketService } from "../qa/tickets.ts";
import type { Brain } from "../brain/types.ts";
import type { ServerConfig } from "../config.ts";
import type { Policy } from "../../shared/types.ts";
import { log } from "../../shared/util.ts";

export interface ProjectRecord {
  id: string;
  name: string;
  repo_url: string;
  main_branch: string;
  aliases: string[]; // extra remote URLs / "owner/repo" names that identify this project
  policy: Policy;
  description?: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export class ProjectRuntime {
  record: ProjectRecord;
  readonly db: Db;
  readonly repo: Repo;
  readonly engine: Engine;
  readonly tickets: TicketService;
  lastSync?: { at: string; ok: boolean; error?: string };
  private timers: NodeJS.Timeout[] = [];

  private constructor(record: ProjectRecord, cfg: ServerConfig, brain: Brain) {
    this.record = record;
    const dir = cfg.dataDir === ":memory:" ? undefined : join(cfg.dataDir, "projects", record.id);
    this.db = new Db(dir ? join(dir, "gtv.db") : ":memory:", PROJECT_SCHEMA);
    this.repo = new Repo(join(dir ?? join(".gtv-data", "projects", record.id), "mirror.git"), record.repo_url, record.main_branch);
    this.engine = new Engine({ db: this.db, repo: this.repo, brain, cfg: { featureDefaults: cfg.features, registrationWaitMs: cfg.registrationWaitMs, l3DailyBudget: cfg.l3DailyBudget } });
    if (cfg.docGlobs) this.engine.kb.globs = cfg.docGlobs;
    this.tickets = new TicketService(this.engine, { askWaitMs: cfg.askWaitMs, tier2TimeoutMs: cfg.tier2TimeoutMs, tier3TimeoutMs: cfg.tier3TimeoutMs });
    this.applyRecord(record, cfg.policy);
  }

  static async open(record: ProjectRecord, cfg: ServerConfig, brain: Brain): Promise<ProjectRuntime> {
    const rt = new ProjectRuntime(record, cfg, brain);
    await rt.repo.ensure();
    await rt.sync();
    rt.timers = [
      setInterval(() => void rt.sync(), cfg.pollMs),
      setInterval(() => rt.engine.store.expireSessions(), 60_000),
      setInterval(() => rt.tickets.tick(), 30_000),
    ];
    for (const t of rt.timers) t.unref();
    return rt;
  }

  /** Policy from the project record; falls back to the server-wide policy for empty fields. */
  applyRecord(record: ProjectRecord, fallback?: Policy): void {
    this.record = record;
    this.engine.store.policy = {
      critical_paths: record.policy.critical_paths?.length ? record.policy.critical_paths : (fallback?.critical_paths ?? []),
      modules: Object.keys(record.policy.modules ?? {}).length ? record.policy.modules : (fallback?.modules ?? {}),
    };
    this.engine.store.changed();
  }

  async sync(): Promise<void> {
    try {
      await this.engine.pollRepo();
      this.lastSync = { at: new Date().toISOString(), ok: true };
    } catch (e) {
      this.lastSync = { at: new Date().toISOString(), ok: false, error: (e as Error).message };
      log(`project:${this.record.id}`, "sync failed:", (e as Error).message);
    }
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.db.close();
  }
}
