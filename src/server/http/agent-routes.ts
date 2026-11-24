// Project-scoped API used by daemons, agents (through the daemon) and the CLI: mounted at /v1/p/:project.

import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { ProjectRuntime } from "../project/runtime.ts";
import type { AuthVars } from "./auth.ts";
import type { FeatureMode, GtvEvent, Message, Session, TaskRegistration, TaskResource } from "../../shared/types.ts";
import { BASE } from "../../codeintel/graph.ts";
import { callMap, structureMap } from "../../codeintel/map.ts";
import { FEATURES } from "../../shared/features.ts";
import { globMatch, newId, normPath } from "../../shared/util.ts";

export type ProjectEnv = { Variables: AuthVars & { rt: ProjectRuntime } };
type Ctx = Context<ProjectEnv>;

const sessionOf = (c: Ctx, id: string | undefined): Session => {
  const s = id ? c.get("rt").engine.store.session(id) : undefined;
  if (!s || (s.dev !== c.get("dev") && !c.get("admin"))) throw new Error(`unknown session ${id}`);
  return s;
};

export function agentRoutes(): Hono<ProjectEnv> {
  const app = new Hono<ProjectEnv>();

  // ---- events & state ---------------------------------------------------------------

  app.post("/events", async (c) => {
    const { engine } = c.get("rt");
    const body = (await c.req.json()) as { events?: GtvEvent[] } | GtvEvent;
    const events = "events" in body && body.events ? body.events : [body as GtvEvent];
    const results = [];
    for (const ev of events) {
      const wsId = ev.type === "snapshot" ? ev.workspace_id : ev.type === "session_start" ? ev.session.workspace_id : undefined;
      const ws = wsId ? engine.store.workspace(wsId) : undefined;
      if (ws && ws.dev !== c.get("dev") && !c.get("admin")) throw new Error(`unknown workspace ${wsId}`);
      if ("session_id" in ev) sessionOf(c, ev.session_id);
      results.push(await engine.handle(c.get("dev"), ev));
    }
    return c.json({ results });
  });

  app.get("/state", (c) => c.json(c.get("rt").engine.store.teamState()));

  app.get("/stream", (c) => {
    const { store } = c.get("rt").engine;
    const dev = c.get("dev");
    return streamSSE(c, async (stream) => {
      let timer: NodeJS.Timeout | undefined;
      const sendState = () => {
        clearTimeout(timer);
        timer = setTimeout(() => void stream.writeSSE({ event: "state", data: JSON.stringify(store.teamState()) }), 150);
      };
      const onMessage = (m: Message) => {
        if (m.to_dev === dev) void stream.writeSSE({ event: "message", data: JSON.stringify(m) });
      };
      store.on("change", sendState);
      store.on("message", onMessage);
      await stream.writeSSE({ event: "state", data: JSON.stringify(store.teamState()) });
      for (const m of store.pendingMessages(dev)) await stream.writeSSE({ event: "message", data: JSON.stringify(m) });
      const ping = setInterval(() => void stream.writeSSE({ event: "ping", data: String(Date.now()) }), 15_000);
      await new Promise<void>((resolve) => stream.onAbort(resolve));
      clearInterval(ping);
      clearTimeout(timer);
      store.off("change", sendState);
      store.off("message", onMessage);
    });
  });

  app.post("/messages/ack", async (c) => {
    const { ids } = (await c.req.json()) as { ids: string[] };
    c.get("rt").engine.store.markDelivered(ids ?? []);
    return c.json({ ok: true });
  });

  app.get("/messages", (c) => c.json(c.get("rt").engine.store.pendingMessages(c.get("dev"))));

  // ---- tasks ------------------------------------------------------------------------

  app.post("/tasks", async (c) => {
    const { engine } = c.get("rt");
    const body = (await c.req.json()) as { session_id: string } & TaskRegistration;
    const session = sessionOf(c, body.session_id);
    if (!body.title) throw new Error("title is required");
    return c.json(
      await engine.register(session, { title: body.title, goal: body.goal, base_sha: body.base_sha, resources: body.resources ?? [], board_id: body.board_id }),
    );
  });

  app.patch("/tasks/:id", async (c) => {
    const { engine } = c.get("rt");
    const body = (await c.req.json()) as {
      title?: string;
      goal?: string;
      resources?: TaskResource[];
      add_resources?: TaskResource[];
      status?: "done" | "abandoned" | "pr_open";
    };
    const t = engine.store.task(c.req.param("id"));
    if (!t || (t.dev !== c.get("dev") && !c.get("admin"))) throw new Error("unknown task");
    const resources =
      body.resources ??
      (body.add_resources ? [...t.resources, ...body.add_resources.map((r) => ({ ...r, value: r.kind === "path" ? normPath(r.value) : r.value }))] : undefined);
    const next = engine.store.updateTask(t.id, { title: body.title, goal: body.goal, resources, status: body.status } as never);
    if (body.status === "done" || body.status === "abandoned") engine.tasksClosed([t.id]);
    else engine.runL0();
    if (body.status && body.status !== t.status) engine.board.onRegistrationClosed(t, body.status);
    return c.json(next);
  });

  // ---- task board ------------------------------------------------------------------------

  app.get("/board", (c) => {
    const { board } = c.get("rt").engine;
    const scope = c.req.query("scope"); // open (default) | all | mine
    if (scope === "mine") return c.json(board.list({ open: true, assignee: c.get("dev") }));
    return c.json(board.list({ open: scope !== "all" }));
  });
  app.post("/board", async (c) => c.json(c.get("rt").engine.board.create(await c.req.json(), c.get("dev"))));
  app.get("/board/:id", (c) => {
    const { board } = c.get("rt").engine;
    const t = board.get(c.req.param("id"));
    if (!t) return c.json({ error: "not found" }, 404);
    return c.json({ ...board.view(t), notes: board.notes(t.id), registrations: board.registrations(t.id) });
  });
  app.patch("/board/:id", async (c) => c.json(c.get("rt").engine.board.update(c.req.param("id"), await c.req.json(), c.get("dev"))));
  app.delete("/board/:id", (c) => {
    c.get("rt").engine.board.remove(c.req.param("id"), c.get("dev"));
    return c.json({ ok: true });
  });
  app.post("/board/:id/notes", async (c) => {
    const { board } = c.get("rt").engine;
    const { body } = (await c.req.json()) as { body?: string };
    if (!board.get(c.req.param("id"))) throw new Error("unknown board task");
    return c.json(board.note(c.req.param("id"), c.get("dev"), "note", String(body ?? "")));
  });
  /** An agent takes an item (gtv_pick_task). */
  app.post("/board/:id/pick", async (c) => {
    const { engine } = c.get("rt");
    const { session_id } = (await c.req.json()) as { session_id: string };
    const t = engine.board.pick(c.req.param("id"), sessionOf(c, session_id));
    return c.json({ ...engine.board.view(t), notes: engine.board.notes(t.id) });
  });

  app.get("/members", (c) => c.json(c.get("rt").engine.store.members()));

  app.get("/tasks", (c) => c.json(c.get("rt").engine.store.activeTasks()));

  /** "Would touching these paths/symbols collide with someone?" (gtv_check) */
  app.post("/check", async (c) => {
    const { engine } = c.get("rt");
    const body = (await c.req.json()) as { session_id: string; paths?: string[]; symbols?: string[] };
    const session = sessionOf(c, body.session_id);
    const state = engine.store.teamState();
    const others = state.tasks.filter((t) => t.workspace_id !== session.workspace_id);
    const out: { kind: string; with: string; detail: string }[] = [];
    for (const raw of body.paths ?? []) {
      const p = normPath(raw);
      for (const f of state.footprints)
        if (f.workspace_id !== session.workspace_id && f.path === p) out.push({ kind: "editing", with: f.dev, detail: `${f.dev} is editing ${p}` });
      for (const t of others)
        for (const r of t.resources)
          if (r.kind === "path" && globMatch(r.value, p))
            out.push({ kind: "scope", with: t.dev, detail: `${p} is in the scope of ${t.dev}'s task "${t.title}"` });
    }
    for (const s of body.symbols ?? []) {
      const name = s.split(".").pop()!;
      for (const t of others)
        for (const r of t.resources)
          if (r.kind === "symbol" && r.value.split(".").pop() === name)
            out.push({ kind: "symbol", with: t.dev, detail: `${t.dev}'s task "${t.title}" declares ${r.op ?? "work on"} ${r.value}` });
      for (const w of state.workspaces) {
        if (w.id === session.workspace_id) continue;
        for (const ch of engine.db.all<{ symbol_id: string; change: string; new_sig: string | null }>(
          `SELECT symbol_id, change, new_sig FROM symbol_changes WHERE workspace_id = ? AND name = ?`,
          w.id,
          name,
        )) {
          out.push({
            kind: "wip_change",
            with: w.dev,
            detail: `${w.dev} has already ${ch.change.replace("_", " ")} ${ch.symbol_id}${ch.new_sig ? ` → ${ch.new_sig}` : ""} in their WIP`,
          });
        }
      }
    }
    return c.json({ clear: out.length === 0, findings: out });
  });

  // ---- tickets ------------------------------------------------------------------------

  app.post("/tickets", async (c) => {
    const { tickets } = c.get("rt");
    const body = (await c.req.json()) as { session_id: string; question: string; context?: string; to_dev?: string };
    const session = sessionOf(c, body.session_id);
    if (!body.question?.trim()) throw new Error("question is required");
    const t = await tickets.ask({ session, question: body.question, context: body.context, to_dev: body.to_dev });
    tickets.detach(t.id);
    return c.json({ ...t, formatted: t.answer ? tickets.formatAnswer(t) : undefined });
  });

  app.get("/tickets", (c) => {
    const { store } = c.get("rt").engine;
    const dev = c.get("dev");
    const scope = c.req.query("scope");
    if (scope === "for_me") return c.json(store.tickets({ status: ["forwarded", "waiting_human"], to_dev: dev }));
    if (scope === "mine") return c.json(store.tickets({ from_dev: dev }));
    return c.json(store.tickets());
  });

  app.get("/tickets/:id", (c) => c.json(c.get("rt").engine.store.ticket(c.req.param("id")) ?? { error: "not found" }));

  app.post("/tickets/:id/reply", async (c) => {
    const body = (await c.req.json()) as { answer: string; escalate?: boolean; session_id?: string };
    const dev = c.get("dev");
    const by = body.session_id ? `${dev}'s agent` : `${dev} (human)`;
    return c.json(c.get("rt").tickets.reply({ ticket_id: c.req.param("id"), answer: body.answer ?? "", by, escalate: body.escalate }));
  });

  // ---- conflicts ------------------------------------------------------------------------

  app.get("/conflicts", (c) => c.json(c.get("rt").engine.store.conflicts(c.req.query("all") ? "all" : "open")));

  app.post("/conflicts/:id/:action{ack|dismiss|reopen}", (c) => {
    const { store } = c.get("rt").engine;
    const status = ({ ack: "acked", dismiss: "dismissed", reopen: "open" } as const)[c.req.param("action") as "ack" | "dismiss" | "reopen"];
    const res = store.setConflictStatus(c.req.param("id"), status);
    if (!res) throw new Error("unknown conflict");
    store.logEvent(`conflict_${c.req.param("action")}`, c.get("dev"), { id: res.id });
    return c.json(res);
  });

  // ---- knowledge ------------------------------------------------------------------------

  app.get("/kb", (c) => {
    const { kb } = c.get("rt").engine;
    const q = c.req.query("q");
    if (q) return c.json(kb.search(q, { limit: Number(c.req.query("limit") ?? 8) }));
    if (c.req.query("core")) return c.json(kb.core().map(({ body, ...d }) => ({ ...d, size: body.length })));
    return c.json(kb.list({ type: c.req.query("type"), status: c.req.query("status") as never }));
  });

  app.post("/kb", async (c) => {
    const body = (await c.req.json()) as { title: string; body: string; type?: string; supersedes?: string; pinned?: boolean; path?: string };
    if (!body.title?.trim() || !body.body?.trim()) throw new Error("title and body are required");
    if (body.body.length > 400_000) throw new Error("document too large (max 400 000 characters): split it");
    const { engine } = c.get("rt");
    const doc = engine.kb.upsert({
      id: newId("manual"),
      type: body.type ?? "doc",
      title: body.title.trim(),
      body: body.body,
      status: "active",
      source: "manual",
      path: body.path, // the uploaded file's name, for reference
      supersedes: body.supersedes,
      pinned: body.pinned ? 1 : 0,
    });
    engine.store.logEvent("kb_add", c.get("dev"), { id: doc.id, title: doc.title, type: doc.type, pinned: !!doc.pinned });
    engine.store.changed();
    return c.json(doc);
  });

  app.patch("/kb/:id", async (c) => {
    const { engine } = c.get("rt");
    const doc = engine.kb.edit(c.req.param("id"), await c.req.json());
    if (!doc) throw new Error("unknown document");
    engine.store.logEvent("kb_edit", c.get("dev"), { id: doc.id, pinned: !!doc.pinned });
    engine.store.changed();
    return c.json(doc);
  });

  app.delete("/kb/:id", (c) => {
    const { engine } = c.get("rt");
    const doc = engine.kb.get(c.req.param("id"));
    if (!doc) throw new Error("unknown document");
    if (doc.source === "repo") throw new Error("this document comes from the repository: delete or change the file in git");
    engine.kb.remove(doc.id);
    engine.store.logEvent("kb_delete", c.get("dev"), { id: doc.id, title: doc.title });
    return c.json({ ok: true });
  });

  app.get("/kb/:id", (c) => c.json(c.get("rt").engine.kb.get(c.req.param("id")) ?? { error: "not found" }));

  app.post("/kb/:id/:action{confirm|reject}", (c) => {
    const { engine } = c.get("rt");
    const doc = engine.kb.setStatus(c.req.param("id"), c.req.param("action") === "confirm" ? "active" : "superseded");
    if (!doc) throw new Error("unknown document");
    engine.store.logEvent(`kb_${c.req.param("action")}`, c.get("dev"), { id: doc.id });
    return c.json(doc);
  });

  // ---- features & code graph ----------------------------------------------------------

  app.get("/features", (c) => {
    const { engine } = c.get("rt");
    return c.json({ modes: engine.features(), defs: FEATURES, tripped: engine.breaker.all() });
  });

  app.put("/features", async (c) => {
    const { engine } = c.get("rt");
    const body = (await c.req.json()) as { feature: string; mode: FeatureMode | null };
    engine.setFeature(body.feature, body.mode);
    engine.store.logEvent("feature_set", c.get("dev"), body);
    return c.json(engine.features());
  });

  app.get("/graph/symbols", (c) => c.json(c.get("rt").engine.graph.findSymbols(c.req.query("q") ?? "", c.req.query("view") ?? BASE)));
  app.get("/graph/callers", (c) => {
    const { graph } = c.get("rt").engine;
    const view = c.req.query("view") ?? BASE;
    return c.json(graph.findSymbols(c.req.query("q") ?? "", view, 3).map((t) => ({ symbol: t.id, callers: graph.whoCalls(t, view) })));
  });
  /**
   * The code map: modules or files with their imports, and who is working where right now (files being
   * edited, registered scopes, open conflicts) so the map doubles as a picture of the team's work.
   */
  app.get("/graph/map", (c) => {
    const { engine } = c.get("rt");
    const level = c.req.query("level") === "file" ? "file" : "dir";
    const map = structureMap(engine.graph, c.req.query("view") ?? BASE, {
      level,
      depth: Number(c.req.query("depth") ?? 0) || undefined,
      focus: c.req.query("focus") || undefined,
    });
    const state = engine.store.teamState();
    const inNode = (path: string, node: string) =>
      level === "file" ? path === node : node === "(root)" ? !path.includes("/") : path === node || path.startsWith(`${node}/`);
    const nodes = map.nodes.map((n) => {
      const editing = [...new Set(state.footprints.filter((f) => inNode(f.path, n.id)).map((f) => f.dev))];
      const scoped = [
        ...new Set(
          state.tasks
            .filter((t) =>
              t.resources.some((r) => r.kind === "path" && (level === "file" ? globMatch(r.value, n.id) : inNode(r.value.replace(/\/?\*.*$/, ""), n.id))),
            )
            .map((t) => t.dev),
        ),
      ];
      const conflicts = state.conflicts.filter((x) => inNode(x.subject, n.id)).map((x) => x.level);
      return { ...n, editing, scoped, conflicts };
    });
    return c.json({ ...map, nodes });
  });
  app.get("/graph/calls", (c) => c.json(callMap(c.get("rt").engine.graph, c.req.query("q") ?? "", c.req.query("view") ?? BASE)));

  app.get("/graph/stats", (c) => {
    const { engine } = c.get("rt");
    return c.json({ base: engine.graph.stats(BASE), main: engine.mainSha });
  });

  app.get("/events/log", (c) => c.json(c.get("rt").db.all(`SELECT * FROM event_log ORDER BY id DESC LIMIT ?`, Number(c.req.query("limit") ?? 100))));

  return app;
}
