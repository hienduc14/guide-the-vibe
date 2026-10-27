// Brain backed by an OpenCode server (`opencode serve`), logged in with a ChatGPT plan.
// Each project gets its own MCP server registered at runtime (gtv_<project> → /p/<project>/mcp);
// every job runs in a fresh OpenCode session with only that project's tools enabled.

import { BrainUnavailable, Semaphore, type BrainJob, type BrainResult } from "./types.ts";
import type { ProjectScopedBackend } from "./metered.ts";
import { OPERATOR_SYSTEM } from "./prompts.ts";
import { log } from "../../shared/util.ts";

export interface OpenCodeOptions {
  url: string;
  password?: string;
  username?: string;
  model?: string; // "provider/model", e.g. "openai/gpt-6-luna"
  agent?: string;
  concurrency?: number;
  timeoutMs?: number;
  /** How OpenCode reaches the Operator (inside docker: http://operator:7390). */
  operatorUrl?: string;
  operatorToken?: string;
}

export const mcpServerName = (project: string) => `gtv_${project.replace(/[^a-zA-Z0-9]/g, "_")}`;

export class OpenCodeBrain implements ProjectScopedBackend {
  readonly name = "opencode";
  private readonly opts: OpenCodeOptions;
  private readonly sem: Semaphore;
  private registered = new Set<string>();

  constructor(opts: OpenCodeOptions) {
    this.opts = opts;
    this.sem = new Semaphore(opts.concurrency ?? 2);
  }

  get model(): string | undefined {
    return this.opts.model;
  }

  setModel(model: string | undefined): void {
    this.opts.model = model || undefined;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.opts.password) {
      h.authorization = "Basic " + Buffer.from(`${this.opts.username ?? "opencode"}:${this.opts.password}`).toString("base64");
    }
    return h;
  }

  private async call(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15_000);
    try {
      const res = await fetch(this.opts.url.replace(/\/$/, "") + path, { ...init, headers: this.headers(), signal: ctrl.signal });
      const text = await res.text();
      if (!res.ok) throw new Error(`opencode ${init.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const h = (await this.call("/global/health", { timeoutMs: 3000 })) as { healthy?: boolean; version?: string };
      return { ok: !!h?.healthy, detail: h?.version ? `opencode ${h.version}` : undefined };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  /** Models OpenCode can use with the current login (for the dashboard picker). */
  async models(provider = "openai"): Promise<string[]> {
    const res = (await this.call("/provider", { timeoutMs: 5000 })) as { all?: { id: string; models: Record<string, unknown> }[]; connected?: string[] };
    const p = res.all?.find((x) => x.id === provider);
    return p ? Object.keys(p.models).map((m) => `${provider}/${m}`) : [];
  }

  async prepareProject(project: string): Promise<void> {
    if (this.registered.has(project) || !this.opts.operatorUrl) return;
    const headers: Record<string, string> = {};
    if (this.opts.operatorToken) headers.Authorization = `Bearer ${this.opts.operatorToken}`;
    try {
      await this.call("/mcp", {
        method: "POST",
        body: JSON.stringify({
          name: mcpServerName(project),
          config: {
            type: "remote",
            url: `${this.opts.operatorUrl.replace(/\/$/, "")}/p/${project}/mcp`,
            enabled: true,
            oauth: false,
            timeout: 10_000,
            headers,
          },
        }),
      });
    } catch (e) {
      // OpenCode outlives Operator restarts: an existing registration is fine.
      const status = (await this.call("/mcp").catch(() => ({}))) as Record<string, unknown>;
      if (!status[mcpServerName(project)]) throw e;
    }
    this.registered.add(project);
    log("brain", `registered MCP server ${mcpServerName(project)} for project ${project}`);
  }

  run<T>(job: BrainJob): Promise<BrainResult<T>> {
    return this.sem.use(async () => {
      const started = Date.now();
      let sessionId: string | undefined;
      try {
        const session = (await this.call("/session", { method: "POST", body: JSON.stringify({ title: `gtv ${job.project ?? ""} ${job.kind}` }) })) as {
          id: string;
        };
        sessionId = session.id;
        const body: Record<string, unknown> = {
          parts: [{ type: "text", text: job.prompt }],
          system: OPERATOR_SYSTEM,
          format: { type: "json_schema", schema: job.schema, retryCount: 1 },
        };
        // Only this project's gtv tools: later rules win, so disable all gtv servers first.
        if (job.project) body.tools = { "gtv_*": false, [`${mcpServerName(job.project)}_*`]: true };
        if (this.opts.agent) body.agent = this.opts.agent;
        if (this.opts.model) {
          const [providerID, ...rest] = this.opts.model.split("/");
          body.model = { providerID, modelID: rest.join("/") };
        }
        const res = (await this.call(`/session/${sessionId}/message`, {
          method: "POST",
          body: JSON.stringify(body),
          timeoutMs: job.timeoutMs ?? this.opts.timeoutMs ?? 120_000,
        })) as { info?: { structured?: unknown; error?: { name?: string; data?: { message?: string } } }; parts?: { type: string; text?: string }[] };
        if (res.info?.error) throw new Error(`opencode error ${res.info.error.name}: ${res.info.error.data?.message ?? ""}`);
        let output = res.info?.structured as T | undefined;
        if (output === undefined) {
          const text =
            res.parts
              ?.filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("\n") ?? "";
          const m = /\{[\s\S]*\}/.exec(text);
          if (!m) throw new Error("brain returned no structured output");
          output = JSON.parse(m[0]) as T;
        }
        return { output, ms: Date.now() - started, backend: this.name };
      } catch (e) {
        if ((e as Error).name === "AbortError") throw new BrainUnavailable(`brain timed out after ${Date.now() - started}ms`);
        if ((e as { cause?: { code?: string } }).cause?.code === "ECONNREFUSED") throw new BrainUnavailable("opencode server not reachable");
        throw e;
      } finally {
        if (sessionId) this.call(`/session/${sessionId}`, { method: "DELETE" }).catch((e) => log("brain", "session cleanup failed", (e as Error).message));
      }
    });
  }
}
