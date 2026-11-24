// Dashboard accounts (admin / manager / viewer) and read-only share links.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, type Running } from "../src/server/main.ts";
import { loadConfig } from "../src/server/config.ts";
import { NullBrain } from "../src/server/brain/types.ts";
import { makeOrigin, tempDir, type Origin } from "./helpers.ts";

process.env.GTV_QUIET = "1";

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

const login = async (name: string, password: string) =>
  (await call<{ token: string; role: string }>("/api/login", { method: "POST", body: { name, password } })).json;

test("setup", async () => {
  a = await makeOrigin({ "src/a.ts": "export const a = 1\n" });
  b = await makeOrigin({ "src/b.ts": "export const b = 1\n" });
  const cfg = loadConfig({ GTV_DATA: tempDir(), GTV_POLL_MS: "3600000", GTV_ADMIN_TOKEN: ADMIN } as NodeJS.ProcessEnv);
  srv = await startServer(cfg, { brain: new NullBrain(), listen: false });
  for (const [id, origin] of [
    ["shop", a],
    ["blog", b],
  ] as const)
    assert.equal((await call("/api/projects", { method: "POST", token: ADMIN, body: { id, repo_url: origin.bare } })).status, 200);
});

after(async () => {
  await srv?.close();
  a?.cleanup();
  b?.cleanup();
});

test("users log in with a password and act by role", async () => {
  assert.equal((await call("/api/users/mia", { method: "PUT", token: ADMIN, body: { role: "manager", password: "manager-pass" } })).status, 200);
  assert.equal((await call("/api/users/vic", { method: "PUT", token: ADMIN, body: { role: "viewer", password: "viewer-pass" } })).status, 200);
  assert.equal((await call("/api/login", { method: "POST", body: { name: "mia", password: "nope-nope" } })).status, 400);

  const mia = await login("mia", "manager-pass");
  const vic = await login("vic", "viewer-pass");
  assert.match(mia.token, /^gtvs_/);
  assert.equal((await call<any>("/api/me", { token: mia.token })).json.role, "manager");

  // Everyone reads.
  assert.equal((await call("/api/overview", { token: vic.token })).status, 200);
  assert.equal((await call("/v1/p/shop/conflicts", { token: vic.token })).status, 200);
  // Viewers change nothing; managers change project content; only admins manage the server.
  assert.equal((await call("/api/projects/shop", { method: "PATCH", token: vic.token, body: { name: "x" } })).status, 403);
  assert.equal((await call("/v1/p/shop/features", { method: "PUT", token: vic.token, body: { feature: "detect.l1_merge", mode: "off" } })).status, 403);
  assert.equal((await call("/api/projects/shop", { method: "PATCH", token: mia.token, body: { name: "Shop" } })).status, 200);
  assert.equal((await call("/v1/p/shop/features", { method: "PUT", token: mia.token, body: { feature: "detect.l1_merge", mode: "shadow" } })).status, 200);
  assert.equal((await call("/api/devs", { method: "POST", token: mia.token, body: { name: "eve" } })).status, 403);
  assert.equal((await call("/api/users", { token: mia.token })).status, 403);
  assert.equal((await call("/api/brain/providers", { token: mia.token })).status, 403);
  assert.equal((await call("/api/projects", { method: "POST", token: mia.token, body: { id: "x1", repo_url: a.bare } })).status, 403);

  // Logout and password change end sessions.
  await call("/api/logout", { method: "POST", token: vic.token });
  assert.equal((await call("/api/overview", { token: vic.token })).status, 401);
  await call("/api/users/mia", { method: "PUT", token: ADMIN, body: { password: "another-pass" } });
  assert.equal((await call("/api/overview", { token: mia.token })).status, 401);
  assert.equal((await call("/api/overview")).status, 401, "no token, no dashboard");
});

test("share links read one project and nothing else", async () => {
  const link = await call<{ code: string; id: string }>("/api/projects/shop/share-links", { method: "POST", token: ADMIN, body: { label: "demo" } });
  const code = link.json.code;
  assert.match(code, /^gtvl_/);
  const me = await call<any>("/api/me", { token: code });
  assert.deepEqual([me.json.role, me.json.project], ["viewer", "shop"]);

  const o = await call<any>("/api/overview", { token: code });
  assert.deepEqual(
    o.json.projects.map((p: any) => p.id),
    ["shop"],
  );
  assert.deepEqual(o.json.devs, []);
  assert.equal((await call("/api/projects/shop", { token: code })).status, 200);
  assert.equal((await call("/v1/p/shop/state", { token: code })).status, 200);
  assert.equal((await call("/api/projects/blog", { token: code })).status, 403);
  assert.equal((await call("/v1/p/blog/state", { token: code })).status, 403);
  assert.equal((await call("/api/devs", { token: code })).status, 403);
  assert.equal((await call("/api/projects/shop/share-links", { token: code })).status, 403);
  assert.equal((await call("/v1/p/shop/conflicts/x/ack", { method: "POST", token: code })).status, 403);

  await call(`/api/projects/shop/share-links/${link.json.id}`, { method: "DELETE", token: ADMIN });
  assert.equal((await call("/api/me", { token: code })).status, 401, "revoked");
});

const startSession = (project: string, dev: string, token = ADMIN) =>
  call<any>(`/v1/p/${project}/events`, {
    method: "POST",
    token,
    dev,
    body: { type: "session_start", session: { dev, agent: "claude", workspace_id: `ws_${dev}`, workspace_label: dev, agent_session_id: `s-${dev}` } },
  });

test("members: everyone who works is a member; managers set role and level; agents see the team", async () => {
  await startSession("shop", "alice");
  const m = await call<any[]>("/api/projects/shop/members", { token: ADMIN });
  assert.deepEqual(
    m.json.map((x) => [x.dev, x.role, x.level]),
    [["alice", "developer", "mid"]],
  );
  await call("/api/users/lead", { method: "PUT", token: ADMIN, body: { role: "manager", password: "lead-pass-1" } });
  await call("/api/users/watch", { method: "PUT", token: ADMIN, body: { role: "viewer", password: "watch-pass-1" } });
  const lead = await login("lead", "lead-pass-1");
  const watch = await login("watch", "watch-pass-1");
  assert.equal((await call("/api/projects/shop/members/bob", { method: "PUT", token: watch.token, body: { role: "frontend", level: "junior" } })).status, 403);
  const bob = await call<any>("/api/projects/shop/members/bob", { method: "PUT", token: lead.token, body: { role: "frontend", level: "junior" } });
  assert.equal(bob.json.level, "junior");
  assert.equal((await call("/api/projects/shop/members/bob", { method: "PUT", token: lead.token, body: { level: "guru" } })).status, 400);
  await call("/api/projects/shop/members/alice", { method: "PUT", token: lead.token, body: { role: "tech lead", level: "lead" } });

  const s = await startSession("shop", "bob");
  assert.match(s.json.results[0].briefing, /Team: alice — tech lead, lead; bob \(you\) — frontend, junior/);
  const o = await call<any>("/api/projects/shop", { token: watch.token });
  assert.equal(o.json.people.find((p: any) => p.dev === "alice").level, "lead");
  assert.equal((await call("/api/projects/shop/members/bob", { method: "DELETE", token: lead.token })).status, 200);
});

test("charter: managers set it, agents get it in the briefing and in gtv_status state", async () => {
  await call("/api/users/pm", { method: "PUT", token: ADMIN, body: { role: "manager", password: "pm-pass-123" } });
  const pm = await login("pm", "pm-pass-123");
  const res = await call<any>("/api/projects/shop", {
    method: "PATCH",
    token: pm.token,
    body: {
      charter: { goal: "Shop MVP", users: "100 beta users", deadline: "2027-01-31", quality: "mvp", stack: ["Node", " Postgres ", ""], deadline_bad: 1 },
    },
  });
  assert.deepEqual(res.json.charter.stack, ["Node", "Postgres"]);
  assert.equal(res.json.charter.quality, "mvp");
  assert.equal(
    (await call("/api/projects/shop", { method: "PATCH", token: pm.token, body: { charter: { deadline: "soon" } } })).json.charter.deadline,
    undefined,
  );
  await call("/api/projects/shop", {
    method: "PATCH",
    token: pm.token,
    body: { charter: { goal: "Shop MVP", deadline: "2027-01-31", stack: ["Node", "Postgres"] } },
  });
  const s = await startSession("shop", "carol");
  assert.match(s.json.results[0].briefing, /Project charter[\s\S]*Goal: Shop MVP[\s\S]*Deadline: 2027-01-31[\s\S]*Stack .*Node, Postgres/);
  const st = await call<any>("/v1/p/shop/state", { token: ADMIN });
  assert.equal(st.json.charter.goal, "Shop MVP");
});
