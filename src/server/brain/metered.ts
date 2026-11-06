// Wraps the shared brain per project: tags jobs with the project, records every job in the hub
// (count, latency, failures) for the dashboard, and hands the backend the project's engine for its tools.

import type { Db } from "../../shared/db.ts";
import type { Brain, BrainJob, BrainResult } from "./types.ts";
import type { Engine } from "../project/engine.ts";
import { nowIso } from "../../shared/util.ts";

export interface ProjectScopedBackend extends Brain {
  readonly model?: string;
  /** Optional: model choice from the dashboard ("provider/model"). */
  setModel?(model: string | undefined): void;
  models?(): Promise<string[]>;
}

export class MeteredBrain implements Brain {
  readonly name: string;
  private readonly base: ProjectScopedBackend;
  private readonly project: string;
  private readonly hubDb: Db;
  private readonly engine: () => Engine | undefined;

  constructor(base: ProjectScopedBackend, project: string, hubDb: Db, engine: () => Engine | undefined = () => undefined) {
    this.base = base;
    this.name = base.name;
    this.project = project;
    this.hubDb = hubDb;
    this.engine = engine;
  }

  health() {
    return this.base.health();
  }

  async run<T>(job: BrainJob): Promise<BrainResult<T>> {
    const started = Date.now();
    try {
      const res = await this.base.run<T>({ ...job, project: this.project, engine: this.engine });
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
