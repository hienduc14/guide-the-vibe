// Invite links: managers make them (developer or viewer, 1/7/30 days, 1/10/unlimited uses); anyone sees the card
// (project name, access, who invited); joining keeps an existing member's access; links expire, run out and are revoked.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, type Running } from "../src/server/main.ts";
import { loadConfig } from "../src/server/config.ts";
import { NullBrain } from "../src/server/brain/types.ts";
import { api, makeOrigin, newProject, signup, tempDir, type Origin } from "./helpers.ts";

process.env.GTV_QUIET = "1";

const ADMIN = "admin-secret";
let srv: Running;
let origin: Origin;
let boss: string;
const C: Record<string, string> = {};
const call = <T = any>(path: string, init: Parameters<typeof api>[2] = {}) => api<T>(srv.app, path, init);
const invite = async (body: Record<string, unknown> = {}, cookie = C.hoc) => {
  const r = await call("/api/projects/shop/invites", { method: "POST", cookie, body });
  return { ...r, code: r.json.url?.split("/join/")[1] as string };
};

test("setup", async () => {
  origin = await makeOrigin({ "src/a.ts": "export const a = 1\n" });
  srv = await startServer(loadConfig({ GTV_DATA: tempDir(), GTV_POLL_MS: "3600000", GTV_ADMIN_TOKEN: ADMIN } as NodeJS.ProcessEnv), {
    brain: new NullBrain(),
    listen: false,
  });
  boss = (await call("/api/auth/setup", { method: "POST", body: { name: "boss", password: "boss-password", admin_token: ADMIN } })).cookie!;
  for (const n of ["hoc", "bob", "lan"]) C[n] = await signup(srv.app, n);
  await newProject(srv, C.hoc, "shop", origin.bare);
  await call("/api/projects/shop/members", { method: "POST", cookie: C.hoc, body: { user: "lan", access: "viewer" } });
});

after(async () => {
  await srv?.close();
  origin?.cleanup();
});

test("only managers make links, never for manager access", async () => {
  assert.equal((await invite({}, C.lan)).status, 403);
  assert.match((await invite({ access: "manager" })).json.error, /developer or viewer/);
  assert.equal((await invite({ days: 3 })).status, 400);
  assert.equal((await invite({ max_uses: 5 })).status, 400);
  const r = await invite();
  assert.match(r.json.url, /^http:\/\/localhost\/join\/[\w-]{20,}$/);
  assert.deepEqual([r.json.access, r.json.max_uses, r.json.uses, r.json.created_by], ["developer", null, 0, "hoc"]);
  assert.ok(Math.abs(Date.parse(r.json.expires_at) - Date.now() - 7 * 86_400_000) < 60_000, "7 days by default");
});

test("anyone sees the card; joining makes a member; members keep their access", async () => {
  const { code } = await invite();
  const { expires_at, ...card } = (await call(`/api/invites/${code}`)).json;
  assert.deepEqual(card, { valid: true, project_name: "SHOP", access: "developer", invited_by: "hoc", invited_by_name: "HOC", member: false });
  assert.ok(Date.parse(expires_at) > Date.now(), "the card says when the link expires");
  assert.equal((await call(`/api/invites/${code}/accept`, { method: "POST" })).status, 401, "log in or sign up first");
  const joined = await call(`/api/invites/${code}/accept`, { method: "POST", cookie: C.bob });
  assert.deepEqual(joined.json, { project: { id: "shop", name: "SHOP" }, access: "developer", already_member: false });
  assert.deepEqual((await call(`/api/invites/${code}`, { cookie: C.bob })).json.member, true);
  assert.equal((await call(`/api/invites/${code}`, { cookie: C.bob })).json.project_id, "shop", "members get the way in");
  const again = await call(`/api/invites/${code}/accept`, { method: "POST", cookie: C.lan });
  assert.deepEqual([again.json.access, again.json.already_member], ["viewer", true], "a viewer stays a viewer");
  assert.equal((await call<any[]>("/api/projects/shop/invites", { cookie: C.hoc })).json.find((i) => i.id && i.uses === 1)?.uses, 1);
});

test("links stop working when used up, expired or revoked", async () => {
  const dead = { valid: false };
  const once = await invite({ max_uses: 1, access: "viewer" });
  const carol = await signup(srv.app, "carol", { invite: once.code });
  assert.deepEqual((await call("/api/me", { cookie: carol })).json.projects, [{ id: "shop", name: "SHOP", access: "viewer" }]);
  assert.deepEqual((await call(`/api/invites/${once.code}`)).json, dead);
  assert.match(
    (await call("/api/auth/signup", { method: "POST", body: { name: "dave", password: "dave-password", invite: once.code } })).json.error,
    /no longer works/,
  );
  assert.equal(srv.hub.accounts.user("dave"), undefined, "no account made from a dead link");

  const old = await invite();
  srv.hub.db.run(`UPDATE project_invites SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`, old.json.id);
  assert.deepEqual((await call(`/api/invites/${old.code}`)).json, dead);

  const gone = await invite();
  assert.equal((await call(`/api/projects/shop/invites/${gone.json.id}`, { method: "DELETE", cookie: C.hoc })).status, 200);
  assert.deepEqual((await call(`/api/invites/${gone.code}`)).json, dead);
  assert.match((await call(`/api/invites/${gone.code}/accept`, { method: "POST", cookie: carol })).json.error, /no longer works/);
  assert.ok(!(await call<any[]>("/api/projects/shop/invites", { cookie: C.hoc })).json.some((i) => [old.json.id, gone.json.id, once.json.id].includes(i.id)));
});

test("invite-only sign-up: a working link is the way in", async () => {
  await call("/api/admin/settings", { method: "PUT", cookie: boss, body: { registration: "invite" } });
  assert.equal((await call("/api/auth/signup", { method: "POST", body: { name: "erin", password: "erin-password" } })).status, 403);
  const { code } = await invite();
  const erin = await signup(srv.app, "erin", { invite: code });
  assert.equal((await call("/api/me", { cookie: erin })).json.projects[0].access, "developer");
  await call("/api/admin/settings", { method: "PUT", cookie: boss, body: { registration: "closed" } });
  assert.equal((await call("/api/auth/signup", { method: "POST", body: { name: "fay", password: "fay-password", invite: code } })).status, 403);
});
