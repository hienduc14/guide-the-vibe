// Accounts: one per person, created by an admin and activated by the person; read-only share links; the one-off move
// from developer tokens and dashboard users (admin/manager/viewer) to accounts.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { startServer, type Running } from "../src/server/main.ts";
import { loadConfig } from "../src/server/config.ts";
import { NullBrain } from "../src/server/brain/types.ts";
import { hashToken } from "../src/server/hub/accounts.ts";
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

const login = async (name: string, password: string) =>
  (await call<{ token: string; role: string }>("/api/login", { method: "POST", body: { name, password } })).json;
const codeOf = (url: string) => url.split("/activate/")[1];

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

test("an admin creates an account; the person activates it with the link, then logs in", async () => {
  const created = await call<any>("/api/users", { method: "POST", token: ADMIN, body: { name: "mia", projects: [{ id: "shop", access: "manager" }] } });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  assert.deepEqual([created.json.user.role, created.json.user.activated], ["member", false]);
  assert.match(created.json.activation_url, /\/activate\/[\w-]+$/);
  assert.equal(srv.hub.live("shop")!.engine.store.member("mia")?.access, "manager");
  assert.equal((await call("/api/users", { method: "POST", token: ADMIN, body: { name: "mia" } })).status, 400, "names are unique");
  assert.equal((await call("/api/users", { method: "POST", token: ADMIN, body: { name: "bad name" } })).status, 400);

  assert.match((await call<any>("/api/login", { method: "POST", body: { name: "mia", password: "whatever-1" } })).json.error, /not activated/);
  const code = codeOf(created.json.activation_url);
  assert.deepEqual((await call<any>(`/api/activate/${code}`)).json, { user: "mia", kind: "activate" });
  assert.equal((await call(`/api/activate/${code}`, { method: "POST", body: { password: "short" } })).status, 400, "at least 8 characters");
  const act = await call<any>(`/api/activate/${code}`, { method: "POST", body: { password: "mia-password" } });
  assert.match(act.json.token, /^gtvs_/);
  const me = await call<any>("/api/me", { token: act.json.token });
  assert.deepEqual([me.json.name, me.json.role, me.json.projects], ["mia", "member", [{ id: "shop", name: "shop", access: "manager" }]]);
  assert.match((await login("mia", "mia-password")).token, /^gtvs_/);

  // One use only; a new link resets the password and the old link stops working.
  assert.equal((await call(`/api/activate/${code}`, { method: "POST", body: { password: "another-pass" } })).status, 400);
  const first = await call<any>("/api/users/mia/activation", { method: "POST", token: ADMIN });
  const second = await call<any>("/api/users/mia/activation", { method: "POST", token: ADMIN });
  assert.equal((await call(`/api/activate/${codeOf(first.json.activation_url)}`)).status, 400, "replaced by the newer link");
  assert.equal((await call<any>(`/api/activate/${codeOf(second.json.activation_url)}`)).json.kind, "reset");
  srv.hub.db.run(`UPDATE activations SET expires_at = '2000-01-01T00:00:00.000Z'`);
  assert.equal(
    (await call(`/api/activate/${codeOf(second.json.activation_url)}`, { method: "POST", body: { password: "another-pass" } })).status,
    400,
    "expired",
  );

  // Changing one's own password.
  const s = await login("mia", "mia-password");
  assert.equal((await call("/api/me/password", { method: "PUT", token: s.token, body: { current: "wrong-one", password: "new-password" } })).status, 400);
  assert.equal((await call("/api/me/password", { method: "PUT", token: s.token, body: { current: "mia-password", password: "new-password" } })).status, 200);
  assert.match((await login("mia", "new-password")).token, /^gtvs_/);
});

test("system roles: only admins manage accounts, the brain and projects; an admin cannot lower or delete themself", async () => {
  const boss = await addPerson(srv, "boss", { role: "admin", password: "boss-password" });
  const pat = await addPerson(srv, "pat", { password: "pat-password" });
  for (const [method, path, body] of [
    ["GET", "/api/users", undefined],
    ["POST", "/api/users", { name: "x1" }],
    ["GET", "/api/brain/providers", undefined],
    ["POST", "/api/projects", { id: "x1", repo_url: a.bare }],
    ["DELETE", "/api/projects/shop", undefined],
  ] as const)
    assert.equal((await call(path, { method, token: pat.session, body })).status, 403, `${method} ${path}`);
  assert.equal((await call("/api/users", { token: boss.session })).status, 200);

  assert.equal((await call("/api/users/pat", { method: "PATCH", token: boss.session, body: { role: "admin" } })).status, 200);
  assert.equal((await call("/api/users", { token: pat.session })).status, 200, "now an admin");
  assert.equal((await call("/api/users/pat", { method: "PATCH", token: boss.session, body: { role: "member" } })).status, 200);
  assert.equal((await call("/api/users", { token: pat.session })).status, 401, "a lower role ends the sessions");
  assert.equal((await call("/api/users/boss", { method: "PATCH", token: boss.session, body: { role: "member" } })).status, 400);
  assert.equal((await call("/api/users/boss", { method: "DELETE", token: boss.session })).status, 400);
  assert.equal((await call("/api/users/pat", { method: "PATCH", token: boss.session, body: { role: "manager" } })).status, 400, "admin | member");
});

test("deleting an account removes its computers, sessions and memberships", async () => {
  const gone = await addPerson(srv, "gone", { password: "gone-password", projects: { shop: "developer" } });
  assert.equal((await call("/v1/p/shop/state", { token: gone.device })).status, 200);
  const users = (await call<any[]>("/api/users", { token: ADMIN })).json;
  assert.deepEqual(
    users.find((u) => u.name === "gone"),
    {
      ...users.find((u) => u.name === "gone"),
      activated: true,
      devices: 1,
      projects: [{ id: "shop", name: "shop", access: "developer" }],
    },
  );
  assert.equal((await call("/api/users/gone", { method: "DELETE", token: ADMIN })).status, 200);
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
  assert.equal((await call("/api/projects/blog", { token: code })).status, 403);
  assert.equal((await call("/v1/p/blog/state", { token: code })).status, 404);
  assert.equal((await call("/api/users", { token: code })).status, 403);
  assert.equal((await call("/api/projects/shop/share-links", { token: code })).status, 403);
  assert.equal((await call("/v1/p/shop/conflicts/x/ack", { method: "POST", token: code })).status, 403);

  await call(`/api/projects/shop/share-links/${link.json.id}`, { method: "DELETE", token: ADMIN });
  assert.equal((await call("/api/me", { token: code })).status, 401, "revoked");
});

test("members: managers add people with an account and set role, level and access; agents see the team", async () => {
  const lead = await addPerson(srv, "lead", { password: "lead-pass-1", projects: { shop: "manager" } });
  const watch = await addPerson(srv, "watch", { password: "watch-pass-1", projects: { shop: "viewer" } });
  await addPerson(srv, "bob");
  assert.equal((await call("/api/projects/shop/members/bob", { method: "PUT", token: watch.session, body: { role: "frontend" } })).status, 403);
  assert.match((await call<any>("/api/projects/shop/members/nobody", { method: "PUT", token: lead.session, body: {} })).json.error, /no account named nobody/);
  const bob = await call<any>("/api/projects/shop/members/bob", { method: "PUT", token: lead.session, body: { role: "frontend", level: "junior" } });
  assert.deepEqual([bob.json.level, bob.json.access], ["junior", "developer"]);
  assert.equal((await call("/api/projects/shop/members/bob", { method: "PUT", token: lead.session, body: { level: "guru" } })).status, 400);
  assert.equal((await call("/api/projects/shop/members/bob", { method: "PUT", token: lead.session, body: { access: "owner" } })).status, 400);
  await call("/api/projects/shop/members/lead", { method: "PUT", token: lead.session, body: { role: "tech lead", level: "lead" } });
  assert.equal(srv.hub.live("shop")!.engine.store.member("lead")?.access, "manager", "role and level leave access alone");

  const s = await call<any>("/v1/p/shop/events", {
    method: "POST",
    token: ADMIN,
    dev: "bob",
    body: { type: "session_start", session: { dev: "bob", agent: "claude", workspace_id: "ws_bob", workspace_label: "bob", agent_session_id: "s-bob" } },
  });
  assert.match(s.json.results[0].briefing, /Team: .*bob \(you\) — frontend, junior.*lead — tech lead, lead/);
  assert.equal((await call("/api/projects/shop/members/bob", { method: "DELETE", token: lead.session })).status, 200);
  assert.deepEqual(
    (await call<any[]>("/api/people", { token: lead.session })).json.map((p) => p.name).includes("bob"),
    true,
    "managers can pick from everyone with an account",
  );
});

test("charter: managers set it, agents get it in the briefing and in gtv_status state", async () => {
  const pm = await addPerson(srv, "pm", { password: "pm-pass-123", projects: { shop: "manager" } });
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

test("first start after the update: developers and dashboard users become accounts, old tokens keep working", async () => {
  const dir = tempDir();
  const cfg = loadConfig({ GTV_DATA: dir, GTV_POLL_MS: "3600000" } as NodeJS.ProcessEnv);
  let old = await startServer(cfg, { brain: new NullBrain(), listen: false });
  await old.app.request("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "shop", repo_url: a.bare }),
  });
  old.hub.live("shop")!.engine.store.saveMember("hien", { role: "backend" });
  await old.close();

  // Rewind hub.db to the shape and data of the previous version.
  const db = new DatabaseSync(join(dir, "hub.db"));
  db.exec(`DROP TABLE users; CREATE TABLE users (name TEXT PRIMARY KEY, role TEXT NOT NULL, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL, last_login TEXT);
    DELETE FROM settings WHERE key = 'accounts_migrated'; DELETE FROM devices;`);
  const t = "2026-11-01T00:00:00.000Z";
  db.prepare(`INSERT INTO users VALUES (?,?,?,?,NULL)`).run("hoc", "admin", "x", t);
  db.prepare(`INSERT INTO users VALUES (?,?,?,?,NULL)`).run("lan", "manager", "x", t);
  db.prepare(`INSERT INTO users VALUES (?,?,?,?,NULL)`).run("hoc-xem", "viewer", "x", t);
  for (const [name, token] of [
    ["hoc", "gtv_old_hoc"],
    ["hien", "gtv_old_hien"],
  ])
    db.prepare(`INSERT INTO devs (name, token_hash, created_at, last_seen) VALUES (?,?,?,?)`).run(name, hashToken(token), t, t);
  db.close();

  old = await startServer(cfg, { brain: new NullBrain(), listen: false });
  try {
    const users = Object.fromEntries(old.hub.accounts.users().map((u) => [u.name, u]));
    assert.deepEqual(
      Object.keys(users).map((n) => [n, users[n].role, users[n].activated]),
      [
        ["hien", "member", false],
        ["hoc", "admin", true],
        ["hoc-xem", "member", true],
        ["lan", "member", true],
      ],
    );
    const store = old.hub.live("shop")!.engine.store;
    assert.deepEqual(
      store.members().map((m) => [m.dev, m.access, m.role]),
      [
        ["hien", "developer", "backend"],
        ["hoc-xem", "viewer", "developer"],
        ["lan", "manager", "developer"],
      ],
    );
    assert.deepEqual(
      old.hub.accounts
        .devices()
        .map((d) => [d.user, d.name])
        .sort(),
      [
        ["hien", "máy cũ"],
        ["hoc", "máy cũ"],
      ],
    );
    // A daemon still running with an old token keeps working, as the same person.
    const res = await old.app.request("/v1/p/shop/state", { headers: { authorization: "Bearer gtv_old_hien" } });
    assert.equal(res.status, 200);
    const me = (await (await old.app.request("/v1/me", { headers: { authorization: "Bearer gtv_old_hien" } })).json()) as any;
    assert.deepEqual([me.user, me.projects[0].access], ["hien", "developer"]);
    old.hub.migrateAccounts(); // runs once
    assert.equal(old.hub.accounts.devices().length, 2);
  } finally {
    await old.close();
  }
});
