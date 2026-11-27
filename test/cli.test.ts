// The CLI's pure parts: server addresses, matching a repo to a project, the managed exclude block, and taking
// gtv out of agent config files without touching what belongs to the person.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXCLUDED, matchProject, notMineMessage, serverCandidates, withExcludeBlock, withoutExcludeBlock, type MyProject } from "../src/daemon/setup.ts";
import { installClaude, installCodex, parseVersion, setupState, stripCodexToml, stripHooks, uninstallClaude, uninstallCodex } from "../src/daemon/install.ts";
import { tempDir } from "./helpers.ts";

test("server addresses: with or without https://, trailing slash, http only for this machine", () => {
  assert.deepEqual(serverCandidates("gtv.tenantry.site/"), ["https://gtv.tenantry.site"]);
  assert.deepEqual(serverCandidates(" https://gtv.example.com/ops// "), ["https://gtv.example.com/ops"]);
  assert.deepEqual(serverCandidates("http://10.0.0.5:7390"), ["http://10.0.0.5:7390"]);
  assert.deepEqual(serverCandidates("localhost:7395"), ["https://localhost:7395", "http://localhost:7395"]);
  assert.deepEqual(serverCandidates("127.0.0.1:7390/"), ["https://127.0.0.1:7390", "http://127.0.0.1:7390"]);
  assert.deepEqual(serverCandidates("  "), []);
});

test("a repo matches a project by its gtv link first, else by its remote", () => {
  const projects: MyProject[] = [
    { id: "shop", name: "Shop", access: "developer", repos: ["org/shop", "fork/shop"] },
    { id: "blog", name: "Blog", access: "viewer", repos: ["org/blog"] },
  ];
  assert.equal(matchProject(projects, undefined, "git@github.com:Org/Shop.git")?.id, "shop");
  assert.equal(matchProject(projects, undefined, "https://x-access-token:t@github.com/org/blog")?.id, "blog");
  assert.equal(matchProject(projects, "blog", "git@github.com:org/shop.git")?.id, "blog", "the link wins");
  assert.equal(matchProject(projects, "other", "git@github.com:org/shop.git"), undefined, "linked to a project that is not mine");
  assert.equal(matchProject(projects, undefined, "https://github.com/someone/else.git"), undefined);
  assert.equal(matchProject(projects, undefined, undefined), undefined);
});

test("exclude block: added once, replaced on re-run, removed cleanly", () => {
  const mine = "# git ls-files --others --exclude-from=.git/info/exclude\n*.log\n";
  const once = withExcludeBlock(mine, EXCLUDED);
  assert.ok(once.startsWith(mine));
  assert.match(once, /# gtv \(managed\)\n\.mcp\.json\n[\s\S]*\.codex\/\n# end gtv\n$/);
  assert.equal(withExcludeBlock(once, EXCLUDED), once, "running gtv on again adds nothing");
  assert.equal(withExcludeBlock(once, [".mcp.json"]).match(/# gtv \(managed\)/g)?.length, 1);
  assert.equal(withoutExcludeBlock(once), mine);
  assert.equal(withoutExcludeBlock(withExcludeBlock("", EXCLUDED)), "");
  assert.equal(withoutExcludeBlock(mine), mine);
});

test("gtv off takes out only gtv's entries and deletes files only when nothing else is left", () => {
  const dir = tempDir();
  // The person's own settings, hooks, MCP servers and Codex config, before gtv.
  mkdirSync(join(dir, ".claude"), { recursive: true });
  mkdirSync(join(dir, ".codex"), { recursive: true });
  const userHook = { matcher: "Bash", hooks: [{ type: "command", command: "./lint.sh" }] };
  writeFileSync(join(dir, ".claude", "settings.local.json"), JSON.stringify({ permissions: { allow: ["Bash(ls)"] }, hooks: { PreToolUse: [userHook] } }));
  writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { db: { command: "db-mcp" } } }));
  writeFileSync(join(dir, ".codex", "config.toml"), 'model = "o4"\n\n[mcp_servers.db]\ncommand = "db-mcp"\n');
  const daemon = "http://127.0.0.1:7391";
  installClaude(dir, daemon);
  installCodex(dir, daemon);
  assert.equal(setupState(dir, "claude", daemon), "ok");
  assert.equal(setupState(dir, "codex", daemon), "ok");
  assert.equal(setupState(dir, "claude", "http://127.0.0.1:7999"), "stale", "set up for another daemon");

  const removed = [...uninstallClaude(dir), ...uninstallCodex(dir)];
  assert.ok(removed.length >= 6, removed.join("\n"));
  const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf8"));
  assert.deepEqual(settings, { permissions: { allow: ["Bash(ls)"] }, hooks: { PreToolUse: [userHook] } }, "statusLine and gtv hooks gone, the rest kept");
  assert.deepEqual(JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8")), { mcpServers: { db: { command: "db-mcp" } } });
  assert.equal(readFileSync(join(dir, ".codex", "config.toml"), "utf8"), 'model = "o4"\n\n[mcp_servers.db]\ncommand = "db-mcp"\n');
  assert.ok(!existsSync(join(dir, ".codex", "hooks.json")), "a file with only gtv in it is deleted");
  assert.ok(!existsSync(join(dir, ".claude", "skills")), "empty folders go too");
  assert.equal(setupState(dir, "claude", daemon), "missing");
  assert.deepEqual(uninstallClaude(dir), [], "running it again finds nothing");

  // A repo where only gtv wrote anything ends up with no trace.
  const clean = tempDir();
  installClaude(clean, daemon);
  installCodex(clean, daemon);
  uninstallClaude(clean);
  uninstallCodex(clean);
  assert.ok(!existsSync(join(clean, ".claude")) && !existsSync(join(clean, ".codex")) && !existsSync(join(clean, ".mcp.json")));
});

test("stripping helpers keep other hooks and tables", () => {
  const gtv = { hooks: [{ type: "http", url: "http://127.0.0.1:7391/hook/claude" }] };
  const other = { hooks: [{ type: "command", command: "echo hi" }] };
  assert.deepEqual(stripHooks({ Stop: [gtv, other], SessionStart: [gtv] }), { Stop: [other] });
  assert.equal(stripHooks({ Stop: [gtv] }), undefined);
  assert.equal(stripCodexToml('a = 1\n[mcp_servers.gtv]\ncommand = "node"\n[x]\ny = 2\n'), "a = 1\n[x]\ny = 2\n");
});

test("gtv on outside my projects: ask for an invite, or create the project; never a project's name", () => {
  assert.equal(
    notMineMessage("https://gtv.example.com", "git@github.com:Org/Shop.git", true),
    "This repo belongs to a project you are not in. Ask a manager for an invite link.",
  );
  assert.match(
    notMineMessage("https://gtv.example.com", "git@github.com:Org/Shop.git", false),
    /^No project uses this repo yet\. Create one: https:\/\/gtv\.example\.com\/new\?repo=org\/shop\n/,
  );
  assert.match(notMineMessage("https://gtv.example.com", undefined, false), /no git remote/);
});

test("agent versions are read from --version output", () => {
  assert.equal(parseVersion("2.4.1 (Claude Code)\n"), "2.4.1");
  assert.equal(parseVersion("codex-cli 0.99.0-alpha.3"), "0.99.0-alpha.3");
  assert.equal(parseVersion("codex 0.99"), "0.99");
  assert.equal(parseVersion("command not found"), null);
});
