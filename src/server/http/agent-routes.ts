// Project-scoped API used by daemons, agents (through the daemon) and the CLI: mounted at /v1/p/:project.

import { Hono, type Context } from "hono";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { streamSSE } from "hono/streaming";
import type { ProjectRuntime } from "../project/runtime.ts";
import type { AuthVars } from "./auth.ts";
import type { FeatureMode, GtvEvent, Message, NoteTag, Session, TaskRegistration, TaskResource } from "../../shared/types.ts";
import { oneLine } from "../../shared/types.ts";
import { BASE } from "../../codeintel/graph.ts";
import { callMap, structureMap } from "../../codeintel/map.ts";
import { FEATURES } from "../../shared/features.ts";
import { globMatch, newId, normPath } from "../../shared/util.ts";
import { actOnIncident, guideIncident, incidents } from "../project/incidents.ts";

export type ProjectEnv = { Variables: AuthVars & { rt: ProjectRuntime } };
const MAX_BUNDLE = 100 << 20;
type Ctx = Context<ProjectEnv>;

const sessionOf = (c: Ctx, id: string | undefined): Session => {
  const s = id ? c.get("rt").engine.store.session(id) : undefined;
  if (!s || (s.dev !== c.get("dev") && !c.get("admin"))) throw new Error(`unknown session ${id}`);
  // Any call from an agent shows its developer is at work, not only prompts and edits (gtv_ask, gtv_pick_task…).
  if (s.dev === c.get("dev")) c.get("rt").engine.store.touchSession(s.id);
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
      if (ev.type === "session_start") ev.session = { ...ev.session, device: c.get("principal")?.device ?? null };
      const wsId = ev.type === "snapshot" ? ev.workspace_id : ev.type === "session_start" ? ev.session.workspace_id : undefined;
      const ws = wsId ? engine.store.workspace(wsId) : undefined;
      if (ws && ws.dev !== c.get("dev") && !c.get("admin")) throw new Error(`unknown workspace ${wsId}`);
      if ("session_id" in ev) sessionOf(c, ev.session_id);
      results.push(await engine.handle(c.get("dev"), ev));
    }
    return c.json({ results });
  });

  /**
   * A WIP snapshot as a git bundle (body), so a developer needs no push rights to the team's remote:
   * ?workspace_id=&sha=&branch=. 409 { need: "full" } asks the daemon for a bundle with the whole history.
   */
  app.post("/snapshot", async (c) => {
    const { engine } = c.get("rt");
    const ws = c.req.query("workspace_id") ?? "";
    const sha = c.req.query("sha") ?? "";
    if (!/^[0-9a-f]{40}$/.test(sha)) return c.json({ error: "sha must be a full commit id" }, 400);
    const body = Buffer.from(await c.req.arrayBuffer());
    if (!body.length) return c.json({ error: "empty bundle" }, 400);
    if (body.length > MAX_BUNDLE) return c.json({ error: `snapshot too large (over ${MAX_BUNDLE >> 20} MB)` }, 413);
    const dir = mkdtempSync(join(tmpdir(), "gtv-bundle-"));
    try {
      const file = join(dir, "snapshot.bundle");
      writeFileSync(file, body);
      const r = await engine.receiveSnapshot(c.get("dev"), ws, sha, file, c.req.query("branch") || undefined);
      return r === "ok" ? c.json({ accepted: true }) : c.json({ error: "the bundle builds on commits the server does not have", need: "full" }, 409);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
      summary?: string;
    };
    const t = engine.store.task(c.req.param("id"));
    if (!t || (t.dev !== c.get("dev") && !c.get("admin"))) throw new Error("unknown task");
    const resources =
      body.resources ??
      (body.add_resources ? [...t.resources, ...body.add_resources.map((r) => ({ ...r, value: r.kind === "path" ? normPath(r.value) : r.value }))] : undefined);
    const summary = body.summary?.trim().slice(0, 2000) || undefined;
    const next = engine.store.updateTask(t.id, { title: body.title, goal: body.goal, resources, status: body.status, summary } as never);
    // What the agent says it did lands on the board item's log as a "done" card.
    if (summary && t.board_id && engine.board.get(t.board_id))
      engine.board.note(t.board_id, c.get("dev"), "note", summary, { tag: body.status === "abandoned" ? "blocker" : "done", summary: oneLine(summary) });
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
    const { body, tag, summary } = (await c.req.json()) as { body?: string; tag?: NoteTag; summary?: string };
    if (!board.get(c.req.param("id"))) throw new Error("unknown board task");
    return c.json(board.note(c.req.param("id"), c.get("dev"), "note", String(body || summary || ""), { tag, summary }));
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
    const body = (await c.req.json()) as { session_id: string; question: string; context?: string; to_dev?: string; options?: string[] };
    const session = sessionOf(c, body.session_id);
    if (!body.question?.trim()) throw new Error("question is required");
    const options = (body.options ?? [])
      .map((o) => String(o).trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 5);
    const t = await tickets.ask({ session, question: body.question, context: body.context, to_dev: body.to_dev, options });
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

  app.post("/tickets/:id/withdraw", async (c) => {
    const { tickets, engine } = c.get("rt");
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string; session_id?: string };
    const dev = c.get("dev");
    const t = engine.store.ticket(c.req.param("id"));
    if (t && t.from_dev !== dev && !c.get("admin")) return c.json({ error: "forbidden: only the asker or a manager closes a question" }, 403);
    const by = body.session_id ? `${dev}'s agent` : `${dev} (human)`;
    return c.json(tickets.withdraw({ ticket_id: c.req.param("id"), by, reason: body.reason }));
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

  // Incidents: every conflict row about one pair of workspaces, acted on together.
  app.get("/incidents", (c) => c.json(incidents(c.get("rt").engine, c.req.query("all") ? "all" : "active")));
  app.post("/incidents/:id/:action{ack|dismiss|reopen}", (c) =>
    c.json(actOnIncident(c.get("rt").engine, c.req.param("id"), c.req.param("action") as "ack" | "dismiss" | "reopen", c.get("dev"))),
  );
  app.post("/incidents/:id/guide", async (c) =>
    c.json(guideIncident(c.get("rt").engine, c.req.param("id"), (await c.req.json()) as { body?: string; to?: string[] }, c.get("dev"))),
  );

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
