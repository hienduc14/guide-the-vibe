// Local daemon on each dev machine. Agents' hooks call it; it decides from a cached copy of each
// project's team state (pushed by the server over SSE), forwards events asynchronously, drains the
// inbox into agents and pushes WIP snapshots.

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { daemonUrl, loadRepos, tokenFingerprint, type DaemonConfig } from "./config.ts";
import { GTV_VERSION, agentVersions, setupState } from "./install.ts";
import { ServerClient } from "./client.ts";
import { normalize, toRepoPaths, formatOutput, type NormalizedHook } from "./hooks.ts";
import { decidePreEdit, messagesFor, statusline, type LocalSession } from "./decide.ts";
import { bundleSnapshot, forgetSnapshot, snapshotWorktree } from "./snapshot.ts";
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
  /** workspace id → last time an agent used it (hook or tool call) */
  private usedAt = new Map<string, number>();
  private snapTickTimer?: NodeJS.Timeout;
  private waiters = new Set<{ key: string; resolve: () => void }>();
  private waitTokens = new Map<string, symbol>();
  private sendChain: Promise<unknown> = Promise.resolve();
  private healthTimer?: NodeJS.Timeout;
  private reportTimer?: NodeJS.Timeout;
  /** Agent sessions the server refused (not a member): told once, then left alone. */
  private refused = new Set<string>();
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
    void this.reportDevice();
    this.reportTimer = setInterval(() => void this.reportDevice(), 6 * 3600_000);
    this.reportTimer.unref();
    this.snapTickTimer = setInterval(() => this.snapshotTick(), 60_000);
    this.snapTickTimer.unref();
  }

  /** Tells the server what this computer has (My computers): gtv version, agents, and the repos where gtv is on. */
  async reportDevice(): Promise<void> {
    if (!this.cfg.token) return;
    const daemon = daemonUrl(this.cfg);
    const repos = loadRepos().map((r) => ({ ...r, agents: (["claude", "codex"] as const).filter((a) => setupState(r.path, a, daemon) !== "missing") }));
    await this.client
      .call("POST", "/v1/me/device", { gtv_version: GTV_VERSION, agents: await agentVersions(), repos })
      .catch((e: Error) => log("daemon", `computer report failed: ${e.message}`));
  }

  async stop(): Promise<void> {
    clearInterval(this.healthTimer);
    clearInterval(this.reportTimer);
    for (const p of this.projects.values()) p.stop();
    for (const t of this.snapshotTimers.values()) clearTimeout(t);
    clearInterval(this.snapTickTimer);
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
    this.link(ws.project); // after the server accepted us: a refused computer must not keep a stream retrying
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
    this.usedAt.set(ws.id, Date.now());
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
        const ref = `refs/gtv/${this.cfg.dev}/${ws.id}`;
        try {
          // Sent to the gtv server as a bundle: no push rights to the team's remote are needed.
          const snap = await snapshotWorktree(ws.top, ref, { remote: this.cfg.remote, push: false });
          if (!snap?.changed) return;
          await this.uploadSnapshot(ws, snap.sha, snap.branch);
          log("daemon", `snapshot ${snap.sha.slice(0, 8)} sent for ${ws.project}/${ws.label}`);
        } catch (e) {
          forgetSnapshot(ws.top, ref); // try again next time even if nothing changes meanwhile
          log("daemon", `snapshot failed for ${ws.label}: ${(e as Error).message}`);
        }
      }, delayMs),
    );
  }

  private async uploadSnapshot(ws: WorkspaceInfo, sha: string, branch: string | undefined): Promise<void> {
    const q = new URLSearchParams({ workspace_id: ws.id, sha, ...(branch ? { branch } : {}) });
    const path = `/v1/p/${encodeURIComponent(ws.project)}/snapshot?${q}`;
    try {
      await this.client.upload(path, await bundleSnapshot(ws.top, sha, { remote: this.cfg.remote }));
    } catch (e) {
      // The server lacks commits the bundle builds on: send the whole history once.
      if ((e as { status?: number }).status !== 409) throw e;
      await this.client.upload(path, await bundleSnapshot(ws.top, sha, { remote: this.cfg.remote, full: true }));
    }
  }

  /** Workspaces an agent used in the last two hours get a snapshot every minute: agents without edit hooks (Codex on
   * some setups, edits made with shell commands) still show what they changed. Unchanged trees are not sent. */
  private snapshotTick(): void {
    const recent = Date.now() - 2 * 3600_000;
    for (const ws of this.workspaces.all()) if ((this.usedAt.get(ws.id) ?? 0) > recent) this.scheduleSnapshot(ws, 0);
  }

  // ---- hooks ------------------------------------------------------------------------------

  async handleHook(agent: AgentKind, raw: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const h = normalize(agent, raw);
    const ws = await this.workspaces.get(h.cwd);
    if (!ws) return undefined; // not a gtv project: stay out of the way
    const key = `${agent}:${h.agentSessionId}`;
    if (this.refused.has(key)) return undefined;
    let ctx: Awaited<ReturnType<Daemon["ensureSession"]>>;
    try {
      ctx = await this.ensureSession(agent, h.agentSessionId, ws, h.cwd);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) {
        // Not a member (or only a viewer) of this project: say so once in this agent session, then stay quiet.
        const out = formatOutput(h, { decision: "allow", context: `[gtv] ${err.message} Until then gtv does not coordinate this session.` });
        if (out) {
          this.refused.add(key);
          log("daemon", `refused in ${ws.project}: ${err.message}`);
        }
        return out;
      }
      log("daemon", `server unreachable, allowing: ${err.message}`);
      return undefined; // fail open
    }
    this.lastActive.set(`${agent}|${ws.id}`, `${agent}:${h.agentSessionId}`);
    this.usedAt.set(ws.id, Date.now());
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
        this.send(ws.project, { type: "stop", session_id: s.id });
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
    /** gtv on / off changed the repos: report them now. */
    app.post("/device", async (c) => {
      await this.reportDevice();
      return c.json({ ok: true });
    });
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
        pid: process.pid,
        token: tokenFingerprint(this.cfg.token),
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
