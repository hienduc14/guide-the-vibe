// Regression tests for bugs found in review (each failed before its fix).

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Db } from "../src/shared/db.ts";
import { PROJECT_SCHEMA } from "../src/server/project/schema.ts";
import { Repo } from "../src/server/project/repo.ts";
import { Engine } from "../src/server/project/engine.ts";
import { KnowledgeBase } from "../src/server/knowledge/kb.ts";
import { NullBrain } from "../src/server/brain/types.ts";
import { git, patternsOverlap } from "../src/shared/util.ts";
import { toRepoPaths } from "../src/daemon/hooks.ts";
import { mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { commitAndPush, makeOrigin, tempDir } from "./helpers.ts";

process.env.GTV_QUIET = "1";

test("a bare directory overlaps a glob below it", () => {
  assert.ok(patternsOverlap("src/payments", "src/payments/**"));
  assert.ok(patternsOverlap("src/auth/**", "src/auth/"));
  assert.ok(!patternsOverlap("src/pay", "src/payments/**"));
});

test("a superseded ADR stays superseded when main moves without touching the docs", async () => {
  const origin = await makeOrigin({
    "docs/adr/0001.md": "# Use REST\nWe use REST for the api.\n",
    "docs/adr/0002.md": "---\nsupersedes: docs/adr/0001.md\n---\n# Use gRPC\nWe use gRPC for the api.\n",
  });
  try {
    const repo = new Repo(join(origin.root, "mirror.git"), origin.bare);
    await repo.ensure();
    await repo.fetch();
    const kb = new KnowledgeBase(new Db(":memory:", PROJECT_SCHEMA));
    await kb.syncFromRepo(repo, (await repo.mainSha())!);
    assert.equal(kb.get("repo:docs/adr/0001.md")?.status, "superseded");
    await commitAndPush(await origin.clone("dev"), { "src/x.ts": "export const x = 1;\n" });
    await repo.fetch();
    await kb.syncFromRepo(repo, (await repo.mainSha())!);
    assert.equal(kb.get("repo:docs/adr/0001.md")?.status, "superseded");
  } finally {
    origin.cleanup();
  }
});

test("pulling a newer main without local edits does not close the puller's task", async () => {
  const origin = await makeOrigin({ "src/auth/login.ts": "export const login = 1;\n" });
  try {
    const repo = new Repo(join(origin.root, "mirror.git"), origin.bare);
    await repo.ensure();
    const engine = new Engine({
      db: new Db(":memory:", PROJECT_SCHEMA),
      repo,
      brain: new NullBrain(),
      cfg: { featureDefaults: {}, registrationWaitMs: 100, l3DailyBudget: 10 },
    });
    await engine.pollRepo();
    const started = (await engine.handle("alice", {
      type: "session_start",
      session: { dev: "alice", agent: "claude", workspace_id: "ws_a", workspace_label: "a" },
    } as never)) as { session: never };
    const { task } = await engine.register(started.session, { title: "refactor auth", resources: [{ kind: "path", value: "src/auth/**" }] } as never);
    await new Promise((r) => setTimeout(r, 1100)); // commit times have 1 s resolution

    // Bob's PR lands on main; Alice pulls it and her (edit-free) snapshot points at the new main.
    const bob = await origin.clone("bob");
    await commitAndPush(bob, { "src/billing.ts": "export const bill = 1;\n" }, "bob's PR");
    const head = (await git(bob, ["rev-parse", "HEAD"])).stdout.trim();
    const tree = (await git(bob, ["rev-parse", "HEAD^{tree}"])).stdout.trim();
    const snap = (await git(bob, ["-c", "user.name=gtv", "-c", "user.email=g@l", "commit-tree", tree, "-p", head, "-m", "gtv wip snapshot"])).stdout.trim();
    await git(bob, ["push", "-q", "origin", `${snap}:refs/gtv/alice/ws_a`]);
    await engine.onSnapshot("ws_a", snap);
    assert.notEqual(engine.store.task(task.id)?.status, "done");
  } finally {
    origin.cleanup();
  }
});

test("hook paths map into the repo when the agent's cwd is another spelling of it (symlink, Windows 8.3 name)", () => {
  const real = join(tempDir(), "repo");
  mkdirSync(join(real, "src"), { recursive: true });
  const alias = join(tempDir(), "alias");
  symlinkSync(real, alias, "junction");
  // git reports the real path; the agent runs in the alias. New files (not on disk yet) map too.
  assert.deepEqual(toRepoPaths(["src/new.ts", join(alias, "src", "a.ts")], alias, real), ["src/new.ts", "src/a.ts"]);
  assert.deepEqual(toRepoPaths(["../outside.ts"], alias, real), []);
});

test("gtv install codex lets Codex call gtv tools without per-call approval, and stays idempotent", async () => {
  const { installCodex } = await import("../src/daemon/install.ts");
  const dir = tempDir();
  installCodex(dir, "http://127.0.0.1:7391");
  installCodex(dir, "http://127.0.0.1:7391");
  const toml = readFileSync(join(dir, ".codex", "config.toml"), "utf8");
  assert.equal(toml.match(/\[mcp_servers\.gtv\]/g)?.length, 1);
  assert.match(toml, /\[mcp_servers\.gtv\][\s\S]*default_tools_approval_mode = "approve"/);
});

test("headless Claude (claude -p): the asyncRewake waiter exits at once instead of holding Claude for 30 min", async () => {
  const { spawn } = await import("node:child_process");
  const { createServer } = await import("node:http");
  // A daemon that never answers /wait: an attended waiter would hang on it.
  const hang = createServer(() => undefined);
  await new Promise<void>((r) => hang.listen(0, "127.0.0.1", r));
  const port = (hang.address() as import("node:net").AddressInfo).port;
  const run = (attended: string) =>
    new Promise<number>((resolve) => {
      const started = Date.now();
      const p = spawn(process.execPath, ["bin/gtv.mjs", "hook-wait", "claude", "--daemon", `http://127.0.0.1:${port}`], {
        env: { ...process.env, CLAUDE_CODE_SESSION_ATTENDED: attended },
      });
      p.stdin.end(JSON.stringify({ session_id: "s1" }));
      const t = setTimeout(() => p.kill(), 3000);
      p.on("exit", () => {
        clearTimeout(t);
        resolve(Date.now() - started);
      });
    });
  try {
    assert.ok((await run("0")) < 2500, "unattended: exits right away");
    assert.ok((await run("1")) >= 2900, "attended: keeps waiting for messages");
  } finally {
    hang.closeAllConnections();
    hang.close();
  }
});
