// Self-test on a real open-source repo (gothinkster/node-express-realworld-example-app).
// Two developers edit lightly in parallel; their agents are driven through the real daemons with the
// exact hook payloads Claude Code (alice) and Codex (bob) send. Real git, real Operator (docker), real brain
// (a handful of calls). Writes docs/reports/selftest-realworld.md.
//
// Prereqs: docker stack up, project "realworld" created, daemons for alice (7391) and bob (7392) running,
// clones at sandbox/realworld/{alice,bob}. Env: GTV_ADMIN_TOKEN.
// Run: node scripts/selftest/realworld.ts

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { git } from "../../src/shared/util.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const SERVER = process.env.GTV_SERVER ?? "http://127.0.0.1:7390";
const ADMIN = process.env.GTV_ADMIN_TOKEN ?? "";
const PROJECT = "realworld";
const A = { dev: "alice", agent: "claude", port: 7391, dir: join(ROOT, "sandbox/realworld/alice"), session: "claude-rw-1" };
const B = { dev: "bob", agent: "codex", port: 7392, dir: join(ROOT, "sandbox/realworld/bob"), session: "codex-rw-1" };

const t0 = Date.now();
const timeline: { t: string; who: string; what: string; result: string }[] = [];
const checks: { name: string; ok: boolean; detail: string }[] = [];
const brainNotes: string[] = [];
const sec = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
const note = (who: string, what: string, result = "") => {
  timeline.push({ t: sec(), who, what, result: result.replace(/\n/g, " ").slice(0, 260) });
  console.log(`[${sec()}] ${who}: ${what}${result ? " → " + result.slice(0, 200) : ""}`);
};
const check = (name: string, ok: boolean, detail = "") => {
  checks.push({ name, ok, detail: detail.replace(/\n/g, " ").slice(0, 300) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail.slice(0, 160) : ""}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function json<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN}`, ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${url} → ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : (undefined as T);
}

type Dev = typeof A;
const hook = async (d: Dev, body: Record<string, unknown>) => {
  const started = Date.now();
  const res = await fetch(`http://127.0.0.1:${d.port}/hook/${d.agent}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_id: d.session, cwd: d.dir, ...body }),
  });
  const text = await res.text();
  return { out: text ? JSON.parse(text) : undefined, ms: Date.now() - started };
};
const tool = async (d: Dev, name: string, args: Record<string, unknown>) => {
  const res = await fetch(`http://127.0.0.1:${d.port}/api/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent: d.agent, cwd: d.dir, args }),
  });
  return ((await res.json()) as { text?: string; error?: string }).text ?? "ERROR";
};
const ctxOf = (r: { out?: any }) => (r.out?.hookSpecificOutput?.additionalContext as string | undefined) ?? "";
const decisionOf = (r: { out?: any }) => (r.out?.hookSpecificOutput?.permissionDecision as string | undefined) ?? "allow";

/** Edit a file in a clone by exact replacement, then fire the agent's pre/post hooks around it. */
async function edit(d: Dev, rel: string, replacements: [string, string][], append?: string) {
  const file = join(d.dir, rel);
  const pre =
    d.agent === "claude"
      ? await hook(d, {
          hook_event_name: "PreToolUse",
          tool_name: "Edit",
          tool_input: { file_path: file, old_string: replacements[0]?.[0] ?? "", new_string: replacements[0]?.[1] ?? "" },
        })
      : await hook(d, {
          hook_event_name: "PreToolUse",
          tool_name: "apply_patch",
          tool_input: { command: `*** Begin Patch\n*** Update File: ${rel}\n*** End Patch\n` },
        });
  const raw = readFileSync(file, "utf8");
  const crlf = raw.includes("\r\n"); // keep the file's line endings, or git would see every line as changed
  let text = raw.replace(/\r\n/g, "\n");
  for (const [from, to] of replacements) {
    if (!text.includes(from)) throw new Error(`${rel}: pattern not found: ${from.slice(0, 60)}`);
    text = text.split(from).join(to);
  }
  if (append) text += append;
  writeFileSync(file, crlf ? text.replace(/\n/g, "\r\n") : text);
  const post =
    d.agent === "claude"
      ? await hook(d, { hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: file }, tool_response: {} })
      : await hook(d, {
          hook_event_name: "PostToolUse",
          tool_name: "apply_patch",
          tool_input: { command: `*** Begin Patch\n*** Update File: ${rel}\n*** End Patch\n` },
          tool_response: {},
        });
  return { pre, post };
}

async function conflicts(all = false) {
  return json<any[]>(`${SERVER}/v1/p/${PROJECT}/conflicts${all ? "?all=1" : ""}`);
}

async function waitFor<T>(what: string, fn: () => Promise<T | undefined | false>, timeoutMs = 90_000): Promise<{ value?: T; ms: number }> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const v = await fn();
    if (v) return { value: v as T, ms: Date.now() - started };
    await sleep(1000);
  }
  console.log(`timeout waiting for ${what}`);
  return { ms: Date.now() - started };
}

// ------------------------------------------------------------------------------------------------

async function main() {
  // Clean slate for the clones (keep their gtv wiring in .claude/.codex which are git-excluded).
  for (const d of [A, B]) {
    await git(d.dir, ["checkout", "-q", "--", "."]);
    await git(d.dir, ["clean", "-qfd", "src"]);
    await git(d.dir, ["pull", "-q", "origin", "master"]);
  }
  const brainBefore = (await json<any>(`${SERVER}/api/projects/${PROJECT}/stats?days=1`)).brain.totals.jobs;

  // 1. Sessions start: both agents get the Operator briefing.
  const sa = await hook(A, { hook_event_name: "SessionStart", source: "startup" });
  note("alice/claude", "SessionStart", ctxOf(sa).split("\n")[0]);
  const sb = await hook(B, { hook_event_name: "SessionStart", source: "startup" });
  note("bob/codex", "SessionStart", ctxOf(sb).split("\n")[0]);
  check("both sessions receive the Operator briefing", /Project Operator/.test(ctxOf(sa)) && /Project Operator/.test(ctxOf(sb)));

  // 2. Alice registers first (no other task → no L3 call).
  const regA = await tool(A, "register_task", {
    title: "Profiles take a viewer object; cap article page size at 100",
    goal: "profileMapper(user, viewer?: {id}) instead of a bare id; limit article pages to 100 items",
    resources: [
      { kind: "path", value: "src/app/routes/profile/**", op: "modify" },
      { kind: "symbol", value: "profileMapper", op: "sig_change" },
      { kind: "path", value: "src/app/routes/article/article.service.ts", op: "modify" },
      { kind: "symbol", value: "getArticles", op: "modify" },
    ],
  });
  note("alice/claude", "gtv_register_task", regA.split("\n")[0]);
  check("alice registration accepted", /Registered task/.test(regA), regA.split("\n")[0]);

  // 3. Bob registers an overlapping task → L0 overlap + one real L3 brain judgement.
  const t3 = Date.now();
  const regB = await tool(B, "register_task", {
    title: "Show comment authors' profiles; default article page size 20",
    goal: "New service getCommentAuthors(slug, id) returning author profiles; default limit 20",
    resources: [
      { kind: "path", value: "src/app/routes/article/**", op: "modify" },
      { kind: "symbol", value: "getArticles", op: "modify" },
      { kind: "symbol", value: "profileMapper", op: "read" },
    ],
  });
  note("bob/codex", `gtv_register_task (${((Date.now() - t3) / 1000).toFixed(1)}s incl. L3 brain)`, regB.replace(/\n/g, " | "));
  check("bob is told about the overlap at registration (before any code)", /needs_coordination|adjust_suggested/.test(regB), regB.split("\n")[0]);
  check("registration feedback names alice's breaking change on profileMapper", /profileMapper/.test(regB) && /alice/.test(regB));
  brainNotes.push(`L3 registration judgement: ${regB.match(/Operator advice: (.*)/)?.[1] ?? "(no advice line)"}`);

  // 4. Alice edits (Claude Edit tool): signature change + updates every existing caller + page cap.
  await edit(A, "src/app/routes/profile/profile.utils.ts", [
    ["const profileMapper = (user: any, id: number | undefined): Profile => ({", "const profileMapper = (user: any, viewer?: { id: number }): Profile => ({"],
    [
      "following: id\n    ? user?.followedBy.some((followingUser: Partial<User>) => followingUser.id === id)",
      "following: viewer\n    ? user?.followedBy.some((followingUser: Partial<User>) => followingUser.id === viewer.id)",
    ],
  ]);
  await edit(A, "src/app/routes/profile/profile.service.ts", [["profileMapper(profile, id)", "profileMapper(profile, id ? { id } : undefined)"]]);
  const aArticle = await edit(A, "src/app/routes/article/article.service.ts", [
    ["profileMapper(article.author, id)", "profileMapper(article.author, id ? { id } : undefined)"],
    ["take: Number(query.limit) || 10,", "take: Math.min(Number(query.limit) || 10, 100),"],
  ]);
  note(
    "alice/claude",
    "edited profile.utils.ts, profile.service.ts, article.service.ts",
    `pre-edit decision on article.service.ts: ${decisionOf(aArticle.pre)}; context: ${ctxOf(aArticle.pre).slice(0, 160)}`,
  );
  check(
    "alice is warned when editing inside bob's registered scope",
    /scope|bob/.test(ctxOf(aArticle.pre) + ctxOf(aArticle.post)),
    ctxOf(aArticle.pre).slice(0, 200),
  );

  // 5. Bob edits (Codex apply_patch): new caller of the OLD signature, same line as alice, plus an unrelated change.
  const bTag = await edit(B, "src/app/routes/tag/tag.service.ts", [["take: 10,", "take: 20,"]]);
  // (Pending inbox messages ride along with any hook, so only warnings about this file count.)
  check(
    "unrelated tag.service.ts edit is allowed with no warning about it",
    decisionOf(bTag.pre) === "allow" && !ctxOf(bTag.pre).includes("tag.service"),
    ctxOf(bTag.pre).slice(0, 160),
  );
  const bEdit = Date.now();
  const bArticle = await edit(
    B,
    "src/app/routes/article/article.service.ts",
    [["take: Number(query.limit) || 10,", "take: Number(query.limit) || 20,"]],
    `\nexport const getCommentAuthors = async (slug: string, id?: number) => {\n  const comments = await prisma.comment.findMany({\n    where: { article: { slug } },\n    select: { author: { select: { username: true, bio: true, image: true, followedBy: true } } },\n  });\n  return comments.map((comment: any) => profileMapper(comment.author, id));\n};\n`,
  );
  note(
    "bob/codex",
    "edited tag.service.ts (independent) and article.service.ts (new getCommentAuthors + page size 20)",
    `pre-edit: ${decisionOf(bArticle.pre)}; ${ctxOf(bArticle.pre).slice(0, 200)}`,
  );

  // 6. Wait for WIP snapshots (daemon debounce 20s) → L1 + L2 on the server.
  const l2 = await waitFor("L2 conflict", async () => (await conflicts()).find((c) => c.layer === "L2" && c.subject.includes("profileMapper")), 120_000);
  const l1 = await waitFor("L1 conflict", async () => (await conflicts()).find((c) => c.layer === "L1" && c.kind === "text"), 60_000);
  const sinceEdit = ((Date.now() - bEdit) / 1000).toFixed(1);
  note("operator", `conflicts after bob's edit (+${sinceEdit}s)`, (await conflicts()).map((c) => `${c.layer}/${c.level}/${c.kind}:${c.subject}`).join(", "));
  check("L2: alice's signature change vs bob's new caller detected", !!l2.value && l2.value.level === "high", l2.value?.message ?? "not found");
  check(
    "L2 blames only lines bob wrote (1 caller, not the 2 base callers in the same file)",
    !!l2.value && (l2.value.evidence.callers ?? []).length === 1,
    JSON.stringify(l2.value?.evidence?.callers ?? []),
  );
  check(
    "L1: both changed the page-size line → text conflict before any PR",
    !!l1.value && l1.value.subject === "src/app/routes/article/article.service.ts",
    l1.value?.message ?? "not found",
  );
  const all = await conflicts();
  check("no conflict reported for the independent tag.service.ts change", !all.some((c) => c.subject.includes("tag.service")));
  const everything = await conflicts(true);
  check(
    "no false critical-path alarm (nobody touched migrations/lockfiles/CI)",
    !everything.some((c) => c.level === "critical"),
    everything
      .filter((c) => c.level === "critical")
      .map((c) => c.subject)
      .join(", "),
  );

  // 7. Hooks now act on the conflicts: Claude asks, Codex is stopped once then allowed.
  await sleep(1500); // let SSE carry the new state to the daemons
  const aAsk = await hook(A, {
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    tool_input: { file_path: join(A.dir, "src/app/routes/profile/profile.utils.ts"), old_string: "x", new_string: "y" },
  });
  note("alice/claude", "PreToolUse on profile.utils.ts", `${decisionOf(aAsk)} (${aAsk.ms}ms)`);
  check("Claude: editing the conflicted symbol asks the human", decisionOf(aAsk) === "ask", decisionOf(aAsk));
  const bDeny = await hook(B, {
    hook_event_name: "PreToolUse",
    tool_name: "apply_patch",
    tool_input: { command: "*** Begin Patch\n*** Update File: src/app/routes/article/article.service.ts\n*** End Patch\n" },
  });
  const bAgain = await hook(B, {
    hook_event_name: "PreToolUse",
    tool_name: "apply_patch",
    tool_input: { command: "*** Begin Patch\n*** Update File: src/app/routes/article/article.service.ts\n*** End Patch\n" },
  });
  note("bob/codex", "PreToolUse on article.service.ts twice", `${decisionOf(bDeny)} then ${decisionOf(bAgain)} (${bDeny.ms}ms)`);
  check("Codex: stopped once (no ask support), allowed on retry", decisionOf(bDeny) === "deny" && decisionOf(bAgain) !== "deny");
  const aPost = await hook(A, { hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: join(A.dir, "README.md") }, tool_response: {} });
  const aNotices = ctxOf(aAsk) + ctxOf(aPost) + (aAsk.out?.hookSpecificOutput?.permissionDecisionReason ?? "");
  check("conflict notices reach alice's agent (pre/post hooks)", /\[gtv HIGH|gtv HIGH conflict/.test(aNotices), aNotices.slice(0, 200));

  // 8. Real brain Q&A (tier 1): alice asks about bob's WIP.
  const qa = await tool(A, "ask", { question: "How is bob calling profileMapper in his work in progress, and will my change to a viewer object break it?" });
  note("alice/claude", "gtv_ask (tier 1, real brain)", qa);
  check("tier 1: the brain answers from bob's WIP with sources", /getCommentAuthors|comment/i.test(qa) && /Sources:/.test(qa), qa.slice(0, 220));
  brainNotes.push(`Tier-1 answer: ${qa.replace(/\n/g, " ")}`);

  // 9. Relay: bob asks a decision question; the brain should forward it to alice.
  const relay = await tool(B, "ask", {
    question:
      "Alice caps the article page size at 100 and I wanted the default to be 20 instead of 10. Which default page size should we ship? Alice owns that decision.",
  });
  note("bob/codex", "gtv_ask (decision question, real brain)", relay);
  let ticketId = /Ticket (tk_\w+)/.exec(relay)?.[1];
  const routedByBrain = /forwarded to alice/.test(relay);
  check("brain routes a decision question to the owner (tier 2)", routedByBrain, relay.slice(0, 200));
  if (!routedByBrain) {
    const direct = await tool(B, "ask", { question: "Which default article page size should we ship, 10 or 20?", to_dev: "alice" });
    ticketId = /Ticket (tk_\w+)/.exec(direct)?.[1];
    note("bob/codex", "gtv_ask with to_dev=alice (relay without brain)", direct);
  }
  const aQ = await waitFor(
    "question in alice's agent",
    async () => {
      const r = await hook(A, { hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: join(A.dir, "README.md") }, tool_response: {} });
      return ticketId && ctxOf(r).includes(ticketId) ? ctxOf(r) : undefined;
    },
    20_000,
  );
  check("the forwarded question is injected into alice's agent mid-turn", !!aQ.value, (aQ.value ?? "").slice(0, 200));
  const reply = await tool(A, "reply", { ticket_id: ticketId, answer: "Default 20 is fine; keep my cap at 100. I'll take your default in my branch." });
  note("alice/claude", "gtv_reply", reply);
  const bAns = await waitFor(
    "answer in bob's agent",
    async () => {
      const r = await hook(B, { hook_event_name: "PostToolUse", tool_name: "shell", tool_input: { command: "ls" }, tool_response: {} });
      return ctxOf(r).includes("Default 20") ? ctxOf(r) : undefined;
    },
    20_000,
  );
  check("alice's answer is delivered back into bob's agent", !!bAns.value, (bAns.value ?? "").slice(0, 200));

  // 10. Resolution: bob drops his page-size edit (alice will apply it), uses the new signature, acks L2.
  await edit(B, "src/app/routes/article/article.service.ts", [
    ["take: Number(query.limit) || 20,", "take: Number(query.limit) || 10,"],
    ["profileMapper(comment.author, id));", "profileMapper(comment.author, id ? { id } : undefined));"],
  ]);
  await edit(A, "src/app/routes/article/article.service.ts", [
    ["take: Math.min(Number(query.limit) || 10, 100),", "take: Math.min(Number(query.limit) || 20, 100),"],
  ]);
  if (l2.value) await tool(B, "ack", { conflict_id: l2.value.id });
  const l1gone = await waitFor("L1 resolved", async () => !(await conflicts()).some((c) => c.layer === "L1" && c.kind === "text") && "resolved", 90_000);
  check("L1 resolves by itself once the overlapping edit is gone", !!l1gone.value, `${(l1gone.ms / 1000).toFixed(1)}s`);
  note("operator", "after coordination", (await conflicts()).map((c) => `${c.layer}/${c.level}/${c.status}:${c.subject}`).join(", ") || "no open conflicts");

  // 11. Alice merges to master → her task closes automatically; bob is checked against the new main.
  await git(A.dir, ["add", "-A"]);
  await git(A.dir, ["commit", "-q", "-m", "profiles take a viewer object; cap page size at 100 (default 20)"]);
  await git(A.dir, ["push", "-q", "origin", "HEAD:master"]);
  await fetch(`http://127.0.0.1:${A.port}/snapshot`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: A.dir }) });
  await json(`${SERVER}/api/projects/${PROJECT}/sync`, { method: "POST" });
  const done = await waitFor(
    "alice task done",
    async () => {
      await json(`${SERVER}/api/projects/${PROJECT}/sync`, { method: "POST" });
      const tasks = await json<any[]>(`${SERVER}/v1/p/${PROJECT}/tasks`);
      return !tasks.some((t) => t.dev === "alice") && "done";
    },
    60_000,
  );
  check("alice's task closes automatically after her work lands on master", !!done.value, `${(done.ms / 1000).toFixed(1)}s`);
  const mainConf = (await conflicts()).filter((c) => c.workspace_b === "main");
  check("bob's WIP merges cleanly with the new master", mainConf.length === 0, mainConf.map((c) => c.message).join(" | "));

  // 12. Numbers for the report.
  const stats = await json<any>(`${SERVER}/api/projects/${PROJECT}/stats?days=1`);
  const layers = await json<any[]>(`${SERVER}/api/projects/${PROJECT}/layers`);
  const brainJobs = stats.brain.totals.jobs - brainBefore;
  const health = await json<any>(`${SERVER}/health`);
  writeReport({ stats, layers, brainJobs, brain: [health.brain.backend, health.brain.model].filter(Boolean).join(" ") });
}

function writeReport(x: { stats: any; layers: any[]; brainJobs: number; brain: string }) {
  const passed = checks.filter((c) => c.ok).length;
  const lines = [
    "# Self-test: RealWorld (Node/Express) — 2 developers editing in parallel",
    "",
    `Run: ${new Date().toISOString()} · duration ${sec()} · checks **${passed}/${checks.length} passed** · real brain jobs: **${x.brainJobs}** (${x.stats.brain.totals.p50_ms ?? "?"} ms p50)`,
    "",
    "Repo: `gothinkster/node-express-realworld-example-app` (TypeScript, 67 files) mirrored as a local bare repo.",
    "Agents are simulated by sending the exact hook payloads of Claude Code (alice) and Codex (bob) to the real daemons;",
    "files are really edited in two clones, WIP snapshots really pushed, the Operator and the brain (`" + x.brain + "`, ChatGPT plan) are real.",
    "",
    "## Scenario",
    "- **alice** (Claude Code): `profileMapper(user, id)` → `profileMapper(user, viewer?: { id })` (breaking), updates the 5 existing callers, caps article page size at 100.",
    "- **bob** (Codex): new `getCommentAuthors()` calling `profileMapper(author, id)` with the old signature; changes the same page-size line to 20; unrelated edit in `tag.service.ts`.",
    "- They coordinate through the Operator, bob adapts, alice merges to master.",
    "",
    "## Checks",
    "| | Check | Detail |",
    "|---|---|---|",
    ...checks.map((c) => `| ${c.ok ? "✅" : "❌"} | ${c.name} | ${c.detail.replace(/\|/g, "/")} |`),
    "",
    "## Timeline",
    "| t | who | action | result |",
    "|---|---|---|---|",
    ...timeline.map((e) => `| ${e.t} | ${e.who} | ${e.what.replace(/\|/g, "/")} | ${e.result.replace(/\|/g, "/")} |`),
    "",
    "## Brain",
    ...brainNotes.map((n) => `- ${n.replace(/\|/g, "/")}`),
    "",
    "## Layers after the run",
    "| feature | mode | metrics |",
    "|---|---|---|",
    ...x.layers.map(
      (l) =>
        `| ${l.key} | ${l.mode} | ${Object.entries(l.metrics)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")} |`,
    ),
    "",
  ];
  mkdirSync(join(ROOT, "docs/reports"), { recursive: true });
  writeFileSync(join(ROOT, "docs/reports/selftest-realworld.md"), lines.join("\n"));
  writeFileSync(join(ROOT, "sandbox/realworld/selftest.json"), JSON.stringify({ checks, timeline, brainNotes, stats: x.stats }, null, 2));
  console.log(`\n${passed}/${checks.length} checks passed — report: docs/reports/selftest-realworld.md`);
}

await main();
