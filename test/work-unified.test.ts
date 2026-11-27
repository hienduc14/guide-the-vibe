// One place for work: every registration lives on a board item, a new session carries on the dev's unfinished
// item instead of adding a duplicate, tasks go to members only, and old data is repaired at start.

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

async function call<T = any>(path: string, init: { method?: string; body?: unknown; dev?: string } = {}): Promise<{ status: number; json: T }> {
  const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${ADMIN}` };
  if (init.dev) headers["x-gtv-dev"] = init.dev;
  const res = await srv.app.request(path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  return { status: res.status, json: (await res.json()) as T };
}

const engine = () => srv.hub.live("shop")!.engine;

/** Opens an agent session; `n` tells sessions of one dev apart, `ws` picks the checkout. */
async function start(dev: string, n: number, ws = `ws_${dev}`): Promise<{ id: string; briefing: string }> {
  const r = await call<any>("/v1/p/shop/events", {
    method: "POST",
    dev,
    body: { type: "session_start", session: { dev, agent: "claude", workspace_id: ws, workspace_label: ws, agent_session_id: `s-${dev}-${n}` } },
  });
  return { id: r.json.results[0].session.id, briefing: r.json.results[0].briefing };
}
const end = (dev: string, session_id: string) => call("/v1/p/shop/events", { method: "POST", dev, body: { type: "session_end", session_id } });
const register = (dev: string, session_id: string, title: string) =>
  call<any>("/v1/p/shop/tasks", { method: "POST", dev, body: { session_id, title, resources: [] } });

test("setup", async () => {
  origin = await makeOrigin({ "src/a.ts": "export const a = 1\n" });
  srv = await startServer(loadConfig({ GTV_DATA: tempDir(), GTV_POLL_MS: "3600000", GTV_ADMIN_TOKEN: ADMIN } as NodeJS.ProcessEnv), {
    brain: new NullBrain(),
    listen: false,
  });
  assert.equal((await call("/api/projects", { method: "POST", body: { id: "shop", repo_url: origin.bare } })).status, 200);
});

after(async () => {
  await srv?.close();
  origin?.cleanup();
});

test("a new session in the same checkout carries on the unfinished item instead of adding another", async () => {
  const first = await start("carol", 1);
  const a = await register("carol", first.id, "Search page");
  await end("carol", first.id);

  const second = await start("carol", 2);
  assert.match(second.briefing, new RegExp(`Your unfinished board tasks.*${a.json.task.board_id} "Search page"`), "the briefing points at it");
  const b = await register("carol", second.id, "Search page: filters");
  assert.equal(b.json.task.board_id, a.json.task.board_id, "same board item");
  assert.equal(engine().store.task(a.json.task.id)!.status, "abandoned", "the old session's registration is replaced");
  assert.equal(engine().board.get(a.json.task.board_id)!.status, "in_progress");
  assert.equal(engine().board.list({ assignee: "carol" }).length, 1, "no duplicate on the board");
});

test("two live sessions of one dev in one checkout keep separate items", async () => {
  const one = await start("dan", 1);
  const two = await start("dan", 2);
  const a = await register("dan", one.id, "Cart");
  const b = await register("dan", two.id, "Checkout");
  assert.notEqual(a.json.task.board_id, b.json.task.board_id);
});

test("another checkout (branch) of the same dev starts its own item", async () => {
  const one = await start("erin", 1, "ws_erin_main");
  const a = await register("erin", one.id, "Login");
  await end("erin", one.id);
  const other = await start("erin", 2, "ws_erin_feature");
  const b = await register("erin", other.id, "Signup");
  assert.notEqual(a.json.task.board_id, b.json.task.board_id);
});

test("nobody becomes a member by working or being assigned: tasks go to members only", async () => {
  const r = await call<any>("/v1/p/shop/board", { method: "POST", dev: "lead", body: { title: "Docs", assignee: "frank" } });
  assert.deepEqual([r.status, r.json.error], [400, "frank is not a member of this project"]);
  assert.equal(engine().store.member("frank"), undefined);
  assert.equal(engine().store.member("carol"), undefined, "opening a session does not add anyone");
  srv.hub.members.add("shop", "frank", "developer", null);
  assert.equal((await call("/v1/p/shop/board", { method: "POST", dev: "lead", body: { title: "Docs", assignee: "frank" } })).status, 200);
});

test("old registrations without a board item are adopted once", async () => {
  const { store, board } = engine();
  const now = new Date().toISOString();
  const row = (id: string, title: string, status: string) =>
    store.db.upsert("tasks", {
      id,
      session_id: "ses_old",
      workspace_id: "ws_gina",
      dev: "gina",
      title,
      goal: null,
      base_sha: null,
      resources: [],
      status,
      created_at: now,
      updated_at: now,
      board_id: null,
    });
  row("task_old1", "Export CSV", "active");
  row("task_old2", "Export CSV", "abandoned");
  row("task_old3", "Old idea", "abandoned");

  assert.equal(board.adoptOrphans(), 2, "same dev, checkout and title share an item");
  assert.equal(board.adoptOrphans(), 0, "runs once");
  const csv = board.get(store.task("task_old1")!.board_id!)!;
  assert.equal(store.task("task_old2")!.board_id, csv.id);
  assert.deepEqual([csv.source, csv.status, csv.assignee], ["agent", "in_progress", "gina"]);
  assert.equal(board.get(store.task("task_old3")!.board_id!)!.status, "cancelled");
  assert.equal(store.member("gina"), undefined, "nobody becomes a member by working");
});

test("'đang làm' counts people with work in progress and a session that has not ended", async () => {
  const detail = await call<any>("/api/projects/shop");
  const working = detail.json.people.filter((p: any) => p.working).map((p: any) => p.dev);
  assert.equal(detail.json.counts.people_active, working.length);
  assert.ok(working.includes("carol") && working.includes("dan"));
  assert.ok(!working.includes("erin") || detail.json.people.find((p: any) => p.dev === "erin").status !== "ended");
});
