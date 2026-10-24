import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { indexFile } from "../src/codeintel/extract.ts";
import { diffSymbols } from "../src/codeintel/diff.ts";
import { CodeGraph, importPointsTo } from "../src/codeintel/graph.ts";
import { syncBase, syncOverlay, workspaceChanges } from "../src/codeintel/indexer.ts";
import { PROJECT_SCHEMA } from "../src/server/project/schema.ts";
import { Db } from "../src/shared/db.ts";
import { Repo, parseMergeTree } from "../src/server/project/repo.ts";
import { snapshotWorktree } from "../src/daemon/snapshot.ts";
import { makeOrigin, writeFiles } from "./helpers.ts";
import { patternsOverlap } from "../src/shared/util.ts";

const names = async (path: string, src: string) => (await indexFile(path, src))!.symbols.map((s) => `${s.kind}:${s.qualname}`);

test("extracts symbols in TS, Python, Go and Java", async () => {
  assert.deepEqual(await names("a.ts", "export class A { login(u: string): void {} }\nexport const f = (x: number) => x;"), ["class:A", "method:A.login", "function:f"]);
  assert.deepEqual(await names("a.py", "class A:\n  def login(self):\n    pass\ndef f():\n  pass\n"), ["class:A", "method:A.login", "function:f"]);
  assert.deepEqual(await names("a.go", "package a\ntype S struct{}\nfunc (s *S) Login() {}\nfunc F() {}\n"), ["struct:S", "method:S.Login", "function:F"]);
  assert.deepEqual(await names("A.java", "public class A { public void login() {} }"), ["class:A", "method:A.login"]);
  assert.equal(await indexFile("README.md", "# hi"), undefined);
});

test("diffSymbols detects signature change, rename, delete and body change", async () => {
  const before = (await indexFile("u.ts", "export function getUser(id: number) { return db.find(id) }\nexport function a() { return 1 }\nexport function b() { return 2 }\nexport function c(x: number) { return x }"))!.symbols;
  const after = (await indexFile("u.ts", "export function getUser(id: string) { return db.find(id) }\nexport function aRenamed() { return 1 }\nexport function c(x: number) { return x + 1 }"))!.symbols;
  const byName = Object.fromEntries(diffSymbols(before, after).map((c) => [c.name, c.change]));
  assert.equal(byName.getUser, "sig_changed");
  assert.equal(byName.a, "renamed");
  assert.equal(byName.b, "deleted");
  assert.equal(byName.c, "body_changed");
});

test("importPointsTo resolves relative TS, Python and Java imports", () => {
  assert.ok(importPointsTo("src/sso/google.ts", "../auth/service", "src/auth/service.ts"));
  assert.ok(importPointsTo("src/app/article/article.service.ts", "../profile/profile.utils", "src/app/profile/profile.utils.ts"), "dotted module names");
  assert.ok(importPointsTo("src/a.ts", "./lib", "src/lib/index.ts"), "index files");
  assert.ok(importPointsTo("app/sso.py", "auth.service", "auth/service.py"));
  assert.ok(importPointsTo("app/sso.py", ".util", "app/util.py"));
  assert.ok(importPointsTo("src/B.java", "com.acme.auth.AuthService", "src/main/java/com/acme/auth/AuthService.java"));
  assert.ok(!importPointsTo("src/sso/google.ts", "../billing/service", "src/auth/service.ts"));
});

test("patternsOverlap: real overlaps yes, leading ** globs no false positives", () => {
  assert.ok(patternsOverlap("src/auth/**", "src/auth/login.ts"));
  assert.ok(patternsOverlap("src/**", "src/auth/**"));
  assert.ok(patternsOverlap("**/migrations/**", "db/migrations/001.sql"));
  assert.ok(patternsOverlap("**/migrations/**", "src/prisma/migrations/**"));
  assert.ok(!patternsOverlap("**/migrations/**", "src/app/routes/article/**"), "regression: RealWorld self-test false critical");
  assert.ok(!patternsOverlap("src/auth/**", "src/billing/**"));
});

test("parseMergeTree reads conflicted files and messages", () => {
  const out = "tree123\0src/a.ts\0\x001\0src/a.ts\0CONFLICT (contents)\0Merge conflict in src/a.ts\n\0";
  const r = parseMergeTree(out, false);
  assert.deepEqual(r.conflictedFiles, ["src/a.ts"]);
  assert.equal(r.conflicts[0].type, "CONFLICT (contents)");
});

test("graph base + overlay views, callers across workspaces, and workspace changes", async () => {
  const origin = await makeOrigin({
    "src/auth/service.ts": "export function getUser(id: number) { return id }\nexport function login(u: string) { return getUser(1) }\n",
    "src/ui/page.ts": "import { login } from '../auth/service';\nexport function render() { return login('x') }\n",
  });
  try {
    const db = new Db(":memory:", PROJECT_SCHEMA);
    const graph = new CodeGraph(db);
    const repo = new Repo(join(origin.root, "mirror.git"), origin.bare);
    await repo.ensure();
    await repo.fetch();
    const main = (await repo.mainSha())!;
    assert.equal(await syncBase(graph, repo, main), 2);

    // Dev A changes getUser's signature, dev B adds a new caller of getUser.
    const a = await origin.clone("a");
    writeFiles(a, { "src/auth/service.ts": "export function getUser(id: string) { return id }\nexport function login(u: string) { return getUser('1') }\n" });
    const snapA = await snapshotWorktree(a, "refs/gtv/a/ws1");
    const b = await origin.clone("b");
    writeFiles(b, { "src/sso/google.ts": "import { getUser } from '../auth/service';\nexport function sso() { return getUser(42) }\n" });
    const snapB = await snapshotWorktree(b, "refs/gtv/b/ws2");
    await repo.fetch();
    assert.equal((await repo.snapshotRefs()).size, 2);

    await syncOverlay(graph, repo, "ws1", snapA!.sha, main);
    await syncOverlay(graph, repo, "ws2", snapB!.sha, main);

    const [target] = graph.findSymbols("getUser", "ws1");
    assert.match(target.sig, /id: string/);
    const callersInB = graph.whoCalls(graph.findSymbols("getUser", "base")[0], "ws2", { onlyLayer: "ws2" });
    assert.equal(callersInB.length, 1);
    assert.equal(callersInB[0].confidence, "import");
    assert.equal(callersInB[0].path, "src/sso/google.ts");

    const changesA = await workspaceChanges(repo, snapA!.sha, main);
    assert.deepEqual(changesA!.changes.filter((c) => c.change === "sig_changed").map((c) => c.name), ["getUser"]);

    const merge = await repo.mergeTree(snapA!.sha, snapB!.sha);
    assert.equal(merge.clean, true);
  } finally {
    origin.cleanup();
  }
});
