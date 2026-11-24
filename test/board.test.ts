// Task board: people plan work, agents pick it, registrations move items through the board.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, type Running } from "../src/server/main.ts";
import { loadConfig } from "../src/server/config.ts";
import { NullBrain } from "../src/server/brain/types.ts";
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

const board = () => srv.hub.live("shop")!.engine.board;
const pending = (dev: string) => srv.hub.live("shop")!.engine.store.pendingMessages(dev);

async function start(dev: string) {
  const r = await call<any>("/v1/p/shop/events", {
    method: "POST",
    dev,
    body: { type: "session_start", session: { dev, agent: "claude", workspace_id: `ws_${dev}`, workspace_label: dev, agent_session_id: `s-${dev}` } },
  });
  sessions[dev] = r.json.results[0].session.id;
}

test("setup", async () => {
  origin = await makeOrigin({ "src/cart.ts": "export function total(x: number) { return x }\n", "src/user.ts": "export const u = 1\n" });
  srv = await startServer(loadConfig({ GTV_DATA: tempDir(), GTV_POLL_MS: "3600000", GTV_ADMIN_TOKEN: ADMIN } as NodeJS.ProcessEnv), {
    brain: new NullBrain(),
    listen: false,
  });
  assert.equal((await call("/api/projects", { method: "POST", body: { id: "shop", repo_url: origin.bare } })).status, 200);
  await start("alice");
  await start("bob");
});

after(async () => {
  await srv?.close();
  origin?.cleanup();
});

test("a lead plans tasks; the assignee's agent is told; the board sorts by urgency", async () => {
  const late = await call<any>("/v1/p/shop/board", {
    method: "POST",
    dev: "lead",
    body: { title: "Fix checkout total", priority: "normal", due_date: "2020-01-01" },
  });
  const urgent = await call<any>("/v1/p/shop/board", {
    method: "POST",
    dev: "lead",
    body: { title: "Cart discounts", description: "10% off over 100", priority: "urgent", assignee: "alice", due_date: "2099-01-01" },
  });
  await call("/v1/p/shop/board", { method: "POST", dev: "lead", body: { title: "Dark mode", priority: "low" } });
  assert.equal((await call("/v1/p/shop/board", { method: "POST", dev: "lead", body: { title: "x", priority: "asap" } })).status, 400);

  const list = await call<any[]>("/v1/p/shop/board");
  assert.deepEqual(
    list.json.map((t) => t.title),
    ["Fix checkout total", "Cart discounts", "Dark mode"],
    "overdue first, then priority",
  );
  assert.equal(list.json[0].overdue, true);
  const msg = pending("alice").find((m) => m.ref_id === urgent.json.id)!;
  assert.match(msg.body, /assigned to you by lead · priority urgent · due 2099-01-01\] Cart discounts/);
  assert.equal(pending("bob").length, 0, "only the assignee hears about it");
  assert.equal(late.json.status, "todo");
});

test("an agent picks a task, registers, logs work and finishes: the item follows", async () => {
  const item = board()
    .list()
    .find((t) => t.title === "Cart discounts")!;
  assert.equal(
    (await call(`/v1/p/shop/board/${item.id}/pick`, { method: "POST", dev: "bob", body: { session_id: sessions.bob } })).status,
    400,
    "assigned to alice",
  );
  const picked = await call<any>(`/v1/p/shop/board/${item.id}/pick`, { method: "POST", dev: "alice", body: { session_id: sessions.alice } });
  assert.equal(picked.json.status, "in_progress");

  const reg = await call<any>("/v1/p/shop/tasks", {
    method: "POST",
    dev: "alice",
    body: { session_id: sessions.alice, title: "Discount rules in cart", resources: [{ kind: "path", value: "src/cart.ts" }] },
  });
  assert.equal(reg.json.task.board_id, item.id, "linked to the picked item without naming it");
  assert.equal(reg.json.board.id, item.id);

  await call(`/v1/p/shop/board/${item.id}/notes`, { method: "POST", dev: "alice", body: { body: "Rounding: banker's, per ADR 3" } });
  const detail = await call<any>(`/v1/p/shop/board/${item.id}`);
  assert.equal(detail.json.work[0].dev, "alice");
  assert.ok(detail.json.notes.some((n: any) => n.kind === "note" && /banker/.test(n.body)));
  assert.ok(detail.json.notes.some((n: any) => n.kind === "system" && /picked the task/.test(n.body)));

  await call(`/v1/p/shop/tasks/${reg.json.task.id}`, { method: "PATCH", dev: "alice", body: { status: "done" } });
  assert.equal(board().get(item.id)!.status, "review", "finished, waiting for main");
  board().onMerged([{ ...reg.json.task }], "abcdef1234567");
  assert.equal(board().get(item.id)!.status, "done");
  assert.ok(board().get(item.id)!.done_at);
});

test("work registered without a board item gets one; abandoning puts it back to To do", async () => {
  const reg = await call<any>("/v1/p/shop/tasks", {
    method: "POST",
    dev: "bob",
    body: { session_id: sessions.bob, title: "Profile page", goal: "Show avatar", resources: [{ kind: "path", value: "src/user.ts" }] },
  });
  const item = board().get(reg.json.task.board_id)!;
  assert.deepEqual([item.source, item.status, item.assignee, item.title], ["agent", "in_progress", "bob", "Profile page"]);

  await call(`/v1/p/shop/tasks/${reg.json.task.id}`, { method: "PATCH", dev: "bob", body: { status: "abandoned" } });
  assert.equal(board().get(item.id)!.status, "todo");

  // Moving to other work in the same session releases the previous item too.
  const one = await call<any>("/v1/p/shop/tasks", { method: "POST", dev: "bob", body: { session_id: sessions.bob, title: "A", resources: [] } });
  await call<any>("/v1/p/shop/tasks", { method: "POST", dev: "bob", body: { session_id: sessions.bob, title: "B", resources: [] } });
  assert.equal(board().get(one.json.task.board_id)!.status, "todo");
});

test("managers edit items from the dashboard and every change is logged", async () => {
  const t = board()
    .list()
    .find((x) => x.title === "Dark mode")!;
  const res = await call<any>(`/v1/p/shop/board/${t.id}`, {
    method: "PATCH",
    dev: "lead",
    body: { priority: "high", assignee: "bob", due_date: "2099-02-01" },
  });
  assert.deepEqual([res.json.priority, res.json.assignee], ["high", "bob"]);
  const notes = board().notes(t.id);
  assert.match(notes.at(-1)!.body, /lead set priority low → high, set the due date to 2099-02-01, assigned it to bob/);
  assert.ok(pending("bob").some((m) => m.ref_id === t.id));
  assert.equal((await call(`/v1/p/shop/board/${t.id}`, { method: "DELETE", dev: "lead" })).status, 200);
  assert.equal(board().get(t.id), undefined);
});

test("conflict notices carry both tasks' priority and tell the lower-priority side to give way", async () => {
  const hot = await call<any>("/v1/p/shop/board", { method: "POST", dev: "lead", body: { title: "Hotfix totals", priority: "urgent", assignee: "alice" } });
  const nice = await call<any>("/v1/p/shop/board", { method: "POST", dev: "lead", body: { title: "Refactor cart", priority: "low", assignee: "bob" } });
  for (const [dev, item] of [
    ["alice", hot.json.id],
    ["bob", nice.json.id],
  ]) {
    await call(`/v1/p/shop/board/${item}/pick`, { method: "POST", dev, body: { session_id: sessions[dev] } });
    await call("/v1/p/shop/tasks", {
      method: "POST",
      dev,
      body: { session_id: sessions[dev], title: `${dev} cart work`, resources: [{ kind: "path", value: "src/cart.ts" }] },
    });
  }
  const store = srv.hub.live("shop")!.engine.store;
  store.markDelivered([...pending("alice"), ...pending("bob")].map((m) => m.id));
  for (const dev of ["alice", "bob"])
    await call("/v1/p/shop/events", { method: "POST", dev, body: { type: "edit", session_id: sessions[dev], paths: ["src/cart.ts"], phase: "post" } });

  const toBob = pending("bob").find((m) => m.kind === "conflict")!;
  const toAlice = pending("alice").find((m) => m.kind === "conflict")!;
  assert.match(toBob.body, /Your task: "Refactor cart" \(low\)\. alice \(developer, mid\)'s task: "Hotfix totals" \(urgent\)/);
  assert.match(toBob.body, /alice's work goes first \(higher priority\)\. Pause your changes/);
  assert.match(toAlice.body, /Your work goes first \(higher priority\); bob was asked to give way/);

  // Off: plain notices, as before.
  srv.hub.live("shop")!.engine.setFeature("coord.priority", "off");
  store.markDelivered([...pending("alice"), ...pending("bob")].map((m) => m.id));
  store.syncConflicts("L0", [], () => true);
  await call("/v1/p/shop/events", { method: "POST", dev: "bob", body: { type: "edit", session_id: sessions.bob, paths: ["src/user.ts"], phase: "post" } });
  srv.hub.live("shop")!.engine.runL0();
  const plain = pending("bob").find((m) => m.kind === "conflict");
  assert.ok(plain && !/goes first/.test(plain.body));
});

test("conversations: question, forward and answer read as one thread; leads see what needs attention", async () => {
  const t = await call<any>("/v1/p/shop/tickets", {
    method: "POST",
    dev: "alice",
    body: { session_id: sessions.alice, question: "Can I change total() to take a Cart?", to_dev: "bob" },
  });
  await call(`/v1/p/shop/tickets/${t.json.id}/reply`, { method: "POST", dev: "bob", body: { answer: "Yes, after Friday", session_id: sessions.bob } });
  await call("/api/projects/shop/messages", { method: "POST", body: { to_dev: "bob", body: "Please review alice's PR" } });

  const threads = (await call<any[]>("/api/projects/shop/conversations")).json;
  const q = threads.find((x) => x.id === t.json.id);
  assert.deepEqual(
    q.entries.map((e: any) => [e.kind, e.from, e.to]),
    [
      ["question", "alice", "bob"],
      ["forward", "alice", "bob"],
      ["answer", "bob", "alice"],
    ],
  );
  assert.match(q.entries[1].body, /^Can I change total\(\) to take a Cart\?$/);
  assert.ok(threads.some((x) => x.kind === "conflict" && x.participants.includes("alice") && x.participants.includes("bob")));
  assert.ok(threads.some((x) => x.kind === "task" && x.title === "Hotfix totals"));
  const note = threads.find((x) => x.id === "note:bob");
  assert.equal(note.entries[0].from, "admin");

  const att = (await call<any[]>("/api/projects/shop/attention")).json;
  assert.ok(att.some((a) => a.kind === "overdue" && /Fix checkout total/.test(a.title)));
});
