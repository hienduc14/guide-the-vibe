// Accounts and dashboard sessions: setting up an empty server, signing up (and the sign-up modes), logging in with a
// cookie that only same-site pages can write with, sessions, passwords, reset links, locking and deleting accounts.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, type Running } from "../src/server/main.ts";
import { loadConfig } from "../src/server/config.ts";
import { NullBrain } from "../src/server/brain/types.ts";
import { api, connectDevice, signup, tempDir } from "./helpers.ts";

process.env.GTV_QUIET = "1";

const ADMIN = "admin-secret";
const servers: Running[] = [];
let srv: Running;
let boss: string; // the admin's session cookie

const server = async (env: Record<string, string> = {}) => {
  const s = await startServer(loadConfig({ GTV_DATA: tempDir(), GTV_POLL_MS: "3600000", ...env } as NodeJS.ProcessEnv), {
    brain: new NullBrain(),
    listen: false,
  });
  servers.push(s);
  return s;
};
const call = <T = any>(path: string, init: Parameters<typeof api>[2] = {}) => api<T>(srv.app, path, init);
const login = (name: string, password: string, headers?: Record<string, string>) =>
  call("/api/auth/login", { method: "POST", body: { name, password }, headers });

after(async () => {
  for (const s of servers) await s.close();
});

test("first start: the admin is set up with the admin token, then the server is set up", async () => {
  srv = await server({ GTV_ADMIN_TOKEN: ADMIN });
  assert.deepEqual((await call("/api/auth/config")).json, { setup_needed: true, registration: "open", needs_admin_token: true });
  assert.equal((await call("/api/auth/signup", { method: "POST", body: { name: "early", password: "early-password" } })).status, 403, "set up first");
  const body = { name: "boss", display_name: "The Boss", password: "boss-password" };
  assert.equal((await call("/api/auth/setup", { method: "POST", body })).status, 403, "a stranger cannot take the server");
  const ok = await call("/api/auth/setup", { method: "POST", body: { ...body, admin_token: ADMIN } });
  assert.deepEqual([ok.status, ok.json], [200, { name: "boss", display_name: "The Boss", role: "admin" }]);
  boss = ok.cookie!;
  assert.match(boss, /^gtvs_/);
  assert.equal((await call("/api/auth/setup", { method: "POST", body: { ...body, name: "boss2", admin_token: ADMIN } })).status, 409);
  assert.equal((await call("/api/auth/config")).json.setup_needed, false);
  const me = await call("/api/me", { cookie: boss });
  assert.deepEqual([me.json.name, me.json.display_name, me.json.role, me.json.projects], ["boss", "The Boss", "admin", []]);
});

test("without an admin token whoever comes first is the admin", async () => {
  const s = await server();
  assert.equal((await api(s.app, "/api/auth/config")).json.needs_admin_token, false);
  const r = await api(s.app, "/api/auth/setup", { method: "POST", body: { name: "first", password: "first-password" } });
  assert.deepEqual([r.status, r.json.role, r.json.display_name], [200, "admin", "first"]);
});

test("sign-up: unique, valid and unreserved names; the admin picks open, invite-only or closed", async () => {
  const mia = await signup(srv.app, "mia");
  assert.deepEqual((await call("/api/me", { cookie: mia })).json.role, "member");
  const bad = async (name: string, password = "long-enough") => (await call("/api/auth/signup", { method: "POST", body: { name, password } })).json.error;
  assert.match(await bad("mia"), /taken/);
  assert.match(await bad("admin"), /reserved/);
  assert.match(await bad("Mia"), /lowercase/);
  assert.match(await bad("ab"), /3-32/);
  assert.match(await bad("newbie", "short"), /at least 8/);

  assert.equal((await call("/api/admin/settings", { method: "PUT", cookie: mia, body: { registration: "closed" } })).status, 403);
  assert.equal((await call("/api/admin/settings", { method: "PUT", cookie: boss, body: { registration: "bogus" } })).status, 400);
  for (const [mode, error] of [
    ["invite", /needs an invite/],
    ["closed", /closed/],
  ] as const) {
    assert.deepEqual((await call("/api/admin/settings", { method: "PUT", cookie: boss, body: { registration: mode } })).json, { registration: mode });
    assert.equal((await call("/api/auth/config")).json.registration, mode);
    const r = await call("/api/auth/signup", { method: "POST", body: { name: "newbie", password: "long-enough" } });
    assert.deepEqual([r.status, error.test(r.json.error)], [403, true]);
  }
  await call("/api/admin/settings", { method: "PUT", cookie: boss, body: { registration: "open" } });
});

test("the session is an httpOnly cookie; cookie writes need this server's Origin", async () => {
  const r = await srv.app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
    body: JSON.stringify({ name: "mia", password: "mia-password" }),
  });
  const set = r.headers.get("set-cookie")!;
  assert.match(set, /^gtv_session=gtvs_/);
  for (const attr of [/HttpOnly/, /SameSite=Lax/, /Secure/, /Path=\//, /Max-Age=2592000/]) assert.match(set, attr);
  assert.ok(!JSON.stringify(await r.json()).includes("gtvs_"), "the token never reaches the page's JavaScript");
  const mia = /gtv_session=([^;]*)/.exec(set)![1];

  const patch = (headers: Record<string, string>) =>
    srv.app.request("/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: `gtv_session=${mia}`, ...headers },
      body: '{"display_name":"Mia"}',
    });
  assert.equal((await patch({})).status, 403, "no Origin");
  assert.equal((await patch({ origin: "https://evil.example" })).status, 403, "another site");
  assert.equal((await patch({ origin: "http://localhost" })).status, 200);
  assert.equal((await srv.app.request("/api/me", { headers: { cookie: `gtv_session=${mia}` } })).status, 200, "reads need no Origin");
  assert.equal((await call("/api/me", { cookie: mia })).json.display_name, "Mia");
  assert.equal((await call("/api/me", { method: "PATCH", token: ADMIN, body: {}, headers: { origin: "https://evil.example" } })).status, 403);
});

test("wrong passwords are limited to 10 a minute per address", async () => {
  const headers = { "x-forwarded-for": "203.0.113.9" };
  const statuses = [];
  for (let i = 0; i < 11; i++) statuses.push((await login("mia", "nope", headers)).status);
  assert.deepEqual([statuses[9], statuses[10]], [400, 429]);
  assert.equal((await login("mia", "nope", { "x-forwarded-for": "203.0.113.10" })).status, 400);
});

test("sessions: list, log out one, log out everywhere else; logging out ends this one", async () => {
  const a = (await login("mia", "mia-password", { "user-agent": "Browser A" })).cookie!;
  const b = (await login("mia", "mia-password", { "user-agent": "Browser B" })).cookie!;
  const list = (await call<any[]>("/api/me/sessions", { cookie: a })).json;
  const mine = list.find((s) => s.current);
  assert.equal(mine.user_agent, "Browser A");
  assert.ok(list.some((s) => s.user_agent === "Browser B" && !s.current));
  assert.equal((await call("/api/me/sessions", { method: "DELETE", cookie: a })).status, 200);
  assert.equal((await call("/api/me", { cookie: b })).status, 401);
  assert.equal((await call("/api/me", { cookie: a })).status, 200);
  assert.deepEqual((await call<any[]>("/api/me/sessions", { cookie: a })).json.length, 1);

  const c = (await login("mia", "mia-password")).cookie!;
  const cId = (await call<any[]>("/api/me/sessions", { cookie: c })).json.find((s) => s.current).id;
  await call(`/api/me/sessions/${cId}`, { method: "DELETE", cookie: a });
  assert.equal((await call("/api/me", { cookie: c })).status, 401);

  const out = await call("/api/auth/logout", { method: "POST", cookie: a });
  assert.equal(out.status, 200);
  assert.equal((await call("/api/me", { cookie: a })).status, 401);
});

test("changing the password logs out the other sessions; the computer stays connected", async () => {
  const a = (await login("mia", "mia-password")).cookie!;
  const b = (await login("mia", "mia-password")).cookie!;
  const key = await connectDevice(srv.app, a);
  assert.equal((await call("/api/me/password", { method: "PUT", cookie: a, body: { current: "wrong-one", password: "new-password" } })).status, 400);
  assert.equal((await call("/api/me/password", { method: "PUT", cookie: a, body: { current: "mia-password", password: "new-password" } })).status, 200);
  assert.equal((await call("/api/me", { cookie: a })).status, 200);
  assert.equal((await call("/api/me", { cookie: b })).status, 401);
  assert.equal((await call("/v1/me", { token: key.token })).status, 200);
  assert.equal((await login("mia", "new-password")).status, 200);
});

test("a reset link from the admin works once, within an hour, and logs out the old sessions", async () => {
  const old = (await login("mia", "new-password")).cookie!;
  assert.equal((await call("/api/admin/users/mia/reset", { method: "POST", cookie: old })).status, 403);
  const r = await call("/api/admin/users/mia/reset", { method: "POST", cookie: boss });
  assert.match(r.json.reset_url, /^http:\/\/localhost\/reset\/[\w-]+$/);
  const code = r.json.reset_url.split("/reset/")[1];
  assert.deepEqual((await call(`/api/auth/reset/${code}`)).json.user, "mia");
  assert.equal((await call(`/api/auth/reset/${code}`, { method: "POST", body: { password: "short" } })).status, 400);
  const done = await call(`/api/auth/reset/${code}`, { method: "POST", body: { password: "reset-password" } });
  assert.equal(done.status, 200);
  assert.equal((await call("/api/me", { cookie: done.cookie })).json.name, "mia", "logged in");
  assert.equal((await call("/api/me", { cookie: old })).status, 401);
  assert.equal((await call(`/api/auth/reset/${code}`, { method: "POST", body: { password: "again-password" } })).status, 400, "once");

  const late = (await call("/api/admin/users/mia/reset", { method: "POST", cookie: boss })).json.reset_url.split("/reset/")[1];
  srv.hub.db.run(`UPDATE password_resets SET expires_at = '2000-01-01T00:00:00.000Z'`);
  assert.equal((await call(`/api/auth/reset/${late}`)).status, 400, "expired");
});

test("a locked account can neither log in nor use its sessions or computers, until it is unlocked", async () => {
  const pat = await signup(srv.app, "pat");
  const key = await connectDevice(srv.app, pat);
  assert.equal((await call("/api/admin/users/pat", { method: "PATCH", cookie: boss, body: { disabled: true } })).json.disabled_at !== null, true);
  assert.equal((await call("/api/me", { cookie: pat })).status, 401);
  assert.equal((await call("/v1/me", { token: key.token })).status, 401);
  assert.match((await login("pat", "pat-password")).json.error, /locked/);
  const users = (await call<any[]>("/api/admin/users", { cookie: boss })).json;
  assert.deepEqual((({ name, disabled, devices, projects }) => ({ name, disabled, devices, projects }))(users.find((u) => u.name === "pat")), {
    name: "pat",
    disabled: true,
    devices: 1,
    projects: 0,
  });
  await call("/api/admin/users/pat", { method: "PATCH", cookie: boss, body: { disabled: false } });
  assert.equal((await call("/api/me", { cookie: pat })).status, 200);
  assert.equal((await call("/v1/me", { token: key.token })).status, 200);
});

test("admins: one always remains; members cannot manage accounts", async () => {
  const pat = (await login("pat", "pat-password")).cookie!;
  assert.equal((await call("/api/admin/users", { cookie: pat })).status, 403);
  assert.match((await call("/api/admin/users/boss", { method: "PATCH", cookie: boss, body: { role: "member" } })).json.error, /last admin/);
  assert.match((await call("/api/admin/users/boss", { method: "PATCH", cookie: boss, body: { disabled: true } })).json.error, /last admin/);
  assert.match((await call("/api/admin/users/boss", { method: "DELETE", cookie: boss })).json.error, /last admin/);
  assert.equal((await call("/api/admin/users/pat", { method: "PATCH", cookie: boss, body: { role: "owner" } })).status, 400);
  assert.equal((await call("/api/admin/users/pat", { method: "PATCH", cookie: boss, body: { role: "admin" } })).status, 200);
  assert.equal((await call("/api/admin/users", { cookie: pat })).status, 200, "now an admin");
  assert.equal((await call("/api/admin/users/boss", { method: "PATCH", cookie: boss, body: { role: "member" } })).status, 200, "pat is an admin too");
  assert.equal((await call("/api/admin/users", { cookie: boss })).status, 403);
  await call("/api/admin/users/boss", { method: "PATCH", cookie: pat, body: { role: "admin" } });
});

test("deleting an account ends its sessions and computers; its name is never given out again", async () => {
  const gone = await signup(srv.app, "gone");
  const key = await connectDevice(srv.app, gone);
  assert.equal((await call("/api/me", { method: "DELETE", cookie: gone, body: { password: "wrong" } })).status, 400);
  assert.equal((await call("/api/me", { method: "DELETE", cookie: gone, body: { password: "gone-password" } })).status, 200);
  assert.equal((await call("/api/me", { cookie: gone })).status, 401);
  assert.equal((await call("/v1/me", { token: key.token })).status, 401);
  assert.equal((await login("gone", "gone-password")).status, 400);
  assert.match((await call("/api/auth/signup", { method: "POST", body: { name: "gone", password: "gone-password" } })).json.error, /taken/);
  assert.ok(!(await call<any[]>("/api/admin/users", { cookie: boss })).json.some((u) => u.name === "gone"));

  const pat2 = await signup(srv.app, "pat2");
  assert.equal((await call("/api/admin/users/pat2", { method: "DELETE", cookie: boss })).status, 200);
  assert.equal((await call("/api/me", { cookie: pat2 })).status, 401);
});
