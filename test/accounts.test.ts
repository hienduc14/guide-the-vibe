// Accounts in projects: deleting an account removes it from projects; read-only share links; members and charter.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, type Running } from "../src/server/main.ts";
import { loadConfig } from "../src/server/config.ts";
import { NullBrain } from "../src/server/brain/types.ts";
import { addPerson, makeOrigin, tempDir, type Origin } from "./helpers.ts";

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

test("deleting an account removes its computers, sessions and memberships", async () => {
  const gone = await addPerson(srv, "gone", { password: "gone-password", projects: { shop: "developer" } });
  assert.equal((await call("/v1/p/shop/state", { token: gone.device })).status, 200);
  const users = (await call<any[]>("/api/admin/users", { token: ADMIN })).json;
  assert.deepEqual([users.find((u) => u.name === "gone").devices, users.find((u) => u.name === "gone").projects], [1, 1]);
  assert.equal((await call("/api/admin/users/gone", { method: "DELETE", token: ADMIN })).status, 200);
  assert.equal((await call("/v1/p/shop/state", { token: gone.device })).status, 401);
  assert.equal((await call("/api/me", { token: gone.session })).status, 401);
  assert.equal(srv.hub.live("shop")!.engine.store.member("gone"), undefined);
});

test("share links read one project and nothing else", async () => {
  const link = await call<{ code: string; id: string }>("/api/projects/shop/share-links", { method: "POST", token: ADMIN, body: { label: "demo" } });
  const code = link.json.code;
  assert.match(code, /^gtvl_/);
  const me = await call<any>("/api/me", { token: code });
  assert.deepEqual([me.json.kind, me.json.project], ["share", "shop"]);

  const o = await call<any>("/api/overview", { token: code });
  assert.deepEqual(
    o.json.projects.map((p: any) => p.id),
    ["shop"],
  );
  assert.equal((await call("/api/projects/shop", { token: code })).status, 200);
  assert.equal((await call("/v1/p/shop/state", { token: code })).status, 200);
  assert.equal((await call("/api/projects/blog", { token: code })).status, 404, "another project does not exist for it");
  assert.equal((await call("/v1/p/blog/state", { token: code })).status, 404);
  assert.equal((await call("/api/admin/users", { token: code })).status, 403);
  assert.equal((await call("/api/projects/shop/share-links", { token: code })).status, 403);
  assert.equal((await call("/v1/p/shop/conflicts/x/ack", { method: "POST", token: code })).status, 403);

  await call(`/api/projects/shop/share-links/${link.json.id}`, { method: "DELETE", token: ADMIN });
  assert.equal((await call("/api/me", { token: code })).status, 401, "revoked");
});

test("members: managers set role, level and access; agents see the team", async () => {
  const lead = await addPerson(srv, "lead", { password: "lead-pass-1", projects: { shop: "manager" } });
  const watch = await addPerson(srv, "watch", { password: "watch-pass-1", projects: { shop: "viewer" } });
  await addPerson(srv, "bob", { projects: { shop: "developer" } });
  assert.equal((await call("/api/projects/shop/members/bob", { method: "PATCH", token: watch.session, body: { role: "frontend" } })).status, 403);
  assert.match((await call<any>("/api/projects/shop/members/nobody", { method: "PATCH", token: lead.session, body: {} })).json.error, /not a member/);
  const bob = await call<any>("/api/projects/shop/members/bob", { method: "PATCH", token: lead.session, body: { role: "frontend", level: "junior" } });
  assert.deepEqual([bob.json.level, bob.json.access], ["junior", "developer"]);
  assert.equal((await call("/api/projects/shop/members/bob", { method: "PATCH", token: lead.session, body: { level: "guru" } })).status, 400);
  assert.equal((await call("/api/projects/shop/members/bob", { method: "PATCH", token: lead.session, body: { access: "owner" } })).status, 400);
  await call("/api/projects/shop/members/lead", { method: "PATCH", token: lead.session, body: { role: "tech lead", level: "lead" } });
  assert.equal(srv.hub.live("shop")!.engine.store.member("lead")?.access, "manager", "role and level leave access alone");

  const s = await call<any>("/v1/p/shop/events", {
    method: "POST",
    token: ADMIN,
    dev: "bob",
    body: { type: "session_start", session: { dev: "bob", agent: "claude", workspace_id: "ws_bob", workspace_label: "bob", agent_session_id: "s-bob" } },
  });
  assert.match(s.json.results[0].briefing, /Team: .*bob \(you\) — frontend, junior.*lead — tech lead, lead/);
  assert.equal((await call("/api/projects/shop/members/bob", { method: "DELETE", token: lead.session })).status, 200);
  assert.equal(srv.hub.live("shop")!.engine.store.member("bob"), undefined);
});

test("charter: managers set it, agents get it in the briefing and in gtv_status state", async () => {
  const pm = await addPerson(srv, "pma", { password: "pm-pass-123", projects: { shop: "manager" } });
  const res = await call<any>("/api/projects/shop", {
    method: "PATCH",
    token: pm.session,
    body: {
      charter: { goal: "Shop MVP", users: "100 beta users", deadline: "2027-01-31", quality: "mvp", stack: ["Node", " Postgres ", ""], deadline_bad: 1 },
    },
  });
  assert.deepEqual(res.json.charter.stack, ["Node", "Postgres"]);
  assert.equal(res.json.charter.quality, "mvp");
  assert.equal(
    (await call("/api/projects/shop", { method: "PATCH", token: pm.session, body: { charter: { deadline: "soon" } } })).json.charter.deadline,
    undefined,
  );
  await call("/api/projects/shop", {
    method: "PATCH",
    token: pm.session,
    body: { charter: { goal: "Shop MVP", deadline: "2027-01-31", stack: ["Node", "Postgres"] } },
  });
  const carol = await addPerson(srv, "carol", { projects: { shop: "developer" } });
  const s = await call<any>("/v1/p/shop/events", {
    method: "POST",
    token: carol.device,
    body: { type: "session_start", session: { dev: "carol", agent: "claude", workspace_id: "ws_carol", workspace_label: "c", agent_session_id: "s-carol" } },
  });
  assert.match(s.json.results[0].briefing, /Project charter[\s\S]*Goal: Shop MVP[\s\S]*Deadline: 2027-01-31[\s\S]*Stack .*Node, Postgres/);
  const st = await call<any>("/v1/p/shop/state", { token: ADMIN });
  assert.equal(st.json.charter.goal, "Shop MVP");
});
