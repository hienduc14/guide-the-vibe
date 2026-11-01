// Local daemon on each dev machine. Agents' hooks call it; it decides from a cached copy of each
// project's team state (pushed by the server over SSE), forwards events asynchronously, drains the
// inbox into agents and pushes WIP snapshots.

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { DaemonConfig } from "./config.ts";
import { ServerClient } from "./client.ts";
import { normalize, toRepoPaths, formatOutput, type NormalizedHook } from "./hooks.ts";
import { decidePreEdit, messagesFor, statusline, type LocalSession } from "./decide.ts";
import { snapshotWorktree } from "./snapshot.ts";
import { desktopNotify } from "./notify.ts";
import { Workspaces, type WorkspaceInfo } from "./workspace.ts";
import { runTool, describeStatus } from "./tools.ts";
import type { AgentKind, GtvEvent, HookDecision, Message, Session, TeamState } from "../shared/types.ts";
import { AGENT_CAPABILITIES } from "../shared/types.ts";
import { log } from "../shared/util.ts";

interface ProjectLink {
  state?: TeamState;
  connected: boolean;
  stop: () => void;
}

export class Daemon {
  readonly cfg: DaemonConfig;
  readonly client: ServerClient;
  readonly workspaces: Workspaces;
  serverReachable = false;
  inbox = new Map<string, Message & { project: string }>();
  humanInbox = new Map<string, Message & { project: string }>();
  private projects = new Map<string, ProjectLink>();
  private sessions = new Map<string, LocalSession & { project: string }>();
  private lastActive = new Map<string, string>(); // `${agent}|${ws}` -> session key
  private snapshotTimers = new Map<string, NodeJS.Timeout>();
  private waiters = new Set<{ key: string; resolve: () => void }>();
  private waitTokens = new Map<string, symbol>();
  private sendChain: Promise<unknown> = Promise.resolve();
  private healthTimer?: NodeJS.Timeout;
  private server?: ReturnType<typeof serve>;

  constructor(cfg: DaemonConfig) {
    this.cfg = cfg;
    this.client = new ServerClient(cfg);
    this.workspaces = new Workspaces(cfg.dev, cfg.remote, async (url) => {
      try {
        return (await this.client.call<{ id: string }>("GET", `/v1/resolve?remote=${encodeURIComponent(url)}`)).id;
      } catch {
        return undefined;
      }
    });
  }

  // ---- lifecycle --------------------------------------------------------------------

  async start(): Promise<void> {
    const ping = async () => {
      const ok = await this.client.call("GET", "/health", undefined, 3000).then(
        () => true,
        () => false,
      );
      if (ok !== this.serverReachable) log("daemon", ok ? `server ${this.cfg.server} reachable` : `server ${this.cfg.server} unreachable`);
      this.serverReachable = ok;
    };
    await ping();
    this.healthTimer = setInterval(() => void ping(), 15_000);
    this.healthTimer.unref();
    const app = this.routes();
    await new Promise<void>((resolve) => {
      this.server = serve({ fetch: app.fetch, port: this.cfg.port, hostname: "127.0.0.1" }, () => resolve());
    });
    log("daemon", `gtv daemon for ${this.cfg.dev} on 127.0.0.1:${this.cfg.port} → ${this.cfg.server}`);
  }

  async stop(): Promise<void> {
    clearInterval(this.healthTimer);
    for (const p of this.projects.values()) p.stop();
    for (const t of this.snapshotTimers.values()) clearTimeout(t);
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }

  /** Subscribe to a project's state/inbox stream the first time one of its workspaces is used. */
  private link(project: string): ProjectLink {
    let link = this.projects.get(project);
    if (link) return link;
    const l: ProjectLink = { connected: false, stop: () => undefined };
    l.stop = this.client.subscribe(
      `/v1/p/${project}/stream`,
      (event, data) => this.onServerEvent(project, event, data),
      (ok) => {
        if (ok !== l.connected) log("daemon", `${ok ? "connected to" : "disconnected from"} project ${project}`);
        l.connected = ok;
      },
    );
    this.projects.set(project, l);
    return l;
  }

  stateOf(project: string): TeamState | undefined {
    return this.projects.get(project)?.state;
  }

  connectedTo(project: string): boolean {
    return !!this.projects.get(project)?.connected;
  }

  private onServerEvent(project: string, event: string, data: string): void {
    const link = this.projects.get(project);
    if (!link) return;
    if (event === "state") {
      link.state = JSON.parse(data) as TeamState;
      return;
    }
    if (event !== "message") return;
    const m = { ...(JSON.parse(data) as Message), project };
    if (m.delivered_at || this.inbox.has(m.id) || this.humanInbox.has(m.id)) return;
    const notify = link.state?.features["notify.desktop"] === "on";
    if (m.kind === "human_request") {
      this.humanInbox.set(m.id, m);
      if (notify) desktopNotify(`gtv (${project}): a teammate needs your decision`, m.body);
    } else {
      this.inbox.set(m.id, m);
      if (notify && m.kind === "conflict" && /\[gtv (HIGH|CRITICAL)/.test(m.body)) desktopNotify(`gtv conflict (${project})`, m.body);
    }
    for (const w of [...this.waiters]) w.resolve();
  }

  // ---- sessions -----------------------------------------------------------------------

  private async ensureSession(agent: AgentKind, agentSessionId: string, ws: WorkspaceInfo, cwd: string) {
    const key = `${agent}:${agentSessionId}`;
    const known = this.sessions.get(key);
    if (known) return { session: known, briefing: undefined as string | undefined };
    this.link(ws.project);
    const res = await this.client.call<{ results: { session: Session; briefing: string }[] }>("POST", `/v1/p/${ws.project}/events`, {
      type: "session_start",
      session: {
        dev: this.cfg.dev,
        agent,
        agent_session_id: agentSessionId,
        workspace_id: ws.id,
        workspace_label: `${ws.label}${ws.branch ? `@${ws.branch}` : ""}`,
        cwd,
        branch: ws.branch,
      },
    } satisfies GtvEvent);
    const s = res.results[0].session;
    const session = {
      id: s.id,
      dev: s.dev,
      agent,
      workspace_id: ws.id,
      project: ws.project,
      capabilities: AGENT_CAPABILITIES[agent] ?? AGENT_CAPABILITIES.other,
      seen: new Set<string>(),
    };
    this.sessions.set(key, session);
    return { session, briefing: res.results[0].briefing };
  }

  /** Session used by tool calls: the most recently active hook session of this agent in this workspace. */
  private async sessionForTool(agent: AgentKind, cwd: string) {
    const ws = await this.workspaces.get(cwd);
    if (!ws) throw new Error(`${cwd} is not a git repository linked to a gtv project (run: gtv link <project>)`);
    const key = this.lastActive.get(`${agent}|${ws.id}`) ?? [...this.lastActive.entries()].find(([k]) => k.endsWith(`|${ws.id}`))?.[1];
    const s = key ? this.sessions.get(key) : undefined;
    if (s) return { session: s, ws };
    return { session: (await this.ensureSession(agent, `mcp-${agent}-${ws.id}`, ws, cwd)).session, ws };
  }

  private send(project: string, ev: GtvEvent): void {
    this.sendChain = this.sendChain
      .then(() => this.client.call("POST", `/v1/p/${project}/events`, ev))
      .catch((e) => log("daemon", `event ${ev.type} not delivered: ${(e as Error).message}`));
  }

  private drain(s: LocalSession & { project: string }): string | undefined {
    const msgs = messagesFor(
      [...this.inbox.values()].filter((m) => m.project === s.project),
      s,
    );
    if (!msgs.length) return undefined;
    for (const m of msgs) this.inbox.delete(m.id);
    this.client.call("POST", `/v1/p/${s.project}/messages/ack`, { ids: msgs.map((m) => m.id) }).catch(() => undefined);
    return msgs.map((m) => m.body).join("\n\n");
  }

  scheduleSnapshot(ws: WorkspaceInfo, delayMs = this.cfg.snapshotDebounceMs): void {
    clearTimeout(this.snapshotTimers.get(ws.id));
    this.snapshotTimers.set(
      ws.id,
      setTimeout(async () => {
        try {
          const snap = await snapshotWorktree(ws.top, `refs/gtv/${this.cfg.dev}/${ws.id}`, { remote: this.cfg.remote });
          if (snap?.pushed) {
            log("daemon", `snapshot ${snap.sha.slice(0, 8)} pushed for ${ws.project}/${ws.label}`);
            this.send(ws.project, { type: "snapshot", workspace_id: ws.id, sha: snap.sha, branch: snap.branch });
          }
        } catch (e) {
          log("daemon", `snapshot failed for ${ws.label}: ${(e as Error).message}`);
        }
      }, delayMs),
    );
  }

  // ---- hooks ------------------------------------------------------------------------------

  async handleHook(agent: AgentKind, raw: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const h = normalize(agent, raw);
    const ws = await this.workspaces.get(h.cwd);
    if (!ws) return undefined; // not a gtv project: stay out of the way
    let ctx: Awaited<ReturnType<Daemon["ensureSession"]>>;
    try {
      ctx = await this.ensureSession(agent, h.agentSessionId, ws, h.cwd);
    } catch (e) {
      log("daemon", `server unreachable, allowing: ${(e as Error).message}`);
      return undefined; // fail open
    }
    this.lastActive.set(`${agent}|${ws.id}`, `${agent}:${h.agentSessionId}`);
    return formatOutput(h, this.decide(h, ctx.session, ws, ctx.briefing));
  }

  private decide(h: NormalizedHook, s: LocalSession & { project: string }, ws: WorkspaceInfo, briefing?: string): HookDecision {
    const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join("\n\n") || undefined;
    switch (h.kind) {
      case "session_start":
        return { decision: "allow", context: join(briefing, this.drain(s)) };
      case "prompt":
        this.send(ws.project, { type: "prompt", session_id: s.id, prompt: h.prompt ?? "" });
        return { decision: "allow", context: this.drain(s) };
      case "plan":
        if (h.plan) this.send(ws.project, { type: "plan", session_id: s.id, plan: h.plan });
        return { decision: "allow", context: this.drain(s) };
      case "pre_edit": {
        const paths = toRepoPaths(h.paths, h.cwd, ws.top);
        if (!paths.length) return { decision: "allow", context: this.drain(s) };
        const d = decidePreEdit(this.stateOf(ws.project), s, paths);
        this.send(ws.project, { type: "edit", session_id: s.id, paths, phase: "pre" });
        return { ...d, context: join(d.context, this.drain(s)) };
      }
      case "post_tool": {
        const paths = toRepoPaths(h.paths, h.cwd, ws.top);
        if (paths.length) {
          this.send(ws.project, { type: "edit", session_id: s.id, paths, phase: "post" });
          this.scheduleSnapshot(ws);
        }
        return { decision: "allow", context: this.drain(s) };
      }
      case "stop":
        this.scheduleSnapshot(ws, 2000);
        return { decision: "allow" };
      case "session_end":
        this.scheduleSnapshot(ws, 1000);
        this.send(ws.project, { type: "session_end", session_id: s.id });
        return { decision: "allow" };
      default:
        return { decision: "allow", context: this.drain(s) };
    }
  }

  /** Long-poll used by Claude's asyncRewake hook: resolves when a message for the session arrives. */
  async waitForMessages(agent: AgentKind, agentSessionId: string, timeoutMs: number): Promise<string | undefined> {
    const s = this.sessions.get(`${agent}:${agentSessionId}`);
    if (!s) return undefined;
    // Each Stop hook starts a new waiter; only the newest one per session stays alive.
    const token = Symbol();
    this.waitTokens.set(s.id, token);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && this.waitTokens.get(s.id) === token) {
      const text = this.drain(s);
      if (text) return text;
      for (const w of [...this.waiters]) if (w.key === s.id) w.resolve(); // wake the superseded waiter so it exits
      await new Promise<void>((resolve) => {
        const w = { key: s.id, resolve: () => (this.waiters.delete(w), resolve()) };
        this.waiters.add(w);
        setTimeout(w.resolve, Math.min(30_000, deadline - Date.now()));
      });
    }
    return undefined;
  }

  async tool(agent: AgentKind, cwd: string, name: string, args: Record<string, unknown>): Promise<string> {
    const { session, ws } = await this.sessionForTool(agent, cwd);
    return runTool(
      {
        client: this.client,
        session,
        ws,
        state: this.stateOf(ws.project),
        serverUrl: this.cfg.server,
        drain: () => this.drain(session),
        snapshotSoon: () => this.scheduleSnapshot(ws, 500),
      },
      name,
      args,
    );
  }

  // ---- HTTP -------------------------------------------------------------------------------

  private routes(): Hono {
    const app = new Hono();
    app.use("*", async (c, next) => {
      // Local, non-browser callers only: a foreign Host means DNS rebinding, an Origin header means a web page.
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(c.req.header("host") ?? "") || c.req.header("origin")) return c.body(null, 403);
      await next();
    });
    app.onError((err, c) => c.json({ error: err.message }, 500));
    app.post("/hook/:agent", async (c) => {
      const agent = c.req.param("agent") as AgentKind;
      try {
        const out = await this.handleHook(agent, await c.req.json());
        return out ? c.json(out) : c.body(null, 200);
      } catch (e) {
        log("daemon", `hook error (${agent}): ${(e as Error).message}`);
        return c.body(null, 200); // never block the agent because of gtv
      }
    });
    app.get("/wait", async (c) => {
      const text = await this.waitForMessages(c.req.query("agent") as AgentKind, c.req.query("session") ?? "", Number(c.req.query("timeout") ?? 1_800_000));
      return c.json({ text: text ?? null });
    });
    app.post("/api/:tool", async (c) => {
      const body = (await c.req.json()) as { agent: AgentKind; cwd: string; args?: Record<string, unknown> };
      return c.json({ text: await this.tool(body.agent ?? "other", body.cwd, c.req.param("tool"), body.args ?? {}) });
    });
    app.get("/statusline", async (c) => {
      const cwd = c.req.query("cwd");
      const ws = cwd ? await this.workspaces.get(cwd) : undefined;
      if (!ws) return c.text(this.serverReachable ? "gtv · repo not linked" : "gtv ○ offline");
      const pending =
        [...this.inbox.values()].filter((m) => m.project === ws.project && (m.to_workspace === ws.id || (!m.to_workspace && !m.to_session))).length +
        this.humanInbox.size;
      return c.text(statusline(this.stateOf(ws.project), { dev: this.cfg.dev, workspace_id: ws.id }, pending, this.connectedTo(ws.project)));
    });
    app.get("/status", async (c) => {
      const cwd = c.req.query("cwd");
      const ws = cwd ? await this.workspaces.get(cwd) : undefined;
      if (!ws)
        return c.text(
          `gtv daemon for ${this.cfg.dev}: ${cwd ?? "?"} is not linked to a project. Linked projects: ${[...this.projects.keys()].join(", ") || "none"}`,
        );
      this.link(ws.project);
      return c.text(describeStatus(this.stateOf(ws.project), this.cfg.server, this.cfg.dev, ws));
    });
    app.get("/human-inbox", (c) => c.json([...this.humanInbox.values()]));
    app.post("/snapshot", async (c) => {
      const { cwd } = (await c.req.json()) as { cwd: string };
      const ws = await this.workspaces.get(cwd);
      if (!ws) throw new Error("not a git repository linked to a gtv project");
      this.scheduleSnapshot(ws, 0);
      return c.json({ ok: true, project: ws.project, workspace: ws.id });
    });
    app.get("/health", (c) =>
      c.json({
        ok: true,
        dev: this.cfg.dev,
        server: this.cfg.server,
        reachable: this.serverReachable,
        projects: Object.fromEntries([...this.projects].map(([id, l]) => [id, l.connected])),
        sessions: this.sessions.size,
        inbox: this.inbox.size,
      }),
    );
    return app;
  }
}
