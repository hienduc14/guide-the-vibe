// Connecting a computer to an account (gtv login): start → the person approves the code on the dashboard → the
// CLI's poll gets the key once. The key then works on /v1 until the computer logs out or is revoked.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, type Running } from "../src/server/main.ts";
import { loadConfig } from "../src/server/config.ts";
import { NullBrain } from "../src/server/brain/types.ts";
import { repoKey } from "../src/server/hub/hub.ts";
import { addPerson, makeOrigin, tempDir, type Origin } from "./helpers.ts";

process.env.GTV_QUIET = "1";

let srv: Running;
let origin: Origin;
let hoc: { session?: string };

async function call<T = any>(path: string, init: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...init.headers };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  const res = await srv.app.request(path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  return { status: res.status, json: (await res.json()) as T };
}

const start = () => call<any>("/v1/connect/start", { method: "POST", body: { device_name: "thaihoc-laptop", platform: "linux" } });
const poll = (device_code: string) => call<any>("/v1/connect/poll", { method: "POST", body: { device_code } });

test("setup", async () => {
  origin = await makeOrigin({ "src/a.ts": "export const a = 1\n" });
  srv = await startServer(loadConfig({ GTV_DATA: tempDir(), GTV_POLL_MS: "3600000", GTV_ADMIN_TOKEN: "adm" } as NodeJS.ProcessEnv), {
    brain: new NullBrain(),
    listen: false,
  });
  await call("/api/projects", {
    method: "POST",
    token: "adm",
    body: { id: "shop", name: "Shop", repo_url: `${origin.bare}`, aliases: ["git@github.com:Org/Shop.git"] },
  });
  hoc = await addPerson(srv, "hoc", { password: "hoc-password", projects: { shop: "developer" } });
});

after(async () => {
  await srv?.close();
  origin?.cleanup();
});

test("approve: the poll hands the key over once; the key works for /v1/me and agent routes", async () => {
  const s = await start();
  assert.match(s.json.user_code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.match(s.json.verify_url, new RegExp(`/connect\\?code=${s.json.user_code}$`));
  assert.equal(s.json.interval, 2);
  assert.deepEqual((await poll(s.json.device_code)).json, { status: "pending" });

  assert.equal((await call(`/api/connect/${s.json.user_code}`)).status, 401, "only a logged-in person approves");
  const req = await call<any>(`/api/connect/${s.json.user_code.toLowerCase()}`, { token: hoc.session });
  assert.deepEqual([req.json.device_name, req.json.platform], ["thaihoc-laptop", "linux"]);
  assert.equal((await call(`/api/connect/${s.json.user_code}/approve`, { method: "POST", token: hoc.session })).status, 200);
  assert.equal((await call(`/api/connect/${s.json.user_code}/approve`, { method: "POST", token: hoc.session })).status, 400, "once");

  const got = await poll(s.json.device_code);
  assert.equal(got.json.status, "approved");
  assert.equal(got.json.user, "hoc");
  assert.match(got.json.token, /^gtvd_/);
  assert.match(got.json.device_id, /^dv_/);
  assert.equal((await poll(s.json.device_code)).status, 400, "the key is not handed out twice");

  const me = await call<any>("/v1/me", { token: got.json.token });
  assert.deepEqual(me.json.device, { id: got.json.device_id, name: "thaihoc-laptop" });
  assert.deepEqual(me.json.projects[0].repos.sort(), [repoKey(origin.bare), "org/shop"].sort());
  assert.equal(me.json.projects[0].access, "developer");
  assert.ok(!JSON.stringify(me.json).includes("://"), "never a URL that may hold a token");
  assert.equal((await call("/v1/p/shop/state", { token: got.json.token })).status, 200);
  const mine = await call<any[]>("/api/me/devices", { token: hoc.session });
  assert.ok(mine.json.some((d) => d.id === got.json.device_id && d.name === "thaihoc-laptop"));

  // Logging out revokes the key.
  assert.equal((await call("/v1/me/logout", { method: "POST", token: got.json.token })).status, 200);
  assert.equal((await call("/v1/me", { token: got.json.token })).status, 401);
});

test("deny and expiry end the request", async () => {
  const d = await start();
  await call(`/api/connect/${d.json.user_code}/deny`, { method: "POST", token: hoc.session });
  assert.match((await poll(d.json.device_code)).json.error, /denied/);
  assert.equal((await poll(d.json.device_code)).status, 400);

  const e = await start();
  srv.hub.db.run(`UPDATE device_requests SET expires_at = '2000-01-01T00:00:00.000Z'`);
  assert.equal((await call(`/api/connect/${e.json.user_code}`, { token: hoc.session })).status, 404);
  assert.equal((await call(`/api/connect/${e.json.user_code}/approve`, { method: "POST", token: hoc.session })).status, 400);
  assert.match((await poll(e.json.device_code)).json.error, /expired/);
});

test("a person revokes one of their computers from the dashboard; others' computers are out of reach", async () => {
  const s = await start();
  await call(`/api/connect/${s.json.user_code}/approve`, { method: "POST", token: hoc.session });
  const key = (await poll(s.json.device_code)).json;
  const other = await addPerson(srv, "khanh", { password: "khanh-password" });
  assert.equal((await call(`/api/me/devices/${key.device_id}`, { method: "DELETE", token: other.session })).status, 400);
  assert.equal((await call(`/api/me/devices/${key.device_id}`, { method: "DELETE", token: hoc.session })).status, 200);
  assert.equal((await call("/v1/me", { token: key.token })).status, 401);
});

test("short codes and passwords cannot be guessed quickly", async () => {
  const headers = { "x-forwarded-for": "203.0.113.9" };
  const statuses = [];
  for (let i = 0; i < 31; i++) statuses.push((await call("/api/login", { method: "POST", headers, body: { name: "hoc", password: "nope" } })).status);
  assert.equal(statuses.at(-2), 400);
  assert.equal(statuses.at(-1), 429);
  assert.equal((await call("/api/login", { method: "POST", headers: { "x-forwarded-for": "203.0.113.10" }, body: { name: "x", password: "y" } })).status, 400);
});
