// My computers: each daemon reports its gtv version, agents and the repos where gtv is on; sessions carry the computer
// they run on; the owner sees it all, project members see only computer names, server admins see paths too.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, type Running } from "../src/server/main.ts";
import { loadConfig } from "../src/server/config.ts";
import { NullBrain } from "../src/server/brain/types.ts";
import { api, connectDevice, makeOrigin, newProject, signup, tempDir, type Origin } from "./helpers.ts";

process.env.GTV_QUIET = "1";

const ADMIN = "admin-secret";
let srv: Running;
let origin: Origin;
let boss: string;
let hoc: string;
let bob: string;
let key: { token: string; device_id: string };
const call = <T = any>(path: string, init: Parameters<typeof api>[2] = {}) => api<T>(srv.app, path, init);
const REPO = "/home/hoc/code/shop";

test("setup", async () => {
  origin = await makeOrigin({ "src/a.ts": "export const a = 1\n" });
  srv = await startServer(loadConfig({ GTV_DATA: tempDir(), GTV_POLL_MS: "3600000", GTV_ADMIN_TOKEN: ADMIN } as NodeJS.ProcessEnv), {
    brain: new NullBrain(),
    listen: false,
  });
  boss = (await call("/api/auth/setup", { method: "POST", body: { name: "boss", password: "boss-password", admin_token: ADMIN } })).cookie!;
  hoc = await signup(srv.app, "hoc");
  bob = await signup(srv.app, "bob");
  await newProject(srv, hoc, "shop", origin.bare);
  await call("/api/projects/shop/members", { method: "POST", cookie: hoc, body: { user: "bob", access: "developer" } });
  key = await connectDevice(srv.app, hoc, "thaihoc-laptop");
});

after(async () => {
  await srv?.close();
  origin?.cleanup();
});

test("a computer reports its agents and repos; sessions carry the computer they run on", async () => {
  const report = {
    gtv_version: "0.2.0",
    agents: [
      { kind: "claude", version: "2.4.1" },
      { kind: "codex", version: "0.99" },
    ],
    repos: [
      { path: REPO, project: "shop", agents: ["claude", "codex"] },
      { path: "/home/hoc/code/other", project: "someone-elses", agents: ["claude"] },
    ],
  };
  assert.equal((await call("/v1/me/device", { method: "POST", token: key.token, body: report })).status, 200);
  assert.equal((await call("/v1/me/device", { method: "POST", cookie: hoc, body: report })).status, 400, "computers only");
  assert.equal((await call("/v1/me/device", { method: "POST", body: report })).status, 401);
  const start = await call("/v1/p/shop/events", {
    method: "POST",
    token: key.token,
    body: { type: "session_start", session: { dev: "hoc", agent: "codex", workspace_id: "ws_hoc", workspace_label: "hoc", cwd: REPO, device: "dv_forged" } },
  });
  assert.equal(start.json.results[0].session.device, key.device_id, "the server decides the computer, from the key");

  const [d] = (await call<any[]>("/api/me/devices", { cookie: hoc })).json;
  assert.deepEqual([d.id, d.name, d.platform, d.online, d.gtv_version, d.agents], [key.device_id, "thaihoc-laptop", "linux", true, "0.2.0", report.agents]);
  assert.deepEqual(
    d.repos.map((r: any) => [r.path, r.project, r.project_name, r.agents, r.sessions.map((s: any) => s.agent)]),
    [
      ["/home/hoc/code/other", "someone-elses", null, ["claude"], []],
      [REPO, "shop", "SHOP", ["claude", "codex"], ["codex"]],
    ],
  );
  assert.deepEqual(
    d.sessions.map((s: any) => [s.project, s.agent, s.status, s.cwd]),
    [["shop", "codex", "active", REPO]],
  );

  srv.hub.db.run(`UPDATE devices SET last_seen = '2026-01-01T00:00:00.000Z'`);
  assert.equal((await call<any[]>("/api/me/devices", { cookie: hoc })).json[0].online, false, "not seen in the last minute");
});

test("a report is trimmed to what it should hold", async () => {
  await call("/v1/me/device", { method: "POST", token: key.token, body: { gtv_version: 7, agents: [{ kind: 5 }, "x"], repos: "nope" } });
  const [d] = (await call<any[]>("/api/me/devices", { cookie: hoc })).json;
  assert.deepEqual([d.gtv_version, d.agents, d.repos], [null, [], []]);
  await call("/v1/me/device", {
    method: "POST",
    token: key.token,
    body: { gtv_version: "0.2.0", repos: [{ path: REPO, project: "shop", agents: ["claude"] }] },
  });
});

test("members see computers by name only; the owner and server admins see the folders", async () => {
  const members = (await call<any[]>("/api/projects/shop/members", { cookie: bob })).json;
  assert.deepEqual(
    members.find((m) => m.dev === "hoc").devices.map((d: any) => d.name),
    ["thaihoc-laptop"],
  );
  assert.ok(!JSON.stringify(members).includes("/home/hoc"), "no paths for other members");
  assert.equal((await call("/api/admin/users/hoc/devices", { cookie: bob })).status, 403);
  assert.equal((await call<any[]>("/api/admin/users/hoc/devices", { cookie: boss })).json[0].repos[0].path, REPO);
  assert.deepEqual((await call<any[]>("/api/me/devices", { cookie: bob })).json, []);
});

test("rename and disconnect one's own computer only", async () => {
  assert.equal((await call(`/api/me/devices/${key.device_id}`, { method: "PATCH", cookie: bob, body: { name: "mine now" } })).status, 400);
  assert.equal((await call(`/api/me/devices/${key.device_id}`, { method: "PATCH", cookie: hoc, body: { name: "" } })).status, 400);
  assert.equal((await call(`/api/me/devices/${key.device_id}`, { method: "PATCH", cookie: hoc, body: { name: "lab-pc" } })).status, 200);
  assert.deepEqual((await call("/v1/me", { token: key.token })).json.device, { id: key.device_id, name: "lab-pc" });
  assert.equal((await call(`/api/me/devices/${key.device_id}`, { method: "DELETE", cookie: bob })).status, 400);
  assert.equal((await call(`/api/me/devices/${key.device_id}`, { method: "DELETE", cookie: hoc })).status, 200);
  assert.equal((await call("/v1/me", { token: key.token })).status, 401);
  assert.equal(srv.hub.accounts.deviceRepos(key.device_id).length, 0);
});
