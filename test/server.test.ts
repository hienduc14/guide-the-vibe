import { test, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { startServer, type Running } from "../src/server/main.ts";
import type { ProjectRuntime } from "../src/server/project/runtime.ts";
import { loadConfig } from "../src/server/config.ts";
import type { Brain, BrainJob, BrainResult } from "../src/server/brain/types.ts";
import { brainTools } from "../src/server/brain/tools.ts";
import { snapshotWorktree } from "../src/daemon/snapshot.ts";
import { makeOrigin, writeFiles, tempDir, type Origin } from "./helpers.ts";
import type { Message, Ticket } from "../src/shared/types.ts";

process.env.GTV_QUIET = "1";

/** Scripted brain: returns queued outputs per job kind. */
class FakeBrain implements Brain {
  readonly name = "fake";
  queue: Record<string, unknown[]> = {};
  jobs: BrainJob[] = [];
  async health() {
    return { ok: true };
  }
  async run<T>(job: BrainJob): Promise<BrainResult<T>> {
    this.jobs.push(job);
    const next = this.queue[job.kind]?.shift();
    if (next === undefined) throw new Error(`no scripted output for ${job.kind}`);
    return { output: next as T, ms: 1, backend: "fake" };
  }
}

const brain = new FakeBrain();
let origin: Origin;
let srv: Running;
let rt: ProjectRuntime;

async function api<T = any>(dev: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await srv.app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-gtv-dev": dev },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: string };
  if (res.status >= 400) throw new Error(`${method} ${path}: ${json.error}`);
  return json;
}

async function start(dev: string, agent: string, ws: string) {
  const r = await api(dev, "POST", "/v1/p/default/events", {
    type: "session_start",
    session: { dev, agent, workspace_id: ws, workspace_label: `${dev}-wt`, agent_session_id: `${agent}-${ws}` },
  });
  return r.results[0] as { session: { id: string }; briefing: string };
}

const inbox = (dev: string) => rt.engine.store.pendingMessages(dev) as Message[];
const drain = (dev: string) => rt.engine.store.markDelivered(inbox(dev).map((m) => m.id));

const files = {
  "src/auth/service.ts": "export function getUser(id: number) { return { id } }\nexport function login(u: string) { return getUser(1) }\n",
  "src/ui/page.ts": "import { login } from '../auth/service';\nexport function render() { return login('x') }\n",
  "docs/adr/001-session.md": "---\ntype: adr\n---\n# ADR 001: Sessions\n\nSessions must stay compatible with mobile app v1. Tokens expire after 30 minutes.\n",
};

test("setup", async () => {
  origin = await makeOrigin(files);
  const cfg = loadConfig({ GTV_DATA: tempDir(), GTV_REPO_URL: origin.bare, GTV_POLL_MS: "3600000" } as NodeJS.ProcessEnv);
  cfg.features = { "detect.l3_semantic": "on" };
  cfg.registrationWaitMs = 2000;
  cfg.askWaitMs = 2000;
  srv = await startServer(cfg, { brain, listen: false });
  rt = srv.hub.live("default")!;
  assert.ok(rt.engine.mainSha);
});

after(async () => {
  await srv?.close();
  origin?.cleanup();
});

test("session briefing and L0 same-file conflict notify both devs", async () => {
  const a = await start("alice", "claude", "ws_a");
  const b = await start("bob", "codex", "ws_b");
  assert.match(a.briefing, /gtv_register_task/);
  await api("alice", "POST", "/v1/p/default/events", { type: "edit", session_id: a.session.id, paths: ["src/auth/service.ts"], phase: "pre" });
  await api("bob", "POST", "/v1/p/default/events", { type: "edit", session_id: b.session.id, paths: ["src/auth/service.ts"], phase: "pre" });
  const conflicts = await api("alice", "GET", "/v1/p/default/conflicts");
  const c = conflicts.find((x: any) => x.kind === "same_file");
  assert.equal(c.level, "warning");
  assert.ok(inbox("alice").some((m) => m.ref_id === c.id));
  assert.ok(inbox("bob").some((m) => m.ref_id === c.id));
  drain("alice");
  drain("bob");
});

test("registration returns overlaps, knowledge and L3 advice", async () => {
  const [b] = rt.engine.store.sessions().filter((s) => s.dev === "bob");
  const others = rt.engine.store.activeTasks();
  brain.queue.judge_registration = [
    { overlaps: [], advice: "See ADR 001 before changing sessions.", sources: [{ type: "doc", ref: "repo:docs/adr/001-session.md" }] },
  ];
  const fb = await api("bob", "POST", "/v1/p/default/tasks", {
    session_id: b.id,
    title: "Switch login sessions to JWT",
    goal: "Tokens expire after 30 minutes",
    resources: [
      { kind: "path", value: "src/auth/**", op: "modify" },
      { kind: "symbol", value: "login", op: "sig_change" },
    ],
  });
  assert.equal(others.length, 0);
  assert.equal(fb.status, "adjust_suggested"); // alice is already editing src/auth/service.ts
  assert.ok(fb.overlaps.some((o: any) => o.level === "warning"));
  assert.ok(fb.knowledge.some((k: any) => k.id === "repo:docs/adr/001-session.md"));
  assert.equal(fb.l3, "off"); // no other active task yet -> L3 not needed
});

test("snapshots: L2 detects a signature change used by the other workspace; L1 detects text conflicts", async () => {
  const a = await origin.clone("alice");
  const b = await origin.clone("bob");
  writeFiles(a, { "src/auth/service.ts": "export function getUser(id: string) { return { id } }\nexport function login(u: string) { return getUser('1') }\n" });
  writeFiles(b, { "src/sso/google.ts": "import { getUser } from '../auth/service';\nexport function sso() { return getUser(42) }\n" });
  const sa = await snapshotWorktree(a, "refs/gtv/alice/ws_a");
  const sb = await snapshotWorktree(b, "refs/gtv/bob/ws_b");
  await rt.engine.onSnapshot("ws_a", sa!.sha);
  await rt.engine.onSnapshot("ws_b", sb!.sha);

  let open = rt.engine.store.conflicts("open");
  const l2 = open.find((c) => c.layer === "L2" && c.kind === "breaking_change_used");
  assert.ok(l2, "expected an L2 conflict");
  assert.equal(l2!.level, "high");
  assert.match(l2!.message, /src\/sso\/google\.ts:2/);
  assert.ok(!open.some((c) => c.layer === "L1"), "the two snapshots merge cleanly");

  // Now bob also edits the same line of service.ts differently -> text conflict.
  writeFiles(b, {
    "src/auth/service.ts": "export function getUser(id: number, opts?: object) { return { id } }\nexport function login(u: string) { return getUser(1) }\n",
  });
  const sb2 = await snapshotWorktree(b, "refs/gtv/bob/ws_b");
  await rt.engine.onSnapshot("ws_b", sb2!.sha);
  open = rt.engine.store.conflicts("open");
  assert.ok(open.some((c) => c.layer === "L1" && c.kind === "text" && c.subject === "src/auth/service.ts"));
  assert.ok(open.some((c) => c.layer === "L2" && c.kind === "same_symbol_changed"));
});

test("feature modes: L2 in shadow mode keeps conflicts out of the registry but logs them", async () => {
  await api("alice", "PUT", "/v1/p/default/features", { feature: "detect.l2_symbol", mode: "shadow" });
  const ws = rt.engine.store.workspace("ws_a")!;
  await rt.engine.onSnapshot("ws_a", ws.snapshot_sha!);
  assert.ok(!rt.engine.store.conflicts("open").some((c) => c.layer === "L2"));
  const log = rt.engine.db.all<{ payload: string }>(`SELECT payload FROM event_log WHERE type = 'shadow_conflicts'`);
  assert.ok(log.some((r) => r.payload.includes("breaking_change_used")));
  await api("alice", "PUT", "/v1/p/default/features", { feature: "detect.l2_symbol", mode: null });
});

test("tier 1: operator answers itself; Q&A goes to KB as unverified until confirmed", async () => {
  const [a] = rt.engine.store.sessions().filter((s) => s.dev === "alice");
  brain.queue.answer_question = [
    {
      route: "answer",
      answer: "Tokens expire after 30 minutes (ADR 001).",
      confidence: "high",
      sources: [{ type: "doc", ref: "repo:docs/adr/001-session.md" }],
    },
  ];
  const t = await api<Ticket & { formatted: string }>("alice", "POST", "/v1/p/default/tickets", {
    session_id: a.id,
    question: "How long do session tokens live?",
  });
  assert.equal(t.status, "answered");
  assert.match(t.formatted, /30 minutes/);
  const qa = await api("alice", "GET", `/v1/p/default/kb/qa:${t.id}`);
  assert.equal(qa.status, "unverified");
  await api("alice", "POST", `/v1/p/default/kb/qa:${t.id}/confirm`);
  assert.equal((await api("alice", "GET", `/v1/p/default/kb/qa:${t.id}`)).status, "active");
});

test("tier 2 → reply: question forwarded into bob's agent, answer pushed back to alice", async () => {
  const [a] = rt.engine.store.sessions().filter((s) => s.dev === "alice");
  drain("alice");
  drain("bob");
  brain.queue.answer_question = [
    {
      route: "forward",
      answer: "Bob owns the JWT change.",
      confidence: "medium",
      forward_to_dev: "bob",
      forward_question: "Will the JWT include the email claim?",
      sources: [],
    },
  ];
  const t = await api<Ticket>("alice", "POST", "/v1/p/default/tickets", { session_id: a.id, question: "Does the new token carry the user's email?" });
  assert.equal(t.status, "forwarded");
  const q = inbox("bob").find((m) => m.ref_id === t.id)!;
  assert.equal(q.kind, "ticket_question");
  assert.match(q.body, /email claim/);
  const [b] = rt.engine.store.sessions().filter((s) => s.dev === "bob");
  await api("bob", "POST", `/v1/p/default/tickets/${t.id}/reply`, { answer: "Yes, claim `email` is included.", session_id: b.id });
  const ans = inbox("alice").find((m) => m.ref_id === t.id)!;
  assert.equal(ans.kind, "ticket_answer");
  assert.match(ans.body, /claim `email`/);
});

test("tier 3: escalation asks bob as a human, timeouts expire", async () => {
  const [a] = rt.engine.store.sessions().filter((s) => s.dev === "alice");
  const [b] = rt.engine.store.sessions().filter((s) => s.dev === "bob");
  const t = await api<Ticket>("alice", "POST", "/v1/p/default/tickets", { session_id: a.id, question: "Can we drop mobile v1 support?", to_dev: "bob" });
  assert.equal(t.status, "forwarded");
  await api("bob", "POST", `/v1/p/default/tickets/${t.id}/reply`, { answer: "", escalate: true, session_id: b.id });
  assert.equal(rt.engine.store.ticket(t.id)!.status, "waiting_human");
  assert.ok(inbox("bob").some((m) => m.kind === "human_request" && m.ref_id === t.id));
  rt.tickets.tick(Date.now() + 5 * 3_600_000);
  assert.equal(rt.engine.store.ticket(t.id)!.status, "expired");
});

test("brain tools: read-only tools bound to the project's engine", async () => {
  const tools = brainTools(rt.engine);
  for (const n of ["team_status", "who_calls", "kb_search", "read_file", "wip_diff"])
    assert.ok(
      tools.some((t) => t.name === n),
      n,
    );
  const whoCalls = tools.find((t) => t.name === "who_calls")!;
  const res = await whoCalls.execute("t1", { symbol: "getUser", view: "ws_b" });
  assert.match((res.content[0] as { text: string }).text, /src\/sso\/google\.ts/);
  await assert.rejects(whoCalls.execute("t2", { view: "ws_b" }), /symbol/, "arguments are validated");
});

test("events: a developer cannot act on another developer's workspace or session", async () => {
  const [a] = rt.engine.store.sessions().filter((s) => s.dev === "alice");
  await assert.rejects(api("bob", "POST", "/v1/p/default/events", { type: "edit", session_id: a.id, paths: ["src/x.ts"] }));
  await assert.rejects(api("bob", "POST", "/v1/p/default/events", { type: "snapshot", workspace_id: a.workspace_id, sha: "0".repeat(40) }));
  await assert.rejects(
    api("bob", "POST", "/v1/p/default/events", {
      type: "session_start",
      session: { dev: "bob", agent: "codex", workspace_id: a.workspace_id, workspace_label: "x", agent_session_id: "steal" },
    }),
  );
  assert.equal(rt.engine.store.workspace(a.workspace_id)?.dev, "alice");
});
