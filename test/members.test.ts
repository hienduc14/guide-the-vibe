// Project members (hub.db): managers add people by name and change access; a project always keeps a manager;
// leaving or being removed takes effect on the next call; access is known before a project's runtime opens.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, type Running } from "../src/server/main.ts";
import { loadConfig } from "../src/server/config.ts";
import { NullBrain } from "../src/server/brain/types.ts";
import { Hub } from "../src/server/hub/hub.ts";
import { api, connectDevice, makeOrigin, newProject, signup, tempDir, type Origin } from "./helpers.ts";

process.env.GTV_QUIET = "1";

const ADMIN = "admin-secret";
const cfg = loadConfig({ GTV_DATA: tempDir(), GTV_POLL_MS: "3600000", GTV_ADMIN_TOKEN: ADMIN } as NodeJS.ProcessEnv);
let srv: Running;
let origin: Origin;
const C: Record<string, string> = {};
const call = <T = any>(path: string, init: Parameters<typeof api>[2] = {}) => api<T>(srv.app, path, init);

test("setup", async () => {
  origin = await makeOrigin({ "src/a.ts": "export const a = 1\n" });
  srv = await startServer(cfg, { brain: new NullBrain(), listen: false });
  await call("/api/auth/setup", { method: "POST", body: { name: "boss", password: "boss-password", admin_token: ADMIN } });
  for (const n of ["hoc", "bob", "lan"]) C[n] = await signup(srv.app, n);
  await newProject(srv, C.hoc, "shop", origin.bare);
});

after(async () => {
  await srv?.close();
  origin?.cleanup();
});

test("a manager adds people who have an account, by name", async () => {
  const add = (user: string, access?: string, cookie = C.hoc) => call("/api/projects/shop/members", { method: "POST", cookie, body: { user, access } });
  const bob = await add("bob");
  assert.deepEqual([bob.status, bob.json.dev, bob.json.access, bob.json.display_name, bob.json.invited_by], [200, "bob", "developer", "BOB", "hoc"]);
  assert.match((await add("nobody")).json.error, /no account named nobody/);
  assert.match((await add("bob")).json.error, /already a member/);
  assert.equal((await add("lan", "viewer", C.bob)).status, 403, "developers do not add people");
  assert.equal((await add("lan", "viewer")).status, 200);
  assert.deepEqual(
    (await call<any[]>("/api/projects/shop/members", { cookie: C.lan })).json.map((m) => [m.dev, m.access]),
    [
      ["bob", "developer"],
      ["hoc", "manager"],
      ["lan", "viewer"],
    ],
  );
});

test("the last manager cannot be lowered, removed or leave, nor delete their account", async () => {
  const patch = (user: string, access: string, cookie = C.hoc) => call(`/api/projects/shop/members/${user}`, { method: "PATCH", cookie, body: { access } });
  assert.match((await patch("hoc", "developer")).json.error, /last manager/);
  assert.match((await call("/api/projects/shop/members/hoc", { method: "DELETE", cookie: C.hoc })).json.error, /last manager/);
  assert.match((await call("/api/me", { method: "DELETE", cookie: C.hoc, body: { password: "hoc-password" } })).json.error, /last manager of shop/);
  assert.equal((await patch("bob", "manager", C.bob)).status, 403);
  assert.equal((await patch("bob", "manager")).status, 200);
  assert.equal((await patch("hoc", "developer")).status, 200, "bob manages now");
  assert.equal((await patch("bob", "viewer", C.hoc)).status, 403, "hoc is a developer now");
  assert.equal((await patch("hoc", "manager", C.bob)).status, 200);
});

test("leaving or being removed works at once, for the dashboard and the computer", async () => {
  await call("/api/projects/shop/members/lan", { method: "PATCH", cookie: C.hoc, body: { access: "developer" } });
  const key = await connectDevice(srv.app, C.lan);
  assert.equal((await call("/v1/p/shop/state", { token: key.token })).status, 200);
  assert.equal((await call("/api/projects/shop/members/bob", { method: "DELETE", cookie: C.lan })).status, 403, "only managers remove others");
  assert.equal((await call("/api/projects/shop/members/lan", { method: "DELETE", cookie: C.lan })).status, 200, "anyone leaves");
  assert.equal((await call("/v1/p/shop/state", { token: key.token })).status, 403);
  assert.equal((await call("/api/projects/shop", { cookie: C.lan })).status, 404);
  assert.deepEqual((await call("/v1/me", { token: key.token })).json.projects, []);

  await call("/api/projects/shop/members", { method: "POST", cookie: C.hoc, body: { user: "lan" } });
  assert.equal((await call("/v1/p/shop/state", { token: key.token })).status, 200);
  assert.equal((await call("/api/projects/shop/members/lan", { method: "DELETE", cookie: C.bob })).status, 200, "bob is a manager");
  assert.equal((await call("/v1/p/shop/state", { token: key.token })).status, 403);
  const events = (await call<any[]>("/api/projects/shop/activity", { cookie: C.hoc })).json.map((e) => e.type);
  assert.ok(events.includes("member_left") && events.includes("member_removed"));
});

test("access is read from the hub before any project runtime opens", async () => {
  const fresh = new Hub(cfg, new NullBrain());
  try {
    assert.equal(fresh.live("shop"), undefined);
    assert.equal(fresh.projectAccess({ kind: "user", name: "bob", role: "member" }, "shop"), "manager");
    assert.equal(fresh.projectAccess({ kind: "user", name: "lan", role: "member" }, "shop"), "none");
    assert.deepEqual(
      fresh.myProjects({ kind: "user", name: "hoc", role: "member" }).map((p) => [p.record.id, p.access]),
      [["shop", "manager"]],
    );
  } finally {
    fresh.db.close();
  }
});
