// Wraps the shared brain per project: tags jobs with the project, records every job in the hub
// (count, latency, failures) for the dashboard, and lets backends scope tools to the project.

import type { Db } from "../../shared/db.ts";
import type { Brain, BrainJob, BrainResult } from "./types.ts";
import { nowIso } from "../../shared/util.ts";

export interface ProjectScopedBackend extends Brain {
  /** Optional: make the project's tools available to the backend before a job runs. */
  prepareProject?(project: string): Promise<void>;
  readonly model?: string;
}

export class MeteredBrain implements Brain {
  readonly name: string;
  private readonly base: ProjectScopedBackend;
  private readonly project: string;
  private readonly hubDb: Db;

  constructor(base: ProjectScopedBackend, project: string, hubDb: Db) {
    this.base = base;
    this.name = base.name;
    this.project = project;
    this.hubDb = hubDb;
  }

  health() {
    return this.base.health();
  }

  async run<T>(job: BrainJob): Promise<BrainResult<T>> {
    const started = Date.now();
    try {
      await this.base.prepareProject?.(this.project);
      const res = await this.base.run<T>({ ...job, project: this.project });
      this.record(job.kind, Date.now() - started, true);
      return res;
    } catch (e) {
      this.record(job.kind, Date.now() - started, false, (e as Error).message);
      throw e;
    }
  }

  private record(kind: string, ms: number, ok: boolean, error?: string): void {
    if (this.base.name === "null") return;
    this.hubDb.run(
      `INSERT INTO brain_jobs (ts, project, kind, backend, model, ms, ok, error) VALUES (?,?,?,?,?,?,?,?)`,
      nowIso(),
      this.project,
      kind,
      this.base.name,
      this.base.model ?? null,
      ms,
      ok ? 1 : 0,
      error ?? null,
    );
  }
}
