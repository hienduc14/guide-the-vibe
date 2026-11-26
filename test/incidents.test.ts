// Incidents: conflict rows grouped per pair of workspaces, acted on together; guidance to agents; attention and board rules.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, type Running } from "../src/server/main.ts";
import { loadConfig } from "../src/server/config.ts";
import { NullBrain } from "../src/server/brain/types.ts";
import type { Conflict } from "../src/shared/types.ts";
import { makeOrigin, tempDir, type Origin } from "./helpers.ts";

process.env.GTV_QUIET = "1";

let srv: Running;
let origin: Origin;
const ADMIN = "admin-secret";
const sessions: Record<string, string> = {};

async function call<T = any>(path: string, init: { method?: string; body?: unknown; dev?: string } = {}): Promise<{ status: number; json: T }> {
  const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${ADMIN}` };
  if (init.dev) headers["x-gtv-dev"] = init.dev;
  const res = await srv.app.request(path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  return { status: res.status, json: (await res.json()) as T };
}

const engine = () => srv.hub.live("shop")!.engine;

type Found = Omit<Conflict, "id" | "status" | "created_at" | "updated_at">;
const row = (layer: string, kind: string, level: Found["level"], a: string, b: string, subject: string): Found => ({
  key: `${layer}|${kind}|ws_${a}|ws_${b}|${subject}`,
  layer: layer as Found["layer"],
  kind,
  level,
  workspace_a: `ws_${a}`,
  workspace_b: `ws_${b}`,
  dev_a: a,
  dev_b: b,
  subject,
  evidence: {},
  message: `${a} and ${b}: ${kind} on ${subject}`,
});

async function start(dev: string) {
  const r = await call<any>("/v1/p/shop/events", {
    method: "POST",
    dev,
    body: { type: "session_start", session: { dev, agent: "claude", workspace_id: `ws_${dev}`, workspace_label: dev, agent_session_id: `s-${dev}` } },
  });
  sessions[dev] = r.json.results[0].session.id;
}

test("setup", async () => {
  origin = await makeOrigin({ "src/cart.ts": "export function total(x: number) { return x }\n" });
  srv = await startServer(loadConfig({ GTV_DATA: tempDir(), GTV_POLL_MS: "3600000", GTV_ADMIN_TOKEN: ADMIN } as NodeJS.ProcessEnv), {
    brain: new NullBrain(),
    listen: false,
  });
  assert.equal((await call("/api/projects", { method: "POST", body: { id: "shop", repo_url: origin.bare } })).status, 200);
  for (const d of ["alice", "bob", "carol"]) await start(d);
});

after(async () => {
  await srv?.close();
  origin?.cleanup();
});

test("conflict rows of two pairs become two incidents, with the strongest level and the files", async () => {
  const { store } = engine();
  store.syncConflicts(
    "L0",
    [
      row("L0", "same_file", "warning", "alice", "bob", "src/cart.ts"),
      row("L0", "scope_overlap", "info", "alice", "bob", "src/cart.ts ~ src/**"),
      row("L0", "same_symbol_declared", "warning", "alice", "bob", "symbol:total"),
      row("L0", "same_file", "warning", "bob", "carol", "src/user.ts"),
    ],
    () => true,
  );
  store.syncConflicts("L1", [row("L1", "text", "high", "bob", "alice", "src/cart.ts")], () => true);
  const list = (await call<any[]>("/v1/p/shop/incidents")).json;
  assert.equal(list.length, 2);
  const ab = list.find((i) => [i.dev_a, i.dev_b].sort().join() === "alice,bob")!;
  assert.equal(ab.level, "high");
  assert.equal(ab.headline.layer, "L1", "the strongest evidence is the headline");
  assert.equal(ab.evidence.length, 4);
  assert.deepEqual(ab.files, ["src/cart.ts"]);
  assert.equal(ab.status, "open");

  const att = (await call<any[]>("/api/projects/shop/attention")).json.filter((a) => a.kind === "conflict");
  assert.deepEqual(
    att.map((a) => a.ref),
    [ab.id],
    "one attention item per high incident; the warning-level pair is not counted",
  );
});

test("acting on an incident acts on every row; a new row reopens it", async () => {
  const ab = (await call<any[]>("/v1/p/shop/incidents")).json.find((i) => i.level === "high")!;
  const acked = (await call<any>(`/v1/p/shop/incidents/${ab.id}/ack`, { method: "POST", dev: "lead" })).json;
  assert.equal(acked.status, "acked");
  assert.ok(acked.evidence.every((e: any) => e.status === "acked"));
  assert.equal((await call<any[]>("/api/projects/shop/attention")).json.filter((a) => a.kind === "conflict").length, 0);

  engine().store.syncConflicts("L2", [row("L2", "same_symbol_changed", "warning", "alice", "bob", "src/cart.ts#total")], () => true);
  const again = (await call<any[]>("/v1/p/shop/incidents")).json.find((i) => i.id === ab.id)!;
  assert.equal(again.status, "open");

  const dismissed = (await call<any>(`/v1/p/shop/incidents/${ab.id}/dismiss`, { method: "POST", dev: "lead" })).json;
  assert.equal(dismissed.status, "closed");
  assert.equal(dismissed.closed_reason, "dismissed");
  assert.ok(!(await call<any[]>("/v1/p/shop/incidents")).json.some((i) => i.id === ab.id), "closed incidents leave the active list");
  assert.ok((await call<any[]>("/v1/p/shop/incidents?all=1")).json.some((i) => i.id === ab.id));
  const reopened = (await call<any>(`/v1/p/shop/incidents/${ab.id}/reopen`, { method: "POST", dev: "lead" })).json;
  assert.equal(reopened.status, "open");
});

test("guidance goes to the chosen agents, marks the incident handled and shows delivery", async () => {
  const ab = (await call<any[]>("/v1/p/shop/incidents")).json.find((i) => i.level === "high")!;
  assert.equal((await call(`/v1/p/shop/incidents/${ab.id}/guide`, { method: "POST", dev: "lead", body: { body: "", to: ["alice"] } })).status, 400);
  const res = await call<any>(`/v1/p/shop/incidents/${ab.id}/guide`, {
    method: "POST",
    dev: "lead",
    body: { body: "alice goes first; bob rebases after.", to: ["alice", "bob", "mallory"] },
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.status, "guided");
  assert.deepEqual(
    res.json.guide.to.map((t: any) => [t.dev, t.delivered_at]),
    [
      ["alice", null],
      ["bob", null],
    ],
    "only the two sides receive it",
  );
  const msg = engine()
    .store.pendingMessages("alice")
    .find((m) => m.body.includes("alice goes first"))!;
  assert.match(msg.body, /guidance from lead \(team lead\) about your clash with bob/);
  engine().store.markDelivered([msg.id]);
  const after = (await call<any[]>("/v1/p/shop/incidents")).json.find((i) => i.id === ab.id)!;
  assert.ok(after.guide.to.find((t: any) => t.dev === "alice").delivered_at);
});

test("plans and rewrites are empty when the brain is off", async () => {
  const ab = (await call<any[]>("/v1/p/shop/incidents")).json[0];
  assert.deepEqual((await call<any>(`/api/projects/shop/incidents/${ab.id}/plans`)).json, { plans: [] });
  assert.deepEqual((await call<any>(`/api/projects/shop/incidents/${ab.id}/rewrite`, { method: "POST", body: { text: "x" } })).json, { text: "" });
});

test("a question waiting for a person blocks the asker's work; idle work goes stale", async () => {
  const item = (await call<any>("/v1/p/shop/board", { method: "POST", dev: "lead", body: { title: "Bio limit", assignee: "carol" } })).json;
  await call(`/v1/p/shop/board/${item.id}/pick`, { method: "POST", dev: "carol", body: { session_id: sessions.carol } });
  await call("/v1/p/shop/tasks", {
    method: "POST",
    dev: "carol",
    body: { session_id: sessions.carol, title: "Bio limit", resources: [{ kind: "path", value: "src/user.ts" }] },
  });
  const now = new Date().toISOString();
  engine().store.saveTicket({
    id: "tk_wait",
    from_session: sessions.carol,
    from_dev: "carol",
    question: "Which error shape?",
    tier: 3,
    status: "waiting_human",
    to_dev: "alice",
    sources: [],
    created_at: now,
    updated_at: now,
  });
  const view = engine().board.view(engine().board.get(item.id)!);
  assert.deepEqual(view.waiting, [{ id: "tk_wait", to_dev: "alice" }]);
  assert.equal(view.blocked, true);
  const att = (await call<any[]>("/api/projects/shop/attention")).json;
  const q = att.find((a) => a.ref === "tk_wait")!;
  assert.deepEqual(q.board, { id: item.id, title: "Bio limit" });
  assert.ok(!att.some((a) => a.kind === "blocked" && a.ref === item.id), "the waiting question already explains the block");

  const conv = (await call<any[]>("/api/projects/shop/conversations?kinds=question")).json;
  assert.ok(conv.every((t) => t.kind === "question"));
  assert.equal(conv.find((t) => t.id === "tk_wait").board_id, item.id);

  engine().store.saveTicket({ ...engine().store.ticket("tk_wait")!, status: "answered" });
  const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
  engine().db.run(`UPDATE sessions SET status = 'idle', last_seen = ? WHERE id = ?`, old, sessions.carol);
  engine().db.run(`UPDATE board_tasks SET updated_at = ? WHERE id = ?`, old, item.id);
  const stale = (await call<any[]>("/api/projects/shop/attention")).json.find((a) => a.kind === "stale");
  assert.equal(stale?.ref, item.id);
});

test("brain failures show on /health even when the provider is configured", async () => {
  srv.hub.db.run(
    `INSERT INTO brain_jobs (ts, project, kind, backend, model, ms, ok, error) VALUES (?, 'shop', 'answer_question', 'pi', 'm', 5, 0, 'service disabled')`,
    new Date().toISOString(),
  );
  const h = await call<any>("/health");
  assert.deepEqual(h.json.brain.failing, { count: 1, error: "service disabled" });
});
