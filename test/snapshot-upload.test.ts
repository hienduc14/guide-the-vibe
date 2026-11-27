// Snapshots sent as a git bundle over HTTP (no push rights to the team's remote), and sessions going idle on Stop.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, type Running } from "../src/server/main.ts";
import type { ProjectRuntime } from "../src/server/project/runtime.ts";
import { loadConfig } from "../src/server/config.ts";
import { NullBrain } from "../src/server/brain/types.ts";
import { bundleSnapshot, snapshotWorktree } from "../src/daemon/snapshot.ts";
import { git } from "../src/shared/util.ts";
import { makeOrigin, writeFiles, tempDir, type Origin } from "./helpers.ts";

process.env.GTV_QUIET = "1";

let origin: Origin;
let srv: Running;
let rt: ProjectRuntime;

async function call(dev: string, method: string, path: string, body?: unknown, raw?: Uint8Array) {
  const res = await srv.app.request(path, {
    method,
    headers: { "content-type": raw ? "application/octet-stream" : "application/json", "x-gtv-dev": dev },
    body: (raw ?? (body === undefined ? undefined : JSON.stringify(body))) as BodyInit | undefined,
  });
  return { status: res.status, json: (await res.json()) as any };
}

test("setup", async () => {
  origin = await makeOrigin({ "src/cart.ts": "export const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);\n" });
  const cfg = loadConfig({ GTV_DATA: tempDir(), GTV_REPO_URL: origin.bare, GTV_POLL_MS: "3600000" } as NodeJS.ProcessEnv);
  srv = await startServer(cfg, { brain: new NullBrain(), listen: false });
  rt = srv.hub.live("default")!;
});

after(async () => {
  await srv?.close();
  origin?.cleanup();
});

test("a snapshot bundle lands without any push, and the files it changes count as edited", async () => {
  const start = await call("carol", "POST", "/v1/p/default/events", {
    type: "session_start",
    session: { dev: "carol", agent: "codex", workspace_id: "ws_c", workspace_label: "carol-wt", agent_session_id: "codex-ws_c" },
  });
  const session = start.json.results[0].session.id as string;

  // Someone pushed to main after the server last fetched; carol pulled it, so her snapshot builds on a commit the
  // server's mirror does not have yet: the server must fetch and then take the bundle.
  const other = await origin.clone("other");
  writeFiles(other, { "README.md": "# shop\n" });
  await git(other, ["add", "-A"]);
  await git(other, ["-c", "user.name=o", "-c", "user.email=o@x", "commit", "-q", "-m", "readme"]);
  await git(other, ["push", "-q", "origin", "main"]);

  const carol = await origin.clone("carol");
  writeFiles(carol, {
    "src/cart.ts": "export const total = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0));\n",
    "src/ship.ts": "export const fee = 499;\n",
  });
  const snap = await snapshotWorktree(carol, "refs/gtv/carol/ws_c", { push: false });
  assert.ok(snap?.changed);
  const bundle = await bundleSnapshot(carol, snap!.sha);

  const res = await call("carol", "POST", `/v1/p/default/snapshot?workspace_id=ws_c&sha=${snap!.sha}&branch=main`, undefined, bundle);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(rt.engine.store.workspace("ws_c")!.snapshot_sha, snap!.sha);
  // nothing was pushed to the team's remote
  assert.equal((await git(origin.bare, ["for-each-ref", "refs/gtv/"])).stdout.trim(), "");

  const touched = rt.engine.store
    .footprints()
    .filter((f) => f.workspace_id === "ws_c")
    .map((f) => f.path)
    .sort();
  assert.deepEqual(touched, ["src/cart.ts", "src/ship.ts"], "edits seen without any edit hook");
  assert.ok(rt.engine.store.footprints().every((f) => f.workspace_id !== "ws_c" || f.session_id === session));

  // Another developer cannot write into carol's workspace.
  const bad = await call("dave", "POST", `/v1/p/default/snapshot?workspace_id=ws_c&sha=${snap!.sha}`, undefined, bundle);
  assert.equal(bad.status, 400);
});

test("Stop makes a session idle until it does something again", async () => {
  const s = rt.engine.store.sessions().find((x) => x.workspace_id === "ws_c")!;
  await call("carol", "POST", "/v1/p/default/events", { type: "stop", session_id: s.id });
  assert.equal(rt.engine.store.session(s.id)!.status, "idle");
  rt.engine.store.expireSessions(); // a recent heartbeat must not bring it back to active
  assert.equal(rt.engine.store.session(s.id)!.status, "idle");
  await call("carol", "POST", "/v1/p/default/events", { type: "prompt", session_id: s.id, prompt: "continue" });
  assert.equal(rt.engine.store.session(s.id)!.status, "active");
});
