// The Brain is the LLM half of the Operator. Everything it needs comes through its read-only tools and
// the job input; it must answer in the job's JSON schema.

import type { Engine } from "../project/engine.ts";

export type JobKind = "answer_question" | "judge_registration" | "extract_intent_from_plan";

export interface BrainJob {
  kind: JobKind;
  prompt: string;
  schema: Record<string, unknown>;
  timeoutMs?: number;
  /** Set by MeteredBrain: the project whose tools the job may use. */
  project?: string;
  engine?: () => Engine | undefined;
}

export interface BrainResult<T> {
  output: T;
  ms: number;
  backend: string;
}

export interface Brain {
  readonly name: string;
  health(): Promise<{ ok: boolean; detail?: string }>;
  run<T>(job: BrainJob): Promise<BrainResult<T>>;
}

export class BrainUnavailable extends Error {}

export class NullBrain implements Brain {
  readonly name = "null";
  async health() {
    return { ok: false, detail: "brain disabled (BRAIN_BACKEND=null)" };
  }
  async run<T>(): Promise<BrainResult<T>> {
    throw new BrainUnavailable("brain disabled");
  }
}

/** Limits concurrent jobs so one subscription account is not hammered. */
export class Semaphore {
  private active = 0;
  private queue: (() => void)[] = [];
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  async use<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }

  get pending(): number {
    return this.queue.length;
  }
}
