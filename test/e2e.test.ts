// End-to-end: real server on a port, two daemons (alice = Claude Code, bob = Codex), real git clones.
// Hook payloads mimic each agent's native format.

import { test, after } from "node:test";
import { request } from "node:http";
import assert from "node:assert/strict";
import { join } from "node:path";
import { startServer, type Running } from "../src/server/main.ts";
import { loadConfig } from "../src/server/config.ts";
import { Daemon } from "../src/daemon/daemon.ts";
import type { Brain, BrainJob, BrainResult } from "../src/server/brain/types.ts";
import { makeOrigin, writeFiles, tempDir, type Origin } from "./helpers.ts";

process.env.GTV_QUIET = "1";
process.env.GTV_NO_NOTIFY = "1"; // no desktop popups while testing

class FakeBrain implements Brain {
  readonly name = "fake";
  queue: Record<string, unknown[]> = {};
  async health() {
    return { ok: true };
  }
  async run<T>(job: BrainJob): Promise<BrainResult<T>> {
    const next = this.queue[job.kind]?.shift();
    if (next === undefined) throw new Error(`no scripted output for ${job.kind}`);
    return { output: next as T, ms: 1, backend: "fake" };
  }
}

const brain = new FakeBrain();
let origin: Origin;
let srv: Running;
let alice: Daemon;
let bob: Daemon;
let aDir: string;
let bDir: string;

async function waitFor<T>(fn: () => T | undefined | false | Promise<T | undefined | false>, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function hook(d: Daemon, agent: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${d.cfg.port}/hook/${agent}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}

async function tool(d: Daemon, agent: string, cwd: string, name: string, args: Record<string, unknown>): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${d.cfg.port}/api/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent, cwd, args }),
  });
  return ((await res.json()) as { text: string }).text;
}

const claude = (event: string, extra: Record<string, unknown> = {}) => ({ session_id: "claude-1", cwd: aDir, hook_event_name: event, ...extra });
const codex = (event: string, extra: Record<string, unknown> = {}) => ({ session_id: "codex-1", cwd: bDir, hook_event_name: event, model: "gpt", ...extra });

test("setup: server + two daemons", async () => {
  origin = await makeOrigin({
    "src/auth/service.ts": "export function getUser(id: number) { return { id } }\nexport function login(u: string) { return getUser(1) }\n",
    "src/ui/page.ts": "import { login } from '../auth/service';\nexport function render() { return login('x') }\n",
  });
  aDir = await origin.clone("alice");
  bDir = await origin.clone("bob");
  const cfg = loadConfig({ GTV_DATA: tempDir(), GTV_REPO_URL: origin.bare, GTV_POLL_MS: "3600000", GTV_PORT: "0", GTV_HOST: "127.0.0.1" } as NodeJS.ProcessEnv);
  cfg.askWaitMs = 3000;
  srv = await startServer(cfg, { brain });
  const server = `http://127.0.0.1:${srv.port}`;
  alice = new Daemon({ dev: "alice", server, port: 17391, remote: "origin", snapshotDebounceMs: 100 });
  bob = new Daemon({ dev: "bob", server, port: 17392, remote: "origin", snapshotDebounceMs: 100 });
  await alice.start();
  await bob.start();
  await waitFor(() => alice.serverReachable && bob.serverReachable);
});

after(async () => {
  await alice?.stop();
  await bob?.stop();
  await srv?.close();
  origin?.cleanup();
});

test("Claude SessionStart gets the Operator briefing; Codex too", async () => {
  const a = await hook(alice, "claude", claude("SessionStart", { source: "startup" }));
  assert.equal(a.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(a.hookSpecificOutput.additionalContext, /gtv_register_task/);
  const b = await hook(bob, "codex", codex("SessionStart", { source: "startup" }));
  assert.match(b.hookSpecificOutput.additionalContext, /Project Operator/);
});

test("register via MCP bridge, then Codex apply_patch on the same area produces an L0 warning injected into Claude", async () => {
  const reg = await tool(alice, "claude", aDir, "register_task", {
    title: "JWT login",
    goal: "switch sessions to JWT",
    resources: [
      { kind: "path", value: "src/auth/**" },
      { kind: "symbol", value: "getUser", op: "sig_change" },
    ],
  });
  assert.match(reg, /Registered task task_/);

  const patch =
    "*** Begin Patch\n*** Update File: src/auth/service.ts\n@@\n-export function login(u: string) { return getUser(1) }\n+export function login(u: string) { return getUser(2) }\n*** End Patch\n";
  const pre = await hook(bob, "codex", codex("PreToolUse", { tool_name: "apply_patch", tool_use_id: "t1", turn_id: "1", tool_input: { command: patch } }));
  // Bob has no task registered: nudged, and told alice's scope covers this file once the server catches up.
  assert.match(pre.hookSpecificOutput.additionalContext, /not registered a task/);
  await waitFor(() =>
    srv.hub
      .live("default")!
      .engine.store.conflicts("open")
      .find((c) => c.kind === "edit_in_scope"),
  );

  // Alice's next tool call receives the conflict message.
  const post = await waitFor(async () => {
    const r = await hook(
      alice,
      "claude",
      claude("PostToolUse", { tool_name: "Read", tool_input: { file_path: join(aDir, "src/ui/page.ts") }, tool_response: {} }),
    );
    return r?.hookSpecificOutput?.additionalContext?.includes("[gtv WARNING") ? r : undefined;
  });
  assert.match(post.hookSpecificOutput.additionalContext, /bob/);
});

test("snapshots flow from daemons; L2 high conflict makes Claude ask and Codex deny once", async () => {
  // Alice changes getUser's signature, Bob writes a new caller of getUser.
  writeFiles(aDir, {
    "src/auth/service.ts": "export function getUser(id: string) { return { id } }\nexport function login(u: string) { return getUser('1') }\n",
  });
  await hook(alice, "claude", claude("PostToolUse", { tool_name: "Write", tool_input: { file_path: join(aDir, "src/auth/service.ts") }, tool_response: {} }));
  writeFiles(bDir, { "src/sso/google.ts": "import { getUser } from '../auth/service';\nexport function sso() { return getUser(42) }\n" });
  await hook(
    bob,
    "codex",
    codex("PostToolUse", {
      tool_name: "apply_patch",
      tool_input: { command: "*** Begin Patch\n*** Add File: src/sso/google.ts\n*** End Patch" },
      tool_response: {},
    }),
  );

  const l2 = await waitFor(() => alice.stateOf("default")?.conflicts.find((c) => c.layer === "L2" && c.level === "high"), 20000);
  assert.match(l2.message, /google\.ts:2/);
  await waitFor(() => bob.stateOf("default")?.conflicts.some((c) => c.id === l2.id));

  const a = await hook(
    alice,
    "claude",
    claude("PreToolUse", { tool_name: "Edit", tool_input: { file_path: join(aDir, "src/auth/service.ts"), old_string: "a", new_string: "b" } }),
  );
  assert.equal(a.hookSpecificOutput.permissionDecision, "ask");

  const b1 = await hook(
    bob,
    "codex",
    codex("PreToolUse", { tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Update File: src/sso/google.ts\n*** End Patch" } }),
  );
  assert.equal(b1.hookSpecificOutput.permissionDecision, "deny");
  assert.match(b1.hookSpecificOutput.permissionDecisionReason, /HIGH/);
  const b2 = await hook(
    bob,
    "codex",
    codex("PreToolUse", { tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Update File: src/sso/google.ts\n*** End Patch" } }),
  );
  assert.ok(!b2 || b2.hookSpecificOutput?.permissionDecision === undefined, "second attempt is allowed");
});

test("Q&A relay: Claude asks, Operator forwards to Bob's Codex, Bob replies, answer wakes Claude", async () => {
  brain.queue.answer_question = [
    {
      route: "forward",
      answer: "Bob owns SSO.",
      confidence: "medium",
      forward_to_dev: "bob",
      forward_question: "Will SSO call getUser with a string id after alice's change?",
      sources: [],
    },
  ];
  const asked = await tool(alice, "claude", aDir, "ask", { question: "Is bob's SSO going to pass string ids to getUser?" });
  const ticketId = /Ticket (tk_\w+)/.exec(asked)?.[1];
  assert.ok(ticketId, asked);

  // Start Claude's asyncRewake waiter before the answer exists.
  const waiter = fetch(`http://127.0.0.1:${alice.cfg.port}/wait?agent=claude&session=claude-1&timeout=15000`).then(
    (r) => r.json() as Promise<{ text: string | null }>,
  );

  const q = await waitFor(async () => {
    const r = await hook(bob, "codex", codex("PostToolUse", { tool_name: "shell", tool_input: { command: "ls" }, tool_response: {} }));
    return r?.hookSpecificOutput?.additionalContext?.includes(ticketId!) ? r : undefined;
  });
  assert.match(q.hookSpecificOutput.additionalContext, /string id/);

  const replied = await tool(bob, "codex", bDir, "reply", { ticket_id: ticketId, answer: "Yes, I will convert to String(id)." });
  assert.match(replied, /Answer sent/);
  const woke = await waiter;
  assert.match(woke.text ?? "", /String\(id\)/);
});

test("the daemon refuses browser requests (Origin header) and foreign Host names", async () => {
  const url = `http://127.0.0.1:${alice.cfg.port}/statusline`;
  assert.equal((await fetch(url, { headers: { origin: "https://evil.example" } })).status, 403);
  // fetch always sends the real Host; DNS rebinding sends the attacker's name
  const rebound = await new Promise<number>((resolve, reject) =>
    request(url, { headers: { host: "evil.example" } }, (res) => resolve(res.statusCode!))
      .on("error", reject)
      .end(),
  );
  assert.equal(rebound, 403);
  assert.equal((await fetch(url)).status, 200);
});

test("statusline and status describe the team", async () => {
  const line = await (await fetch(`http://127.0.0.1:${alice.cfg.port}/statusline?cwd=${encodeURIComponent(aDir)}`)).text();
  assert.match(line, /gtv ● 1 teammate active/);
  assert.match(line, /conflict/);
  const status = await tool(alice, "claude", aDir, "status", {});
  assert.match(status, /JWT login/);
});
