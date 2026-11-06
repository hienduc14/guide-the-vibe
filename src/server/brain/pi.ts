// Brain backed by the Pi agent loop (@earendil-works/pi-agent-core), running inside the Operator process.
// Each job is a fresh in-memory agent whose only tools are the project's read-only gtv tools (tools.ts):
// no shell, no file writes, no session files, nothing read from ~/.pi.
//
// Providers and the model are managed on the dashboard (or by env vars); the model id is "provider/model":
// - an *endpoint*: any OpenAI-compatible (or Anthropic-style) URL added on the dashboard (CLIProxyAPI,
//   OpenRouter, LiteLLM, vLLM, Ollama…), or "custom" from BRAIN_BASE_URL; a bare "<id>" means "custom/<id>";
// - one of Pi's built-in providers ("anthropic/claude-…", "openai/gpt-…", "google/…"…).
// All auth goes through Pi: keys entered on the dashboard live in Pi's CredentialStore (credentials.ts),
// and Pi falls back to each provider's usual env var (ANTHROPIC_API_KEY, ANTHROPIC_OAUTH_TOKEN, …).
// "Log in with your account" (Claude Pro/Max, ChatGPT, Copilot…) runs Pi's OAuth flows here, headless: the admin
// opens the URL or device page in their own browser and pastes back what the flow asks for (startLogin).
// Pi does not enforce a JSON schema, so the schema goes into the prompt and the reply is validated here.

import { Agent } from "@earendil-works/pi-agent-core";
import { randomUUID } from "node:crypto";
import { createProvider, type Api, type AssistantMessage, type AuthInteraction, type Model, type MutableModels } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { BrainUnavailable, Semaphore, type BrainJob, type BrainResult } from "./types.ts";
import type { ProjectScopedBackend } from "./metered.ts";
import { OPERATOR_SYSTEM } from "./prompts.ts";
import { brainTools } from "./tools.ts";
import { DbCredentialStore, Sealer, keyHint } from "./credentials.ts";
import { ANTIGRAVITY, antigravityProvider } from "./antigravity.ts";
import type { Db } from "../../shared/db.ts";
import { log, nowIso } from "../../shared/util.ts";

export type CustomApi = "openai-completions" | "anthropic-messages";

export interface PiOptions {
  /** "provider/model"; a bare id means "custom/<id>". */
  model?: string;
  /** OpenAI-compatible (or Anthropic-style) endpoint for the "custom" provider, e.g. http://127.0.0.1:8317/v1. */
  baseUrl?: string;
  apiKey?: string;
  api?: CustomApi;
  concurrency?: number;
  timeoutMs?: number;
  /** GTV_SECRET_KEY: seals keys stored in hub.db. */
  secretKey?: string;
  /** How hard the model thinks; Pi maps it to each provider's knob (Claude: effort). Default off (fastest). */
  thinking?: ThinkingLevel;
  /** How long an OAuth login session lives (default 10 minutes). */
  loginTtlMs?: number;
}

export const THINKING_LEVELS = ["off", "low", "medium", "high"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** An OpenAI-compatible (or Anthropic-style) endpoint registered as a Pi provider. */
export interface Endpoint {
  id: string;
  name: string;
  base_url: string;
  api: CustomApi;
  /** From BRAIN_BASE_URL: shown on the dashboard but not editable there. */
  env?: boolean;
}

export interface ProviderInfo {
  id: string;
  name: string;
  kind: "endpoint" | "builtin";
  configured: boolean;
  /** Where the key comes from: "stored credential", an env var name, "no key"… */
  source?: string;
  key_hint?: string;
  base_url?: string;
  api?: CustomApi;
  env?: boolean;
  /** "oauth" when signed in with an account, "api_key" otherwise (only when configured). */
  auth_type?: "api_key" | "oauth";
  /** Accepts an API key (PUT …/key). */
  api_key?: boolean;
  /** Supports "log in with your account", and how (see OAuthProvider). */
  oauth?: OAuthFlow;
  /** Number of known models (built-in providers; endpoints list theirs live). */
  models?: number;
}

/**
 * "device": open verification_uri and enter user_code, nothing to paste.
 * "redirect": open the URL, sign in, paste the code (or the final redirect URL) back — the Operator runs on a
 * remote server, so the localhost redirect the browser lands on never reaches it.
 */
export type OAuthFlow = "device" | "redirect";
export interface OAuthProvider {
  id: string;
  name: string;
  flow: OAuthFlow;
}

/** One "log in with your account" attempt; never carries a token. */
export interface OAuthSession {
  id: string;
  provider: string;
  status: "pending" | "waiting_input" | "done" | "error";
  /** redirect flows: open this, then paste what `prompt` asks for. */
  url?: string;
  instructions?: string;
  /** device flows: open verification_uri and enter user_code. */
  user_code?: string;
  verification_uri?: string;
  /** Set while status is waiting_input. */
  prompt?: { message: string; placeholder?: string };
  progress?: string;
  error?: string;
  expires_at: string;
}

interface Login {
  view: OAuthSession;
  abort: AbortController;
  answer?: (value: string) => void;
  waiters: (() => void)[];
  done: Promise<void>;
  timer: NodeJS.Timeout;
}

/** With Pi 1.5.0 the other OAuth flows are device-code ones once the headless option is picked. */
const REDIRECT_FLOWS = new Set(["anthropic", "openai", "openrouter", "antigravity"]);
/** Pi asks which login method to use; on a server only the headless one works. */
const HEADLESS = /headless|device|another device/i;

export const ENDPOINT_ID = /^[a-z0-9][a-z0-9-]{1,30}$/;
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

/** Pi's built-in providers plus Google Antigravity (community extension, antigravity.ts). */
function piModels(credentials?: DbCredentialStore): MutableModels {
  const pi = builtinModels({ credentials });
  pi.setProvider(antigravityProvider());
  return pi;
}

export class PiBrain implements ProjectScopedBackend {
  readonly name = "pi";
  private readonly opts: PiOptions;
  private readonly sem: Semaphore;
  private pi: MutableModels;
  private catalogTimer?: NodeJS.Timeout;
  private endpoints = new Map<string, Endpoint>();
  private db?: Db;
  private store?: DbCredentialStore;
  private sealer: Sealer;

  constructor(opts: PiOptions) {
    this.opts = opts;
    this.sem = new Semaphore(opts.concurrency ?? 2);
    this.sealer = new Sealer(opts.secretKey);
    this.pi = piModels();
    this.loadEndpoints();
  }

  /** Called by the hub: keys and endpoints entered on the dashboard live in hub.db. */
  init(db: Db): void {
    this.db = db;
    this.store = new DbCredentialStore(db, this.sealer);
    this.pi = piModels(this.store);
    this.loadEndpoints();
    this.refreshAntigravity();
    this.catalogTimer ??= setInterval(() => this.refreshAntigravity(), 6 * 3600_000).unref();
    const stored = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM brain_credentials`)?.n ?? 0;
    if (stored && !this.sealer.encrypted) log("brain", "WARNING: GTV_SECRET_KEY is not set — LLM keys in hub.db are stored unencrypted");
  }

  /** Antigravity's model list comes from the signed-in account; no-op when nobody is signed in. */
  private refreshAntigravity(): void {
    void this.pi
      .refresh({ providers: [ANTIGRAVITY], allowNetwork: true })
      .then(async () => {
        const n = (await this.pi.getAvailable(ANTIGRAVITY)).length;
        if (n) log("brain", `antigravity: ${n} models available to the signed-in account`);
      })
      .catch((e: Error) => log("brain", `antigravity: model list refresh failed: ${e.message}`));
  }

  private loadEndpoints(): void {
    for (const id of this.endpoints.keys()) this.pi.deleteProvider(id);
    this.endpoints.clear();
    if (this.opts.baseUrl)
      this.register({ id: CUSTOM, name: "BRAIN_BASE_URL", base_url: this.opts.baseUrl, api: this.opts.api ?? "openai-completions", env: true });
    for (const e of this.db?.all<Endpoint>(`SELECT id, name, base_url, api FROM brain_endpoints ORDER BY created_at`) ?? []) this.register(e);
  }

  private register(e: Endpoint): void {
    this.endpoints.set(e.id, e);
    const envKey = e.env ? this.opts.apiKey : undefined;
    this.pi.setProvider(
      createProvider({
        id: e.id,
        name: e.name,
        baseUrl: e.base_url,
        // Keyless endpoints (a local Ollama) still count as configured.
        auth: {
          apiKey: {
            name: `${e.name} key`,
            resolve: async ({ credential }) => {
              const key = (credential?.type === "api_key" ? credential.key : undefined) ?? envKey;
              return { auth: key ? { apiKey: key } : {}, source: credential ? "stored credential" : envKey ? "BRAIN_API_KEY" : "no key" };
            },
          },
        },
        models: [],
        api: e.api === "anthropic-messages" ? anthropicMessagesApi() : openAICompletionsApi(),
      }),
    );
  }

  get model(): string | undefined {
    return this.opts.model;
  }

  setModel(model: string | undefined): void {
    this.opts.model = model || undefined;
  }

  get thinking(): ThinkingLevel {
    return this.opts.thinking ?? "off";
  }

  setThinking(level: string | undefined): void {
    if (level && !THINKING_LEVELS.includes(level as ThinkingLevel)) throw new Error(`thinking: one of ${THINKING_LEVELS.join(", ")}`);
    this.opts.thinking = (level as ThinkingLevel) || undefined;
  }

  get secretsEncrypted(): boolean {
    return this.sealer.encrypted;
  }

  /** Resolves "provider/model" to a Pi model; throws a readable error when it cannot. */
  resolveModel(id = this.opts.model): Model<Api> {
    if (!id) throw new BrainUnavailable("no brain model set — pick one on the dashboard (Brain) or set BRAIN_MODEL");
    const slash = id.indexOf("/");
    const provider = slash > 0 ? id.slice(0, slash) : CUSTOM;
    const modelId = slash > 0 ? id.slice(slash + 1) : id;
    const e = this.endpoints.get(provider);
    if (e) {
      return {
        id: modelId,
        name: modelId,
        api: e.api,
        provider: e.id,
        baseUrl: e.base_url,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 16_000,
      } as Model<Api>;
    }
    if (provider === CUSTOM) throw new BrainUnavailable(`model ${id} needs BRAIN_BASE_URL or an endpoint named "custom"`);
    const m = this.pi.getModel(provider, modelId);
    if (!m) throw new BrainUnavailable(`unknown model ${id} (no ${provider} model "${modelId}")`);
    return m;
  }

  /** GET <endpoint>/models with the endpoint's key (resolved by Pi). */
  private async endpointModels(e: Endpoint, timeoutMs: number): Promise<string[]> {
    const auth = await this.pi.getAuth(e.id);
    const key = auth?.auth.apiKey;
    const res = await fetch(`${e.base_url.replace(/\/$/, "")}/models`, {
      // Anthropic-style headers only for Anthropic endpoints: CLIProxyAPI answers a "Claude client" with a disguised model list.
      headers: !key ? {} : e.api === "anthropic-messages" ? { "x-api-key": key, "anthropic-version": "2023-06-01" } : { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`${e.base_url}/models -> ${res.status}`);
    return (((await res.json()) as { data?: { id: string }[] }).data ?? []).map((m) => m.id);
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const m = this.resolveModel();
      const e = this.endpoints.get(m.provider);
      if (e) {
        await this.endpointModels(e, 3000);
        return { ok: true, detail: `pi → ${e.name} (${e.base_url})` };
      }
      const auth = await this.pi.getAuth(m);
      return auth ? { ok: true, detail: `pi → ${m.provider} (${auth.source})` } : { ok: false, detail: `no credentials for provider ${m.provider}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  /** Models for the dashboard picker: every endpoint's list plus built-in providers that have credentials. */
  async models(): Promise<string[]> {
    const lists = await Promise.all(
      [...this.endpoints.values()].map((e) =>
        this.endpointModels(e, 5000)
          .then((ids) => ids.map((id) => `${e.id}/${id}`))
          .catch(() => []),
      ),
    );
    const builtin = (await this.pi.getAvailable()).filter((m) => !this.endpoints.has(m.provider)).map((m) => `${m.provider}/${m.id}`);
    return [...lists.flat(), ...builtin];
  }

  // ---- provider management (dashboard) -------------------------------------------------

  private requireStore(): DbCredentialStore {
    if (!this.store || !this.db) throw new Error("provider settings need the hub database");
    return this.store;
  }

  /** Endpoints, then built-in providers that take an API key; secrets never leave the server. */
  async providers(): Promise<ProviderInfo[]> {
    const out: ProviderInfo[] = [];
    const stored = async (id: string) => {
      const c = await this.store?.read(id);
      return c?.type === "api_key" ? c.key : undefined;
    };
    for (const e of this.endpoints.values()) {
      const key = (await stored(e.id)) ?? (e.env ? this.opts.apiKey : undefined);
      const auth = await this.pi.getAuth(e.id).catch(() => undefined);
      out.push({
        id: e.id,
        name: e.name,
        kind: "endpoint",
        configured: true,
        source: auth?.source,
        auth_type: "api_key",
        api_key: true,
        key_hint: keyHint(key),
        base_url: e.base_url,
        api: e.api,
        env: e.env,
      });
    }
    for (const p of this.pi.getProviders()) {
      if (this.endpoints.has(p.id) || (!p.auth.apiKey && !p.auth.oauth)) continue;
      const check = await this.pi.checkAuth(p.id).catch(() => undefined);
      out.push({
        id: p.id,
        name: p.name,
        kind: "builtin",
        configured: !!check,
        source: check?.source,
        auth_type: check?.type,
        key_hint: keyHint(await stored(p.id)),
        api_key: !!p.auth.apiKey,
        oauth: p.auth.oauth ? (REDIRECT_FLOWS.has(p.id) ? "redirect" : "device") : undefined,
        models: p.getModels().length,
      });
    }
    return out;
  }

  /** Store an API key (or a token such as Claude's sk-ant-oat…) for a provider or endpoint. */
  async setKey(providerId: string, key: string): Promise<void> {
    const store = this.requireStore();
    const p = this.pi.getProvider(providerId);
    if (!p?.auth.apiKey) throw new Error(`unknown provider ${providerId}`);
    if (!key.trim()) throw new Error("empty key");
    await store.modify(providerId, async () => ({ type: "api_key", key: key.trim() }));
  }

  async clearKey(providerId: string): Promise<void> {
    await this.requireStore().delete(providerId);
  }

  async addEndpoint(input: { id: string; name?: string; base_url: string; api?: string; key?: string }): Promise<Endpoint> {
    this.requireStore();
    const id = input.id?.trim();
    if (!ENDPOINT_ID.test(id ?? "")) throw new Error("endpoint id: 2–31 chars, lowercase letters, digits and -");
    if (this.endpoints.get(id)?.env) throw new Error(`${id} comes from BRAIN_BASE_URL; change it there`);
    if (!this.endpoints.has(id) && this.pi.getProvider(id)) throw new Error(`${id} is a built-in provider; set its key instead`);
    let url: URL;
    try {
      url = new URL(input.base_url);
    } catch {
      throw new Error("base_url must be a URL, e.g. https://openrouter.ai/api/v1");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("base_url must be http(s)");
    const e: Endpoint = {
      id,
      name: input.name?.trim() || id,
      base_url: url.toString().replace(/\/$/, ""),
      api: input.api === "anthropic-messages" ? "anthropic-messages" : "openai-completions",
    };
    this.db!.run(`INSERT OR REPLACE INTO brain_endpoints (id, name, base_url, api, created_at) VALUES (?,?,?,?,?)`, e.id, e.name, e.base_url, e.api, nowIso());
    this.register(e);
    if (input.key?.trim()) await this.setKey(e.id, input.key);
    return e;
  }

  async removeEndpoint(id: string): Promise<void> {
    this.requireStore();
    const e = this.endpoints.get(id);
    if (!e) throw new Error(`unknown endpoint ${id}`);
    if (e.env) throw new Error(`${id} comes from BRAIN_BASE_URL; unset it there`);
    this.db!.run(`DELETE FROM brain_endpoints WHERE id = ?`, id);
    await this.clearKey(id);
    this.endpoints.delete(id);
    this.pi.deleteProvider(id);
  }

  // ---- "log in with your account" (OAuth, Pi's own flows) --------------------------------

  private logins = new Map<string, Login>();

  oauthProviders(): OAuthProvider[] {
    return this.pi
      .getProviders()
      .filter((p) => p.auth.oauth && !this.endpoints.has(p.id))
      .map((p) => ({ id: p.id, name: p.auth.oauth!.name, flow: REDIRECT_FLOWS.has(p.id) ? "redirect" : "device" }));
  }

  /** OpenAI's ChatGPT login wants a stable id for this installation. */
  private deviceId(): string {
    const row = this.db!.get<{ value: string }>(`SELECT value FROM settings WHERE key = 'brain.device_id'`);
    if (row) return row.value;
    const id = randomUUID();
    this.db!.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('brain.device_id', ?)`, id);
    return id;
  }

  private wake(l: Login): void {
    for (const w of l.waiters.splice(0)) w();
  }

  private changed(l: Login, ms: number): Promise<void> {
    return new Promise((r) => {
      const t = setTimeout(r, ms);
      l.waiters.push(() => {
        clearTimeout(t);
        r();
      });
    });
  }

  /** Starts Pi's login flow for a provider; returns once there is something to show (URL, device code) or an outcome. */
  async startLogin(providerId: string, opts: { domain?: string } = {}): Promise<OAuthSession> {
    this.requireStore();
    const p = this.pi.getProvider(providerId);
    if (!p?.auth.oauth || this.endpoints.has(providerId)) throw new Error(`${providerId} has no account login`);
    // One login per provider: a new start replaces the old one (fixed callback ports must be free again).
    for (const old of [...this.logins.values()].filter((l) => l.view.provider === providerId)) {
      this.cancelLogin(old.view.id);
      await old.done;
    }
    const ttl = this.opts.loginTtlMs ?? 10 * 60_000;
    const view: OAuthSession = { id: randomUUID(), provider: providerId, status: "pending", expires_at: new Date(Date.now() + ttl).toISOString() };
    const abort = new AbortController();
    const l: Login = {
      view,
      abort,
      waiters: [],
      done: Promise.resolve(),
      timer: setTimeout(() => {
        abort.abort(new Error("login expired"));
        this.logins.delete(view.id);
      }, ttl).unref(),
    };
    const interaction: AuthInteraction = {
      signal: abort.signal,
      notify: (e) => {
        if (e.type === "auth_url") Object.assign(view, { url: e.url, instructions: e.instructions });
        else if (e.type === "device_code") Object.assign(view, { user_code: e.userCode, verification_uri: e.verificationUri });
        else view.progress = e.message;
        this.wake(l);
      },
      prompt: async (q) => {
        if (q.type === "select") return (q.options.find((o) => HEADLESS.test(o.label)) ?? q.options[0]).id;
        if (q.type === "text") return opts.domain ?? ""; // GitHub Copilot: Enterprise domain, blank = github.com
        // manual_code / secret: the admin pastes it on the dashboard.
        const signal = q.signal ? AbortSignal.any([q.signal, abort.signal]) : abort.signal;
        return new Promise<string>((resolve, reject) => {
          const settle = () => {
            signal.removeEventListener("abort", onAbort);
            l.answer = undefined;
            delete view.prompt;
            if (view.status === "waiting_input") view.status = "pending";
            this.wake(l);
          };
          const onAbort = () => {
            settle();
            reject(new Error("Login cancelled"));
          };
          if (signal.aborted) return onAbort();
          signal.addEventListener("abort", onAbort, { once: true });
          l.answer = (value) => {
            settle();
            resolve(value);
          };
          view.status = "waiting_input";
          view.prompt = { message: q.message, placeholder: q.placeholder };
          this.wake(l);
        });
      },
    };
    this.logins.set(view.id, l);
    l.done = this.pi.login(providerId, "oauth", interaction, { getDeviceId: () => this.deviceId() }).then(
      () => {
        view.status = "done";
        log("brain", `${providerId}: signed in with an account`);
        if (providerId === ANTIGRAVITY) this.refreshAntigravity();
      },
      (e: Error) => {
        view.status = "error";
        view.error = (abort.signal.aborted ? (abort.signal.reason as Error).message : e.message).slice(0, 300);
      },
    );
    void l.done.finally(() => {
      delete view.prompt;
      this.wake(l);
    });
    const deadline = Date.now() + 15_000;
    while (!view.url && !view.user_code && view.status === "pending" && Date.now() < deadline) await this.changed(l, deadline - Date.now());
    return { ...view };
  }

  private login(id: string): Login {
    const l = this.logins.get(id);
    if (!l) throw new Error("login session expired or unknown");
    return l;
  }

  loginStatus(id: string): OAuthSession {
    return { ...this.login(id).view };
  }

  /** The code or redirect URL pasted by the admin; waits briefly for the outcome. */
  async loginInput(id: string, value: string): Promise<OAuthSession> {
    const l = this.login(id);
    if (!l.answer) throw new Error("this login is not waiting for input");
    l.answer(value.trim());
    const deadline = Date.now() + 10_000;
    while (l.view.status === "pending" && Date.now() < deadline) await this.changed(l, deadline - Date.now());
    return { ...l.view };
  }

  cancelLogin(id: string): void {
    const l = this.login(id);
    clearTimeout(l.timer);
    l.abort.abort(new Error("Login cancelled"));
    this.logins.delete(id);
  }

  /** One tiny real request, to tell the user right away whether a key and model work. */
  async test(providerId: string, model?: string): Promise<{ ok: boolean; model?: string; ms: number; detail: string }> {
    const started = Date.now();
    try {
      let id = model;
      if (!id && this.opts.model?.startsWith(`${providerId}/`)) id = this.opts.model;
      if (!id) {
        const e = this.endpoints.get(providerId);
        const first = e ? (await this.endpointModels(e, 5000))[0] : (await this.pi.getAvailable(providerId))[0]?.id;
        if (!first) throw new Error(`no model found for ${providerId}`);
        id = `${providerId}/${first}`;
      }
      const m = this.resolveModel(id.includes("/") ? id : `${providerId}/${id}`);
      const reply = await this.pi.completeSimple(m, { messages: [{ role: "user", content: "Reply with exactly: OK", timestamp: Date.now() }] } as never, {
        maxTokens: 64,
        signal: AbortSignal.timeout(30_000),
      });
      const text = reply.content
        .flatMap((c) => (c.type === "text" ? [c.text] : []))
        .join("")
        .trim();
      const ok = reply.stopReason === "stop" || reply.stopReason === "length";
      return {
        ok,
        model: `${m.provider}/${m.id}`,
        ms: Date.now() - started,
        detail: ok ? `replied "${text.slice(0, 40)}"` : (reply.errorMessage ?? reply.stopReason),
      };
    } catch (e) {
      return { ok: false, ms: Date.now() - started, detail: (e as Error).message };
    }
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
        initialState: { systemPrompt: piSystemPrompt(job.schema), model: this.resolveModel(), thinkingLevel: this.thinking, tools: brainTools(engine) },
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
