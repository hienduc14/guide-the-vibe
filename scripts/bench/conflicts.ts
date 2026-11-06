// Conflict benchmark: the same task pairs done three ways, then merged.
//   none  — no coordination: A and B work blind in parallel, A merges first, then B.
//   lock  — file claims only (the usual "claim a file before editing" tools): B adapts when A claimed a
//           file B touches, otherwise works blind.
//   gtv   — the real Operator + two daemons, driven with the hook payloads of Claude Code (A) and Codex (B):
//           B adapts when gtv warned (level ≥ warning) before merge, otherwise works blind.
// "Adapts" = B's adapted edits on top of A's merged work (scenarios.ts); it is scripted, so the gtv arm
// measures what gtv's warnings make possible, given an agent that heeds them. No LLM calls (brain off).
//
// Ground truth per merge: git merge-tree (conflict? how many conflicted lines?) and tsc on the merged tree
// (type errors not present on the base = logic conflict).
//
// Run: node scripts/bench/conflicts.ts   (env BENCH_REPO = git URL; default the GitHub copy of RealWorld)
// Writes docs/reports/bench-conflicts.md and sandbox/bench/results.json.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { startServer, type Running } from "../../src/server/main.ts";
import { loadConfig } from "../../src/server/config.ts";
import { Daemon } from "../../src/daemon/daemon.ts";
import { BASE } from "../../src/codeintel/graph.ts";
import { LEVEL_RANK, type Conflict, type Level } from "../../src/shared/types.ts";
import { git } from "../../src/shared/util.ts";
import { merge, typeErrors, type MergeResult } from "./merge.ts";
import { SCENARIOS, type Edit, type Scenario } from "./scenarios.ts";

process.env.GTV_QUIET = "1";
process.env.GTV_NO_NOTIFY = "1";
Object.assign(process.env, {
  GIT_AUTHOR_NAME: "bench",
  GIT_AUTHOR_EMAIL: "bench@example.com",
  GIT_COMMITTER_NAME: "bench",
  GIT_COMMITTER_EMAIL: "bench@example.com",
});

const ROOT = resolve(import.meta.dirname, "../..");
const WORK = join(ROOT, "sandbox/bench");
const SOURCE = process.env.BENCH_REPO ?? "https://github.com/hienduc14/realworld-gtv-bench.git";
const BRANCH = process.env.BENCH_BRANCH ?? "master";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alert = (l: Level) => LEVEL_RANK[l] >= LEVEL_RANK.warning;

// ---- edits & git ---------------------------------------------------------------------------------

function applyEdits(dir: string, edits: Edit[]): void {
  for (const e of edits) {
    const file = join(dir, e.file);
    if (e.create !== undefined) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, e.create);
      continue;
    }
    const raw = readFileSync(file, "utf8");
    const crlf = raw.includes("\r\n"); // keep the file's line endings so git sees only the real change
    let text = raw.replace(/\r\n/g, "\n");
    for (const [from, to] of e.replace ?? []) {
      if (!text.includes(from)) throw new Error(`${e.file}: pattern not found: ${from.slice(0, 70)}`);
      text = text.split(from).join(to);
    }
    if (e.append) text += e.append;
    writeFileSync(file, crlf ? text.replace(/\n/g, "\r\n") : text);
  }
}

/** Commit `edits` on top of `parent` in the scratch repo; returns the commit sha. */
async function commitOn(scratch: string, parent: string, edits: Edit[], msg: string): Promise<string> {
  await git(scratch, ["checkout", "-q", "--force", "--detach", parent]);
  await git(scratch, ["clean", "-qfd"]);
  applyEdits(scratch, edits);
  await git(scratch, ["add", "-A"]);
  await git(scratch, ["commit", "-q", "--allow-empty", "-m", msg]);
  return (await git(scratch, ["rev-parse", "HEAD"])).stdout.trim();
}

// ---- gtv arm ------------------------------------------------------------------------------------

interface GtvOutcome {
  detected: boolean;
  stage: "registration" | "editing" | "snapshot" | "none";
  layers: string[];
  maxLevel: Level | "-";
  hookMs: number[];
  regB: string;
  messages: string[];
}

async function hook(port: number, agent: string, body: Record<string, unknown>) {
  const started = Date.now();
  const res = await fetch(`http://127.0.0.1:${port}/hook/${agent}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { out: text ? JSON.parse(text) : undefined, ms: Date.now() - started };
}

async function tool(port: number, agent: string, cwd: string, name: string, args: Record<string, unknown>): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/api/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent, cwd, args }),
  });
  return ((await res.json()) as { text?: string }).text ?? "ERROR";
}

const ctx = (r: { out?: any }) => String(r.out?.hookSpecificOutput?.additionalContext ?? r.out?.systemMessage ?? "");

/** Edit through an agent's hooks: PreToolUse → write → PostToolUse, in that agent's native payload format. */
async function agentEdit(d: { port: number; agent: string; dir: string; session: string }, e: Edit) {
  const file = join(d.dir, e.file);
  const create = e.create !== undefined;
  const patch = `*** Begin Patch\n*** ${create ? "Add" : "Update"} File: ${e.file}\n*** End Patch\n`;
  const input =
    d.agent === "claude"
      ? {
          tool_name: create ? "Write" : "Edit",
          tool_input: create
            ? { file_path: file, content: e.create }
            : { file_path: file, old_string: e.replace?.[0]?.[0] ?? "", new_string: e.replace?.[0]?.[1] ?? "" },
        }
      : { tool_name: "apply_patch", tool_input: { command: patch } };
  const base = { session_id: d.session, cwd: d.dir, ...(d.agent === "codex" ? { model: "gpt", turn_id: "1", tool_use_id: `t-${Date.now()}` } : {}) };
  const pre = await hook(d.port, d.agent, { ...base, hook_event_name: "PreToolUse", ...input });
  applyEdits(d.dir, [e]);
  await hook(d.port, d.agent, { ...base, hook_event_name: "PostToolUse", ...input, tool_response: {} });
  return pre;
}

async function waitFor<T>(fn: () => T | undefined | false | Promise<T | undefined | false>, ms: number): Promise<T | undefined> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return undefined;
    await sleep(100);
  }
}

async function runGtv(s: Scenario, bare: string, n: number): Promise<GtvOutcome> {
  const dir = join(WORK, "gtv", s.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cfg = loadConfig({
    GTV_DATA: join(dir, "data"),
    GTV_REPO_URL: bare,
    GTV_MAIN_BRANCH: BRANCH,
    GTV_POLL_MS: "3600000",
    GTV_PORT: "0",
    GTV_HOST: "127.0.0.1",
  } as NodeJS.ProcessEnv);
  const srv: Running = await startServer(cfg); // BRAIN_BACKEND unset → no brain, L3 off
  const server = `http://127.0.0.1:${srv.port}`;
  const A = { dev: "alice", agent: "claude", port: 17491 + n * 2, dir: join(dir, "alice"), session: `claude-${s.id}` };
  const B = { dev: "bob", agent: "codex", port: 17492 + n * 2, dir: join(dir, "bob"), session: `codex-${s.id}` };
  for (const d of [A, B]) await git(dir, ["clone", "-q", "-b", BRANCH, bare, d.dir]);
  const daemons = [A, B].map((d) => new Daemon({ dev: d.dev, server, port: d.port, remote: "origin", snapshotDebounceMs: 200 }));
  try {
    for (const dm of daemons) await dm.start();
    await waitFor(() => daemons.every((dm) => dm.serverReachable), 10_000);
    const rt = await srv.hub.runtime(cfg.defaultProject);
    const { store, graph } = rt.engine;
    await waitFor(() => graph.stats(BASE).symbols > 0, 60_000);

    const hookMs: number[] = [];
    for (const d of [A, B]) await hook(d.port, d.agent, { session_id: d.session, cwd: d.dir, hook_event_name: "SessionStart", source: "startup" });

    // A registers and does the work; its WIP snapshot reaches the Operator.
    await tool(A.port, A.agent, A.dir, "register_task", { title: s.a.title, goal: s.a.goal, resources: s.a.resources });
    for (const e of s.a.edits) hookMs.push((await agentEdit(A, e)).ms);
    await waitFor(() => store.workspaces().find((w) => w.dev === "alice" && w.snapshot_sha), 20_000);

    // B registers (before any code), then edits blind.
    const regB = await tool(B.port, B.agent, B.dir, "register_task", { title: s.b.title, goal: s.b.goal, resources: s.b.resources });
    const regAlert = regB.split("\n").some((l) => /^- \[(warning|high|critical) /.test(l));
    const editCtx: string[] = [];
    for (const e of s.b.edits) {
      const pre = await agentEdit(B, e);
      hookMs.push(pre.ms);
      editCtx.push(ctx(pre));
    }
    const editAlert = editCtx.some((c) => /gtv (WARNING|HIGH|CRITICAL)/i.test(c) && /alice/.test(c));
    await waitFor(() => store.workspaces().find((w) => w.dev === "bob" && w.snapshot_sha), 20_000);
    await sleep(1500); // let L1/L2 finish on bob's snapshot

    const pair = (store.conflicts("all") as Conflict[]).filter(
      (c) => new Set([c.dev_a, c.dev_b]).size === 2 && [c.dev_a, c.dev_b].includes("alice") && [c.dev_a, c.dev_b].includes("bob"),
    );
    const alerts = pair.filter((c) => alert(c.level));
    const stage = regAlert ? "registration" : editAlert ? "editing" : alerts.length ? "snapshot" : "none";
    const maxLevel = pair.reduce<Level | "-">((m, c) => (m === "-" || LEVEL_RANK[c.level] > LEVEL_RANK[m] ? c.level : m), "-");
    return {
      detected: stage !== "none",
      stage,
      layers: [...new Set(pair.map((c) => `${c.layer}:${c.level}`))].sort(),
      maxLevel,
      hookMs,
      regB,
      messages: pair.map((c) => `[${c.layer} ${c.level}] ${c.message}`),
    };
  } finally {
    for (const dm of daemons) await dm.stop().catch(() => {});
    await srv.close().catch(() => {});
  }
}

// ---- main -----------------------------------------------------------------------------------------

interface Row {
  s: Scenario;
  none: MergeResult;
  lock: { detected: boolean; result: MergeResult };
  gtv: GtvOutcome & { result: MergeResult };
}

async function main() {
  mkdirSync(WORK, { recursive: true });
  const bare = join(WORK, "source.git");
  if (!existsSync(bare)) await git(WORK, ["clone", "-q", "--bare", SOURCE, bare]);
  else await git(bare, ["fetch", "-q", "origin", `+${BRANCH}:${BRANCH}`]).catch(() => undefined);
  const base = (await git(bare, ["rev-parse", BRANCH])).stdout.trim();
  const scratch = join(WORK, "scratch");
  if (!existsSync(scratch)) await git(WORK, ["clone", "-q", bare, scratch]);
  await git(scratch, ["fetch", "-q", "origin"]);
  console.log(`base ${base.slice(0, 10)} (${SOURCE})`);
  const baseErrors = await typeErrors(scratch, base);
  console.log(`base type errors (ignored): ${baseErrors.size}`);

  const only = process.env.BENCH_ONLY?.split(",");
  const rows: Row[] = [];
  let n = 0;
  for (const s of SCENARIOS) {
    if (only && !only.includes(s.id)) continue;
    console.log(`\n== ${s.id} ${s.title}`);
    const a = await commitOn(scratch, base, s.a.edits, `${s.id} A`);
    const bBlind = await commitOn(scratch, base, s.b.edits, `${s.id} B`);
    const bAdapted = await commitOn(scratch, a, s.adapted, `${s.id} B adapted`);
    const blind = await merge(scratch, a, bBlind, baseErrors);
    const adapted = await merge(scratch, a, bAdapted, baseErrors);

    const filesA = new Set(s.a.edits.map((e) => e.file));
    const lockDetected = s.b.edits.some((e) => filesA.has(e.file));

    const g = await runGtv(s, bare, n++);
    const row: Row = {
      s,
      none: blind,
      lock: { detected: lockDetected, result: lockDetected ? adapted : blind },
      gtv: { ...g, result: g.detected ? adapted : blind },
    };
    rows.push(row);
    console.log(`  none: ${fmt(blind)} | lock: ${lockDetected ? "warned" : "silent"} | gtv: ${g.stage} ${g.layers.join(",")} → ${fmt(row.gtv.result)}`);
  }
  writeFileSync(join(WORK, "results.json"), JSON.stringify(rows, null, 2));
  const report = render(rows, base);
  mkdirSync(join(ROOT, "docs/reports"), { recursive: true });
  writeFileSync(join(ROOT, "docs/reports/bench-conflicts.md"), report);
  console.log("\n" + report);
}

const fmt = (m: MergeResult) =>
  m.conflict ? `CONFLICT ${m.files.length} file, ${m.conflictLines} lines` : m.newTypeErrors ? `BROKEN ${m.newTypeErrors} type errors` : "clean";
const bad = (m: MergeResult) => m.conflict || m.newTypeErrors > 0;

function render(rows: Row[], base: string): string {
  const arms = ["none", "lock", "gtv"] as const;
  const result = (r: Row, arm: (typeof arms)[number]) => (arm === "none" ? r.none : arm === "lock" ? r.lock.result : r.gtv.result);
  const warned = (r: Row, arm: (typeof arms)[number]) => (arm === "none" ? false : arm === "lock" ? r.lock.detected : r.gtv.detected);
  const real = rows.filter((r) => r.s.truth !== "none");
  const sum = (arm: (typeof arms)[number]) => {
    const res = rows.map((r) => result(r, arm));
    const tp = rows.filter((r) => r.s.truth !== "none" && warned(r, arm)).length;
    const fp = rows.filter((r) => r.s.truth === "none" && warned(r, arm)).length;
    return {
      textConflicts: res.filter((m) => m.conflict).length,
      conflictLines: res.reduce((n, m) => n + m.conflictLines, 0),
      broken: res.filter((m) => !m.conflict && m.newTypeErrors > 0).length,
      bad: res.filter(bad).length,
      recall: arm === "none" ? "-" : `${tp}/${real.length}`,
      falseAlarms: arm === "none" ? "-" : `${fp}/${rows.length - real.length}`,
    };
  };
  const totals = Object.fromEntries(arms.map((a) => [a, sum(a)])) as Record<(typeof arms)[number], ReturnType<typeof sum>>;
  const hook = rows.flatMap((r) => r.gtv.hookMs).sort((x, y) => x - y);
  const pct = (p: number) => (hook.length ? hook[Math.min(hook.length - 1, Math.floor((p / 100) * hook.length))] : 0);
  const pctRed = (a: number, b: number) => (a ? `${Math.round(((a - b) / a) * 100)}%` : "-");

  const L: string[] = [];
  L.push("# Benchmark: giảm conflict khi làm song song", "");
  L.push(
    `Repo: RealWorld Node/Express (\`${SOURCE.replace(/^https:\/\/github.com\//, "")}\`, base \`${base.slice(0, 10)}\`). ${rows.length} cặp task, mỗi cặp làm theo 3 cách rồi merge (A merge trước, B sau). Chạy: \`node scripts/bench/conflicts.ts\`, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC.`,
    "",
  );
  L.push("- **none**: không điều phối, hai người làm mù song song.");
  L.push("- **lock**: chỉ giữ chỗ file (kiểu các tool claim file): B điều chỉnh khi A đã giữ một file B sửa.");
  L.push(
    "- **gtv**: Operator thật + 2 daemon, hook đúng định dạng Claude Code (A) và Codex (B), Brain tắt (L0–L2). B điều chỉnh khi gtv cảnh báo (mức ≥ warning) trước khi merge.",
  );
  L.push(
    "",
    '"Điều chỉnh" là bản sửa của B viết lại sau khi biết thay đổi của A (soạn sẵn trong `scripts/bench/scenarios.ts`), tức là giả định agent làm theo cảnh báo. Phần đo được thật là gtv **có cảnh báo hay không, lúc nào, lớp nào**; kết quả merge suy ra từ đó.',
    "",
  );

  L.push("## Tổng hợp", "");
  L.push("| Chỉ số | none | lock | gtv | gtv so với none |", "|---|---|---|---|---|");
  L.push(
    `| Merge bị conflict (git) | ${totals.none.textConflicts} | ${totals.lock.textConflicts} | ${totals.gtv.textConflicts} | ${pctRed(totals.none.textConflicts, totals.gtv.textConflicts)} |`,
  );
  L.push(
    `| Số dòng bị đè nhau (trong vùng conflict) | ${totals.none.conflictLines} | ${totals.lock.conflictLines} | ${totals.gtv.conflictLines} | ${pctRed(totals.none.conflictLines, totals.gtv.conflictLines)} |`,
  );
  L.push(
    `| Merge sạch nhưng code hỏng (lỗi type mới) | ${totals.none.broken} | ${totals.lock.broken} | ${totals.gtv.broken} | ${pctRed(totals.none.broken, totals.gtv.broken)} |`,
  );
  L.push(
    `| **Tổng merge có vấn đề** | **${totals.none.bad}** | **${totals.lock.bad}** | **${totals.gtv.bad}** | **${pctRed(totals.none.bad, totals.gtv.bad)}** |`,
  );
  L.push(`| Phát hiện được (cặp có conflict thật) | - | ${totals.lock.recall} | ${totals.gtv.recall} | |`);
  L.push(`| Cảnh báo thừa (cặp không conflict) | - | ${totals.lock.falseAlarms} | ${totals.gtv.falseAlarms} | |`);
  L.push("", `Độ trễ hook PreToolUse của gtv: p50 ${pct(50)} ms, p95 ${pct(95)} ms, max ${hook.at(-1) ?? 0} ms (${hook.length} lần gọi).`, "");

  L.push("## Từng cặp", "");
  L.push("| # | Tình huống | Thật | none | lock | gtv: báo lúc | gtv: lớp | gtv |", "|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    L.push(
      `| ${r.s.id} | ${r.s.title} | ${r.s.truth} | ${fmt(r.none)} | ${r.lock.detected ? "báo" : "im"} → ${fmt(r.lock.result)} | ${r.gtv.stage} | ${r.gtv.layers.join(", ") || "-"} | ${fmt(r.gtv.result)} |`,
    );
  }
  L.push("", "## Cảnh báo gtv đã đưa ra", "");
  for (const r of rows) {
    L.push(`**${r.s.id}** — đăng ký của B: ${r.gtv.regB.split("\n")[0].replace(/task_\w+/, "…")}`);
    for (const m of r.gtv.messages.slice(0, 4)) L.push(`- ${m.replace(/\n/g, " ").slice(0, 220)}`);
    if (!r.gtv.messages.length) L.push("- (không có)");
    L.push("");
  }
  L.push("## Giới hạn", "");
  L.push("- Phản ứng của agent khi bị cảnh báo là kịch bản soạn sẵn; với agent thật, tỷ lệ làm theo cảnh báo cần đo riêng.");
  L.push("- Brain (L3: xung đột ý định) tắt để không tốn quota; các cặp chỉ khác nhau ở ý định không có trong bộ này.");
  L.push("- Lỗi logic chỉ được đo qua lỗi type (tsc); lỗi hành vi không đổi kiểu (vd đổi đơn vị thời gian) không đo được.");
  L.push(`- ${rows.length} cặp tự dựng trên một repo TypeScript: đủ để so sánh các cách làm, chưa đủ để khái quát.`);
  return L.join("\n") + "\n";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
