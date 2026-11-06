// Multi-project hub, developer tokens and the dashboard API.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, type Running } from "../src/server/main.ts";
import { parseInvite } from "../src/daemon/join.ts";
import { loadConfig } from "../src/server/config.ts";
import { repoKey } from "../src/server/hub/hub.ts";
import type { Brain, BrainJob, BrainResult } from "../src/server/brain/types.ts";
import { makeOrigin, tempDir, type Origin } from "./helpers.ts";

process.env.GTV_QUIET = "1";

class FakeBrain implements Brain {
  readonly name = "fake";
  readonly model = "fake/model-1";
  async health() {
    return { ok: true, detail: "fake" };
  }
  async run<T>(job: BrainJob): Promise<BrainResult<T>> {
    if (job.kind === "answer_question")
      return { output: { route: "answer", answer: `answer for ${job.project}`, confidence: "high", sources: [] } as T, ms: 3, backend: "fake" };
    throw new Error("not scripted");
  }
}

let srv: Running;
let a: Origin;
let b: Origin;
const ADMIN = "admin-secret";

async function call<T = any>(path: string, init: { method?: string; body?: unknown; token?: string; dev?: string } = {}): Promise<{ status: number; json: T }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.dev) headers["x-gtv-dev"] = init.dev;
  const res = await srv.app.request(path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  return { status: res.status, json: (await res.json()) as T };
}

test("setup: hub with two projects", async () => {
  a = await makeOrigin({ "src/a.ts": "export function f(x: number) { return x }\n" });
  b = await makeOrigin({ "app/main.py": "def g(y):\n    return y\n", "docs/rules.md": "# Rules\n\nRefunds within 14 days.\n" });
  const cfg = loadConfig({ GTV_DATA: tempDir(), GTV_POLL_MS: "3600000", GTV_ADMIN_TOKEN: ADMIN } as NodeJS.ProcessEnv);
  srv = await startServer(cfg, { brain: new FakeBrain(), listen: false });
  const r1 = await call("/api/projects", { method: "POST", token: ADMIN, body: { id: "shop", repo_url: a.bare, main_branch: "main", name: "Shop" } });
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  const r2 = await call("/api/projects", { method: "POST", token: ADMIN, body: { id: "billing", repo_url: b.bare, main_branch: "main" } });
  assert.equal(r2.status, 200);
  assert.deepEqual(
    srv.hub.records().map((p) => p.id),
    ["shop", "billing"],
  );
});

after(async () => {
  await srv?.close();
  a?.cleanup();
  b?.cleanup();
});

test("admin API requires the admin token; dev tokens are issued and checked", async () => {
  assert.equal((await call("/api/overview")).status, 401);
  const issued = await call<{ token: string }>("/api/devs", { method: "POST", token: ADMIN, body: { name: "alice" } });
  assert.match(issued.json.token, /^gtv_/);
  assert.equal((await call("/v1/projects")).status, 401, "open mode ends once developers exist");
  const list = await call<any[]>("/v1/projects", { token: issued.json.token });
  assert.deepEqual(
    list.json.map((p) => p.id),
    ["shop", "billing"],
  );
  assert.equal((await call("/api/overview", { token: issued.json.token })).status, 401, "a dev token is not an admin token");
});

test("invite links: one use, then the dev's token works; expired links fail", async () => {
  assert.equal((await call("/api/devs/invite", { method: "POST", body: { name: "carol" } })).status, 401, "only the admin invites");
  const inv = await call<{ code: string }>("/api/devs/invite", { method: "POST", token: ADMIN, body: { name: "carol" } });
  const joined = await call<{ dev: string; token: string }>("/v1/join", { method: "POST", body: { code: inv.json.code } });
  assert.equal(joined.json.dev, "carol");
  assert.equal((await call("/v1/projects", { token: joined.json.token })).status, 200);
  assert.equal((await call("/v1/join", { method: "POST", body: { code: inv.json.code } })).status, 400, "a link works once");

  const old = await call<{ code: string }>("/api/devs/invite", { method: "POST", token: ADMIN, body: { name: "dave" } });
  srv.hub.db.run(`UPDATE invites SET expires_at = '2000-01-01T00:00:00.000Z'`);
  assert.equal((await call("/v1/join", { method: "POST", body: { code: old.json.code } })).status, 400);
  assert.ok(!srv.hub.devs().some((d) => d.name === "dave"));
  assert.deepEqual(parseInvite("https://gtv.example.com/ops/j/abc_D-9"), { server: "https://gtv.example.com/ops", code: "abc_D-9" });
});

test("remote URLs resolve to projects", async () => {
  assert.equal(repoKey("https://x-access-token:abc@github.com/Org/Repo.git"), "org/repo");
  assert.equal(repoKey("git@github.com:org/repo.git"), "org/repo");
  assert.equal(repoKey("D:\\work\\org\\repo\\"), "org/repo");
  const r = await call<{ id: string }>(`/v1/resolve?remote=${encodeURIComponent(b.bare)}`, { token: ADMIN });
  assert.equal(r.json.id, "billing");
});

test("projects are isolated: sessions, graph and knowledge per project", async () => {
  const start = (project: string, dev: string) =>
    call<any>(`/v1/p/${project}/events`, {
      method: "POST",
      token: ADMIN,
      dev,
      body: { type: "session_start", session: { dev, agent: "codex", workspace_id: `ws_${dev}`, workspace_label: dev, agent_session_id: `s-${dev}` } },
    });
  const s = await start("shop", "alice");
  await start("billing", "bob");
  const shop = srv.hub.live("shop")!;
  const billing = srv.hub.live("billing")!;
  assert.deepEqual(
    shop.engine.store.sessions().map((x) => x.dev),
    ["alice"],
  );
  assert.deepEqual(
    billing.engine.store.sessions().map((x) => x.dev),
    ["bob"],
  );
  assert.equal(shop.engine.graph.findSymbols("f", "base").length, 1);
  assert.equal(billing.engine.graph.findSymbols("f", "base").length, 0);
  assert.equal(billing.engine.kb.search("refunds").length, 1);
  assert.equal(shop.engine.kb.search("refunds").length, 0);

  const t = await call<any>("/v1/p/shop/tickets", {
    method: "POST",
    token: ADMIN,
    dev: "alice",
    body: { session_id: s.json.results[0].session.id, question: "what does f do?" },
  });
  assert.equal(t.json.answer, "answer for shop", "brain jobs carry their project");
});

test("dashboard endpoints: overview, people, stats with brain metering, layers, activity", async () => {
  const o = await call<any>("/api/overview", { token: ADMIN });
  assert.equal(o.json.brain.model, "fake/model-1");
  assert.equal(o.json.projects.length, 2);
  const shop = o.json.projects.find((p: any) => p.id === "shop");
  assert.equal(shop.people[0].dev, "alice");
  assert.equal(shop.counts.sessions_active, 1);

  const st = await call<any>("/api/projects/shop/stats?days=7", { token: ADMIN });
  assert.equal(st.json.brain.totals.jobs, 1);
  assert.deepEqual(
    st.json.brain.byKind.map((k: any) => k.kind),
    ["answer_question"],
  );
  assert.ok(st.json.events.byType.some((e: any) => e.k === "ticket_ask"));

  const layers = await call<any[]>("/api/projects/shop/layers", { token: ADMIN });
  const l2 = layers.json.find((l) => l.key === "detect.l2_symbol");
  assert.equal(l2.layer, "L2");
  assert.equal(l2.mode, "on");
  assert.equal(layers.json.find((l) => l.key === "knowledge.code_graph").metrics.symbols, 1);

  await call("/v1/p/shop/features", { method: "PUT", token: ADMIN, body: { feature: "detect.l1_merge", mode: "shadow" } });
  const after = await call<any[]>("/api/projects/shop/layers", { token: ADMIN });
  assert.equal(after.json.find((l) => l.key === "detect.l1_merge").mode, "shadow");

  const msg = await call<any>("/api/projects/shop/messages", { method: "POST", token: ADMIN, body: { to_dev: "alice", body: "please rebase" } });
  assert.match(msg.json.body, /please rebase/);
  const act = await call<any[]>("/api/projects/shop/activity", { token: ADMIN });
  assert.ok(act.json.some((e) => e.type === "manual_message"));

  const patched = await call<any>("/api/projects/shop", { method: "PATCH", token: ADMIN, body: { policy: { critical_paths: ["db/**"] } } });
  assert.deepEqual(patched.json.policy.critical_paths, ["db/**"]);
  assert.deepEqual(srv.hub.live("shop")!.engine.store.policy.critical_paths, ["db/**"]);
});

test("archiving a project stops it", async () => {
  await call("/api/projects/billing", { method: "DELETE", token: ADMIN });
  assert.deepEqual(
    srv.hub.records().map((p) => p.id),
    ["shop"],
  );
  assert.equal((await call("/v1/p/billing/state", { token: ADMIN })).status, 404);
});
