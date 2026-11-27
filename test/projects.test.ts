// Creating projects: anyone logged in creates one and manages it; the repo address must be one the server may clone
// (https:// or git@host:path, never local paths, other transports or hosts on its own network) and readable.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, type Running } from "../src/server/main.ts";
import { loadConfig } from "../src/server/config.ts";
import { NullBrain } from "../src/server/brain/types.ts";
import { repoHost } from "../src/server/hub/repo-check.ts";
import { api, makeOrigin, newProject, signup, tempDir, type Origin } from "./helpers.ts";

process.env.GTV_QUIET = "1";

const ADMIN = "admin-secret";
let srv: Running;
let origin: Origin;
let hoc: string;
let bob: string;
const call = <T = any>(path: string, init: Parameters<typeof api>[2] = {}) => api<T>(srv.app, path, init);

test("setup", async () => {
  origin = await makeOrigin({ "src/a.ts": "export const a = 1\n" });
  srv = await startServer(loadConfig({ GTV_DATA: tempDir(), GTV_POLL_MS: "3600000", GTV_ADMIN_TOKEN: ADMIN } as NodeJS.ProcessEnv), {
    brain: new NullBrain(),
    listen: false,
  });
  await call("/api/auth/setup", { method: "POST", body: { name: "boss", password: "boss-password", admin_token: ADMIN } });
  hoc = await signup(srv.app, "hoc");
  bob = await signup(srv.app, "bob");
});

after(async () => {
  await srv?.close();
  origin?.cleanup();
});

test("repo addresses: only https:// and git@host:path, and never this server or a private network", async () => {
  assert.equal(repoHost("https://x-access-token:abc@github.com/Org/Repo.git"), "github.com");
  assert.equal(repoHost("git@github.com:org/repo.git"), "github.com");
  for (const bad of [
    "file:///etc/passwd",
    "ext::sh -c touch% /tmp/pwned",
    "/srv/git/repo.git",
    "../repo",
    "C:\\code\\repo",
    "http://github.com/org/repo.git",
    "ssh://git@github.com/org/repo.git",
    "-uhttps://github.com/org/repo",
    "git@-oProxyCommand:x/y",
    "https://localhost/org/repo.git",
    "https://127.0.0.1/org/repo.git",
    "https://10.1.2.3/org/repo.git",
    "https://192.168.1.10/org/repo.git",
    "https://169.254.169.254/latest",
    "https://[::1]/org/repo.git",
    "git@localhost:org/repo.git",
  ]) {
    const r = await call("/api/projects/check-repo", { method: "POST", cookie: hoc, body: { repo_url: bad } });
    assert.deepEqual([r.status, r.json.ok], [200, false], bad);
    assert.match(r.json.error, /repo address/, bad);
  }
  const p = await call("/api/projects", { method: "POST", cookie: hoc, body: { id: "evil", repo_url: "file:///etc" } });
  assert.equal(p.status, 400);
  assert.equal(srv.hub.record("evil"), undefined, "nothing is created");
});

test("check-repo reads the repo and its default branch (server admins may use local paths)", async () => {
  assert.deepEqual((await call("/api/projects/check-repo", { method: "POST", token: ADMIN, body: { repo_url: origin.bare } })).json, {
    ok: true,
    default_branch: "main",
  });
  const missing = await call("/api/projects/check-repo", { method: "POST", token: ADMIN, body: { repo_url: `${origin.root}/nope.git` } });
  assert.deepEqual([missing.json.ok, /cannot read this repo/.test(missing.json.error)], [false, true]);
  assert.equal((await call("/api/projects/check-repo", { method: "POST", body: { repo_url: origin.bare } })).status, 401);
});

test("a person creates a project and is its manager; others do not see it", async () => {
  await newProject(srv, hoc, "shop", origin.bare);
  assert.deepEqual((await call("/api/me", { cookie: hoc })).json.projects, [{ id: "shop", name: "SHOP", access: "manager" }]);
  assert.equal(srv.hub.record("shop")?.created_by, "hoc");
  assert.equal((await call("/api/projects/shop", { cookie: hoc })).json.my_access, "manager");
  assert.deepEqual(
    (await call<any[]>("/api/projects/shop/members", { cookie: hoc })).json.map((m) => [m.dev, m.access, m.display_name]),
    [["hoc", "manager", "HOC"]],
  );
  assert.equal((await call("/api/projects/shop", { cookie: bob })).status, 404);
  assert.deepEqual((await call("/api/me", { cookie: bob })).json.projects, []);
  const dup = await call("/api/projects", { method: "POST", cookie: bob, body: { id: "shop", repo_url: origin.bare } });
  assert.match(dup.json.error, /taken/);
  // no id: the server makes one from the name, and a free one when it is used
  const auto = async (name: string) => (await call<any>("/api/projects", { method: "POST", cookie: hoc, body: { name, repo_url: origin.bare } })).json.id; // hoc is the server admin, so a local repo path is fine;
  assert.equal(await auto("Shop"), "shop-2");
  assert.equal(await auto("Đồ án Môn học"), "do-an-mon-hoc");
});

test("managers archive their project; an archived id stays taken except for server admins", async () => {
  await newProject(srv, bob, "blog", origin.bare);
  assert.equal((await call("/api/projects/blog", { method: "DELETE", cookie: hoc })).status, 404);
  srv.hub.members.add("blog", "hoc", "developer", "bob");
  assert.equal((await call("/api/projects/blog", { method: "DELETE", cookie: hoc })).status, 403);
  assert.equal((await call("/api/projects/blog", { method: "DELETE", cookie: bob })).status, 200);
  assert.match((await call("/api/projects", { method: "POST", cookie: hoc, body: { id: "blog", repo_url: origin.bare } })).json.error, /taken/);
  assert.equal((await call("/api/projects", { method: "POST", token: ADMIN, body: { id: "blog", repo_url: origin.bare } })).status, 200);
  assert.equal((await call("/api/projects/blog", { cookie: bob })).json.my_access, "manager", "restored with its members");
});
