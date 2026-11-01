// Brain backed by a Hermes Agent gateway (`hermes gateway run`, OpenAI-compatible API server), logged in
// with a ChatGPT plan (provider openai-codex). Hermes runs its own tool loop; its only tools are the
// Operator's read-only MCP server (`gtv` → /mcp, see docker/hermes/config.yaml), shared by all projects,
// so every job tells the brain which project id to pass.
//
// Hermes quirks handled here (checked against the v0.22 source):
// - `response_format` is ignored → the schema goes into the prompt and the JSON is validated here;
// - a failed run can still be HTTP 200 (finish_reason "error", or provider errors as plain text) → only
//   finish_reason "stop" with parseable JSON counts;
// - every request is stored as a session → each job uses its own session id and deletes it afterwards.

import { randomUUID } from "node:crypto";
import { BrainUnavailable, Semaphore, type BrainJob, type BrainResult } from "./types.ts";
import type { ProjectScopedBackend } from "./metered.ts";
import { OPERATOR_SYSTEM } from "./prompts.ts";
import { log } from "../../shared/util.ts";

export interface HermesOptions {
  url: string;
  apiKey?: string;
  model?: string; // "provider/model", e.g. "openai-codex/gpt-6-luna"; unset = Hermes's configured default
  concurrency?: number;
  timeoutMs?: number;
}

/** Name of the gtv MCP server in Hermes's config; Hermes exposes its tools as mcp__gtv__<tool>. */
export const HERMES_MCP_SERVER = "gtv";

interface Completion {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  hermes?: { failed?: boolean; error?: string; error_code?: string };
  error?: { message?: string; code?: string };
}

export function hermesSystemPrompt(project: string | undefined, schema: Record<string, unknown>): string {
  return [
    OPERATOR_SYSTEM,
    `Your gtv tools are named mcp__${HERMES_MCP_SERVER}__<tool> (team_status, read_file, grep, wip_diff, find_symbol, who_calls, impact, file_symbols, overview, owners, kb_search, kb_get, conflicts).` +
      (project ? ` They serve several projects: pass project="${project}" to every call.` : ""),
    `Final answer: reply with ONE JSON object and nothing else (no prose, no code fence), matching this JSON schema:\n${JSON.stringify(schema)}`,
  ].join("\n\n");
}

/** The first JSON object in a reply (models sometimes wrap it in prose or a code fence); checks required keys. */
export function parseJsonReply<T>(text: string, schema: Record<string, unknown>): T {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error(`no JSON object in reply: ${text.slice(0, 200)}`);
  const out = JSON.parse(m[0]) as Record<string, unknown>;
  const missing = ((schema.required as string[] | undefined) ?? []).filter((k) => !(k in out));
  if (missing.length) throw new Error(`reply misses ${missing.join(", ")}`);
  return out as T;
}

export class HermesBrain implements ProjectScopedBackend {
  readonly name = "hermes";
  private readonly opts: HermesOptions;
  private readonly sem: Semaphore;

  constructor(opts: HermesOptions) {
    this.opts = opts;
    this.sem = new Semaphore(opts.concurrency ?? 2);
  }

  get model(): string | undefined {
    return this.opts.model;
  }

  setModel(model: string | undefined): void {
    this.opts.model = model || undefined;
  }

  private async call(path: string, init: Omit<RequestInit, "headers"> & { timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15_000);
    const headers: Record<string, string> = { "content-type": "application/json", ...init.headers };
    if (this.opts.apiKey) headers.authorization = `Bearer ${this.opts.apiKey}`;
    try {
      return await fetch(this.opts.url.replace(/\/$/, "") + path, { ...init, headers, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const res = await this.call("/health", { timeoutMs: 3000 });
      const h = (await res.json()) as { status?: string; version?: string };
      return { ok: res.ok && h.status === "ok", detail: h.version ? `hermes ${h.version}` : undefined };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  /** "provider/model" ids Hermes can use with its current logins (for the dashboard picker). */
  async models(): Promise<string[]> {
    const res = await this.call("/api/model/options", { timeoutMs: 10_000 });
    if (!res.ok) throw new Error(`hermes /api/model/options -> ${res.status}`);
    const body = (await res.json()) as { providers?: { slug: string; models?: string[]; authenticated?: boolean }[] };
    return (body.providers ?? []).filter((p) => p.authenticated !== false).flatMap((p) => (p.models ?? []).map((m) => `${p.slug}/${m}`));
  }

  /** One chat turn in `session`; returns the assistant text of a clean run, throws otherwise. */
  private async turn(session: string, messages: { role: string; content: string }[], timeoutMs: number): Promise<string> {
    const body: Record<string, unknown> = { model: "hermes-agent", messages, stream: false };
    if (this.opts.model) {
      const [provider, ...rest] = this.opts.model.split("/");
      if (rest.length) Object.assign(body, { provider, model: rest.join("/") });
      else body.model = provider; // bare model: needs direct_model_requests in Hermes's config
    }
    const res = await this.call("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "x-hermes-session-id": session },
      timeoutMs,
    });
    const json = (await res.json().catch(() => ({}))) as Completion;
    if (res.status === 429 || res.status === 503) throw new BrainUnavailable(`hermes busy (${res.status}): ${json.error?.message ?? ""}`);
    if (!res.ok) throw new Error(`hermes ${res.status}: ${json.error?.message ?? "request failed"}`);
    const choice = json.choices?.[0];
    if (json.hermes?.failed || choice?.finish_reason !== "stop") {
      throw new Error(`hermes run ${choice?.finish_reason ?? "failed"}: ${json.hermes?.error ?? choice?.message?.content ?? ""}`.slice(0, 400));
    }
    return choice.message?.content ?? "";
  }

  run<T>(job: BrainJob): Promise<BrainResult<T>> {
    return this.sem.use(async () => {
      const started = Date.now();
      const timeoutMs = job.timeoutMs ?? this.opts.timeoutMs ?? 180_000;
      const session = `gtv-${job.project ?? "x"}-${job.kind}-${randomUUID()}`;
      try {
        const system = hermesSystemPrompt(job.project, job.schema);
        let text = await this.turn(
          session,
          [
            { role: "system", content: system },
            { role: "user", content: job.prompt },
          ],
          timeoutMs,
        );
        let output: T;
        try {
          output = parseJsonReply<T>(text, job.schema);
        } catch (e) {
          // One retry in the same session (history kept): ask for the JSON only.
          const left = Math.max(10_000, timeoutMs - (Date.now() - started));
          const retry = `Your reply was not usable (${(e as Error).message}). Reply with only the JSON object matching the schema.`;
          text = await this.turn(
            session,
            [
              { role: "system", content: system },
              { role: "user", content: retry },
            ],
            left,
          );
          output = parseJsonReply<T>(text, job.schema);
        }
        return { output, ms: Date.now() - started, backend: this.name };
      } catch (e) {
        if ((e as Error).name === "AbortError") throw new BrainUnavailable(`brain timed out after ${Date.now() - started}ms`);
        if ((e as { cause?: { code?: string } }).cause?.code === "ECONNREFUSED") throw new BrainUnavailable("hermes gateway not reachable");
        throw e;
      } finally {
        this.call(`/api/sessions/${encodeURIComponent(session)}`, { method: "DELETE" }).catch((e) =>
          log("brain", "session cleanup failed", (e as Error).message),
        );
      }
    });
  }
}
