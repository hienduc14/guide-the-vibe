// Brain backed by the Pi agent loop (@earendil-works/pi-agent-core), running inside the Operator process.
// Each job is a fresh in-memory agent whose only tools are the project's read-only gtv tools (tools.ts):
// no shell, no file writes, no session files, nothing read from ~/.pi.
//
// The model is "provider/model":
// - "custom/<id>" (or a bare "<id>") goes to BRAIN_BASE_URL, any OpenAI-compatible endpoint
//   (CLIProxyAPI, OpenRouter, vLLM, Ollama, LiteLLM…), or Anthropic-style with BRAIN_API=anthropic-messages;
// - any other provider is one of Pi's built-in providers ("anthropic/claude-…", "openai/gpt-…",
//   "openrouter/…", "google/…"), keyed by its usual env var (ANTHROPIC_API_KEY, OPENAI_API_KEY, …).
// Pi does not enforce a JSON schema, so the schema goes into the prompt and the reply is validated here.

import { Agent } from "@earendil-works/pi-agent-core";
import { createProvider, type Api, type AssistantMessage, type Model, type MutableModels } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { BrainUnavailable, Semaphore, type BrainJob, type BrainResult } from "./types.ts";
import type { ProjectScopedBackend } from "./metered.ts";
import { OPERATOR_SYSTEM } from "./prompts.ts";
import { brainTools } from "./tools.ts";

export type CustomApi = "openai-completions" | "anthropic-messages";

export interface PiOptions {
  /** "provider/model"; "custom/<id>" or a bare id uses baseUrl. */
  model?: string;
  /** OpenAI-compatible (or Anthropic-style) endpoint for the "custom" provider, e.g. http://127.0.0.1:8317/v1. */
  baseUrl?: string;
  apiKey?: string;
  api?: CustomApi;
  concurrency?: number;
  timeoutMs?: number;
}

const CUSTOM = "custom";

export function piSystemPrompt(schema: Record<string, unknown>): string {
  return [
    OPERATOR_SYSTEM,
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

/** Provider errors that mean "try later" rather than "this job is broken". */
const TRANSIENT =
  /\b(429|502|503|504|529)\b|rate.?limit|overloaded|timed? ?out|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|connection error|network/i;

export class PiBrain implements ProjectScopedBackend {
  readonly name = "pi";
  private readonly opts: PiOptions;
  private readonly sem: Semaphore;
  private readonly pi: MutableModels;

  constructor(opts: PiOptions) {
    this.opts = opts;
    this.sem = new Semaphore(opts.concurrency ?? 2);
    this.pi = builtinModels();
    if (opts.baseUrl) {
      const key = opts.apiKey;
      this.pi.setProvider(
        createProvider({
          id: CUSTOM,
          baseUrl: opts.baseUrl,
          auth: { apiKey: { name: "BRAIN_API_KEY", resolve: async () => ({ auth: key ? { apiKey: key } : {} }) } },
          models: [],
          api: opts.api === "anthropic-messages" ? anthropicMessagesApi() : openAICompletionsApi(),
        }),
      );
    }
  }

  get model(): string | undefined {
    return this.opts.model;
  }

  setModel(model: string | undefined): void {
    this.opts.model = model || undefined;
  }

  /** Resolves the configured model id to a Pi model; throws a readable error when it cannot. */
  resolveModel(): Model<Api> {
    const id = this.opts.model;
    if (!id) throw new BrainUnavailable("no brain model set (BRAIN_MODEL)");
    const slash = id.indexOf("/");
    const provider = slash > 0 ? id.slice(0, slash) : CUSTOM;
    const modelId = slash > 0 ? id.slice(slash + 1) : id;
    if (provider === CUSTOM) {
      if (!this.opts.baseUrl) throw new BrainUnavailable(`model ${id} needs BRAIN_BASE_URL`);
      return {
        id: modelId,
        name: modelId,
        api: this.opts.api ?? "openai-completions",
        provider: CUSTOM,
        baseUrl: this.opts.baseUrl,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 16_000,
      } as Model<Api>;
    }
    const m = this.pi.getModel(provider, modelId);
    if (!m) throw new BrainUnavailable(`unknown model ${id} (Pi has no ${provider} model "${modelId}")`);
    return m;
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const m = this.resolveModel();
      if (m.provider === CUSTOM) {
        const ctrl = AbortSignal.timeout(3000);
        const res = await fetch(`${this.opts.baseUrl!.replace(/\/$/, "")}/models`, {
          headers: this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}`, "x-api-key": this.opts.apiKey } : {},
          signal: ctrl,
        });
        return { ok: res.ok, detail: res.ok ? `pi → ${this.opts.baseUrl}` : `${this.opts.baseUrl}/models -> ${res.status}` };
      }
      const auth = await this.pi.getAuth(m);
      return auth ? { ok: true, detail: `pi → ${m.provider} (${auth.source})` } : { ok: false, detail: `no credentials for provider ${m.provider}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  /** Models for the dashboard picker: the custom endpoint's list plus built-in providers that have credentials. */
  async models(): Promise<string[]> {
    const out: string[] = [];
    if (this.opts.baseUrl) {
      const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/models`, {
        headers: this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}`, "x-api-key": this.opts.apiKey } : {},
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) out.push(...(((await res.json()) as { data?: { id: string }[] }).data ?? []).map((m) => `${CUSTOM}/${m.id}`));
    }
    for (const m of await this.pi.getAvailable()) if (m.provider !== CUSTOM) out.push(`${m.provider}/${m.id}`);
    return out;
  }

  /** Runs one prompt to the end; returns the final assistant text of a clean run, throws otherwise. */
  private async turn(agent: Agent, prompt: string, deadline: number): Promise<string> {
    const left = deadline - Date.now();
    if (left <= 0) throw new BrainUnavailable("brain timed out");
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      agent.abort();
    }, left);
    try {
      await agent.prompt(prompt);
    } finally {
      clearTimeout(timer);
    }
    const last = agent.state.messages.findLast((m) => m.role === "assistant") as AssistantMessage | undefined;
    if (timedOut || last?.stopReason === "aborted") throw new BrainUnavailable("brain timed out");
    if (!last || last.stopReason === "error") {
      const msg = last?.errorMessage ?? agent.state.errorMessage ?? "no reply";
      throw TRANSIENT.test(msg) ? new BrainUnavailable(`model unavailable: ${msg}`) : new Error(`model error: ${msg}`.slice(0, 400));
    }
    if (last.stopReason !== "stop") throw new Error(`model stopped with ${last.stopReason}`);
    return last.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
  }

  run<T>(job: BrainJob): Promise<BrainResult<T>> {
    return this.sem.use(async () => {
      const started = Date.now();
      const deadline = started + (job.timeoutMs ?? this.opts.timeoutMs ?? 180_000);
      const engine = job.engine?.();
      if (!engine) throw new BrainUnavailable(`project ${job.project ?? "?"} is not loaded`);
      const agent = new Agent({
        initialState: { systemPrompt: piSystemPrompt(job.schema), model: this.resolveModel(), tools: brainTools(engine) },
        streamFn: this.pi.streamSimple.bind(this.pi),
        identity: { attribution: null },
      });
      try {
        let text = await this.turn(agent, job.prompt, deadline);
        let output: T;
        try {
          output = parseJsonReply<T>(text, job.schema);
        } catch (e) {
          // One retry with the history kept: ask for the JSON only.
          text = await this.turn(agent, `Your reply was not usable (${(e as Error).message}). Reply with only the JSON object matching the schema.`, deadline);
          output = parseJsonReply<T>(text, job.schema);
        }
        return { output, ms: Date.now() - started, backend: this.name };
      } finally {
        agent.abort();
      }
    });
  }
}
