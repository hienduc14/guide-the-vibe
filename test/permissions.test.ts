// Who may do what in a project: viewers read; developers answer their questions, update their own tasks, create tasks
// for themselves and edit documents; managers do everything in their project; computers work only where their person
// is a developer or manager.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, type Running } from "../src/server/main.ts";
import { loadConfig } from "../src/server/config.ts";
import { NullBrain } from "../src/server/brain/types.ts";
import { addPerson, makeOrigin, tempDir, type Origin } from "./helpers.ts";

process.env.GTV_QUIET = "1";

const ADMIN = "adm";
let srv: Running;
let a: Origin;
let b: Origin;
const P: Record<string, { device: string; session?: string }> = {};

async function call<T = any>(path: string, init: { method?: string; body?: unknown; token?: string; dev?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.dev) headers["x-gtv-dev"] = init.dev;
  const res = await srv.app.request(path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  return { status: res.status, json: (await res.json()) as T };
}
const as = (who: string) => P[who].session!;

test("setup", async () => {
  a = await makeOrigin({ "src/a.ts": "export const a = 1\n" });
  b = await makeOrigin({ "src/b.ts": "export const b = 1\n" });
  srv = await startServer(loadConfig({ GTV_DATA: tempDir(), GTV_POLL_MS: "3600000", GTV_ADMIN_TOKEN: ADMIN } as NodeJS.ProcessEnv), {
    brain: new NullBrain(),
    listen: false,
  });
  await call("/api/projects", { method: "POST", token: ADMIN, body: { id: "shop", name: "Shop", repo_url: a.bare } });
  await call("/api/projects", { method: "POST", token: ADMIN, body: { id: "blog", name: "Blog", repo_url: b.bare } });
  P.mia = await addPerson(srv, "mia", { password: "password-mia", projects: { shop: "manager", blog: "developer" } });
  P.dan = await addPerson(srv, "dan", { password: "password-dan", projects: { shop: "developer" } });
  P.eve = await addPerson(srv, "eve", { password: "password-eve", projects: { shop: "developer" } });
  P.vic = await addPerson(srv, "vic", { password: "password-vic", projects: { shop: "viewer" } });
  P.out = await addPerson(srv, "out", { password: "password-out" });
});

after(async () => {
  await srv?.close();
  a?.cleanup();
  b?.cleanup();
});

test("viewers read and change nothing", async () => {
  assert.equal((await call("/api/projects/shop", { token: as("vic") })).status, 200);
  assert.equal((await call("/v1/p/shop/conflicts", { token: as("vic") })).status, 200);
  assert.equal((await call("/api/projects/shop", { method: "PATCH", token: as("vic"), body: { name: "x" } })).status, 403);
  assert.equal((await call("/v1/p/shop/board", { method: "POST", token: as("vic"), body: { title: "x" } })).status, 403);
  assert.equal((await call<any>("/api/projects/shop", { token: as("vic") })).json.my_access, "viewer");
});

test("a developer answers questions sent to them or to everyone, not questions for someone else", async () => {
  const session = async (dev: string) =>
    (
      await call<any>("/v1/p/shop/events", {
        method: "POST",
        token: P[dev].device,
        body: { type: "session_start", session: { dev, agent: "claude", workspace_id: `ws_${dev}`, workspace_label: dev, agent_session_id: `s-${dev}` } },
      })
    ).json.results[0].session.id as string;
  const eveSession = await session("eve");
  const ask = async (to_dev?: string) =>
    (
      await call<any>("/v1/p/shop/tickets", {
        method: "POST",
        token: P.eve.device,
        body: { session_id: eveSession, question: `for ${to_dev ?? "all"}?`, to_dev },
      })
    ).json;
  const forDan = await ask("dan");
  const forMia = await ask("mia");
  assert.equal((await call(`/v1/p/shop/tickets/${forDan.id}/reply`, { method: "POST", token: as("dan"), body: { answer: "yes" } })).status, 200);
  assert.equal((await call(`/v1/p/shop/tickets/${forMia.id}/reply`, { method: "POST", token: as("dan"), body: { answer: "yes" } })).status, 403);
  assert.equal((await call(`/v1/p/shop/tickets/${forMia.id}/reply`, { method: "POST", token: as("vic"), body: { answer: "yes" } })).status, 403);
  assert.equal((await call(`/v1/p/shop/tickets/${forMia.id}/reply`, { method: "POST", token: as("mia"), body: { answer: "ok" } })).status, 200);
});

test("a developer updates their own tasks, not others', and cannot hand them over or delete them", async () => {
  const mk = async (assignee: string) =>
    (await call<any>("/v1/p/shop/board", { method: "POST", token: as("mia"), body: { title: `for ${assignee}`, assignee } })).json;
  const mine = await mk("dan");
  const theirs = await mk("eve");
  assert.equal(
    (await call(`/v1/p/shop/board/${mine.id}`, { method: "PATCH", token: as("dan"), body: { status: "in_progress", description: "on it" } })).status,
    200,
  );
  assert.equal((await call(`/v1/p/shop/board/${mine.id}/notes`, { method: "POST", token: as("dan"), body: { body: "half done" } })).status, 200);
  assert.equal((await call(`/v1/p/shop/board/${theirs.id}`, { method: "PATCH", token: as("dan"), body: { status: "done" } })).status, 403);
  assert.equal((await call(`/v1/p/shop/board/${theirs.id}/notes`, { method: "POST", token: as("dan"), body: { body: "x" } })).status, 403);
  assert.equal((await call(`/v1/p/shop/board/${mine.id}`, { method: "PATCH", token: as("dan"), body: { assignee: "eve" } })).status, 403);
  assert.equal((await call(`/v1/p/shop/board/${mine.id}`, { method: "DELETE", token: as("dan") })).status, 403);
});

test("a developer creates tasks for themselves or for nobody, and edits documents and knowledge notes", async () => {
  assert.equal((await call("/v1/p/shop/board", { method: "POST", token: as("dan"), body: { title: "new" } })).status, 200);
  assert.equal((await call("/v1/p/shop/board", { method: "POST", token: as("dan"), body: { title: "mine", assignee: "dan" } })).status, 200);
  assert.equal((await call("/v1/p/shop/board", { method: "POST", token: as("dan"), body: { title: "yours", assignee: "eve" } })).status, 403);
  const doc = await call<any>("/v1/p/shop/kb", { method: "POST", token: as("dan"), body: { title: "Rules", body: "Refunds in 14 days", type: "business" } });
  assert.equal(doc.status, 200, JSON.stringify(doc.json));
  assert.equal((await call(`/v1/p/shop/kb/${doc.json.id}`, { method: "PATCH", token: as("dan"), body: { body: "Refunds in 30 days" } })).status, 200);
  assert.equal((await call(`/v1/p/shop/kb/${doc.json.id}`, { method: "DELETE", token: as("dan") })).status, 403);
  assert.equal((await call("/v1/p/shop/kb", { method: "POST", token: as("vic"), body: { title: "x", body: "y" } })).status, 403);
  assert.equal((await call("/v1/p/shop/features", { method: "PUT", token: as("dan"), body: { feature: "brain", mode: "off" } })).status, 403);
});

test("a manager does everything in their project and nothing as a manager elsewhere", async () => {
  assert.equal((await call("/api/projects/shop", { method: "PATCH", token: as("mia"), body: { description: "d" } })).status, 200);
  assert.equal((await call("/api/projects/shop/members", { method: "POST", token: as("mia"), body: { user: "out", access: "viewer" } })).status, 200);
  assert.equal((await call("/api/projects/shop/members/out", { method: "DELETE", token: as("mia") })).status, 200);
  assert.equal((await call("/api/projects/blog", { method: "PATCH", token: as("mia"), body: { description: "d" } })).status, 403, "developer there");
  assert.equal((await call("/api/projects/blog/members", { method: "POST", token: as("mia"), body: { user: "out" } })).status, 403);
});

test("outsiders: 404 on the dashboard, 403 with a clear message for their computer; viewers' computers are refused too", async () => {
  assert.equal((await call("/api/projects/shop", { token: as("out") })).status, 404);
  assert.equal((await call("/v1/p/shop/state", { token: as("out") })).status, 404);
  const r = await call<any>("/v1/p/shop/state", { token: P.out.device });
  assert.deepEqual([r.status, r.json.error], [403, "You are not a member of project shop. Ask a project manager for an invite link."]);
  const v = await call<any>("/v1/p/shop/events", { method: "POST", token: P.vic.device, body: { events: [] } });
  assert.equal(v.status, 403);
  assert.match(v.json.error, /viewer in project Shop/);
});

test("the overview and project list show one's own projects only", async () => {
  const ids = async (token: string) => (await call<any>("/api/overview", { token })).json.projects.map((p: any) => p.id).sort();
  assert.deepEqual(await ids(as("mia")), ["blog", "shop"]);
  assert.deepEqual(await ids(as("dan")), ["shop"]);
  assert.deepEqual(await ids(as("out")), []);
  assert.deepEqual(await ids(ADMIN), ["blog", "shop"]);
  assert.deepEqual(
    (await call<any[]>("/api/projects", { token: as("dan") })).json.map((p) => p.id),
    ["shop"],
  );
  assert.deepEqual((await call<any>("/api/me", { token: as("dan") })).json.projects, [{ id: "shop", name: "Shop", access: "developer" }]);
});

test("tasks go to members only", async () => {
  const r = await call<any>("/v1/p/shop/board", { method: "POST", token: as("mia"), body: { title: "x", assignee: "out" } });
  assert.deepEqual([r.status, r.json.error], [400, "out is not a member of this project"]);
});
