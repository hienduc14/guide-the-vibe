// Measure a real two-person benchmark run (docs/bench-real.md): for every scenario, merge dev A's branch
// then dev B's branch and judge the result (git conflict, conflicted lines, new type errors), for the
// round without gtv ("off") and with it ("on"). Optionally counts the warnings the Operator gave.
//
// Branches: bench/<round>/<scenario>/<a|b>, e.g. bench/on/S1/a. Base: master of the bench repo.
// Run: node scripts/bench/measure.ts
//   BENCH_REPO   git URL (default https://github.com/hienduc14/realworld-gtv-bench.git)
//   GTV_SERVER, GTV_ADMIN_TOKEN, GTV_PROJECT   optional: also read the Operator's conflicts
// Writes docs/reports/bench-real.md.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { git } from "../../src/shared/util.ts";
import { merge, typeErrors, type MergeResult } from "./merge.ts";
import { SCENARIOS } from "./scenarios.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const WORK = join(ROOT, "sandbox/bench-real");
const SOURCE = process.env.BENCH_REPO ?? "https://github.com/hienduc14/realworld-gtv-bench.git";
const BRANCH = process.env.BENCH_BRANCH ?? "master";
const ROUNDS = ["off", "on"] as const;

interface Cell {
  merged: MergeResult;
  linesA: number;
  linesB: number;
  bRebased: boolean;
}

interface OperatorConflict {
  layer: string;
  level: string;
  message: string;
  created_at: string;
}

const changed = async (dir: string, from: string, to: string) => {
  const r = await git(dir, ["diff", "--numstat", from, to]);
  return r.stdout
    .split("\n")
    .filter(Boolean)
    .reduce((n, l) => n + (Number(l.split("\t")[0]) || 0) + (Number(l.split("\t")[1]) || 0), 0);
};

async function operatorConflicts(): Promise<OperatorConflict[] | undefined> {
  const { GTV_SERVER: server, GTV_ADMIN_TOKEN: token, GTV_PROJECT: project } = process.env;
  if (!server || !token || !project) return undefined;
  const res = await fetch(`${server.replace(/\/$/, "")}/v1/p/${project}/conflicts?all=1`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`conflicts → ${res.status}`);
  return (await res.json()) as OperatorConflict[];
}

async function main() {
  mkdirSync(WORK, { recursive: true });
  const repo = join(WORK, "repo");
  if (!existsSync(repo)) await git(WORK, ["clone", "-q", SOURCE, repo]);
  else await git(repo, ["remote", "set-url", "origin", SOURCE]); // BENCH_REPO may differ from the last run
  await git(repo, [
    "fetch",
    "-q",
    "--prune",
    "origin",
    `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`,
    "+refs/heads/bench/*:refs/remotes/origin/bench/*",
  ]);
  const base = (await git(repo, ["rev-parse", `origin/${BRANCH}`])).stdout.trim();
  const baseErrors = await typeErrors(repo, base);
  const refs = new Set(
    (await git(repo, ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/bench"])).stdout
      .split("\n")
      .filter(Boolean)
      .map((r) => r.replace(/^origin\//, "")),
  );
  const ops = await operatorConflicts();

  const cells = new Map<string, Cell>();
  for (const round of ROUNDS)
    for (const s of SCENARIOS) {
      const a = `bench/${round}/${s.id}/a`;
      const b = `bench/${round}/${s.id}/b`;
      if (!refs.has(a) || !refs.has(b)) continue;
      const [sa, sb] = [`origin/${a}`, `origin/${b}`];
      const merged = await merge(repo, sa, sb, baseErrors);
      const bRebased = (await git(repo, ["merge-base", "--is-ancestor", sa, sb], { allowFail: true })).code === 0;
      cells.set(`${round}/${s.id}`, { merged, linesA: await changed(repo, base, sa), linesB: await changed(repo, bRebased ? sa : base, sb), bRebased });
      console.log(`${round} ${s.id}: ${fmt(merged)}${bRebased ? " (B rebased on A)" : ""}`);
    }
  if (!cells.size) {
    console.log("No bench/<round>/<scenario>/<a|b> branch pairs found on the bench repo yet.");
    return;
  }

  const L: string[] = [];
  L.push("# Benchmark thật: 2 người, agent thật", "");
  L.push(
    `Repo \`${SOURCE.replace(/^https:\/\/github.com\//, "").replace(/\.git$/, "")}\`, base \`${base.slice(0, 10)}\`. Đo lúc ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC bằng \`node scripts/bench/measure.ts\`. Mỗi cặp: merge nhánh của A trước, rồi nhánh của B.`,
    "",
  );
  L.push("## Tổng hợp", "");
  L.push("| Chỉ số | off (không gtv) | on (có gtv) |", "|---|---|---|");
  const tot = (round: string) => {
    const cs = SCENARIOS.map((s) => cells.get(`${round}/${s.id}`)).filter((c): c is Cell => !!c);
    return {
      n: cs.length,
      conflicts: cs.filter((c) => c.merged.conflict).length,
      lines: cs.reduce((n, c) => n + c.merged.conflictLines, 0),
      broken: cs.filter((c) => !c.merged.conflict && c.merged.newTypeErrors > 0).length,
      rebased: cs.filter((c) => c.bRebased).length,
    };
  };
  const [off, on] = [tot("off"), tot("on")];
  L.push(`| Số cặp đã chạy | ${off.n} | ${on.n} |`);
  L.push(`| Merge bị conflict (git) | ${off.conflicts} | ${on.conflicts} |`);
  L.push(`| Số dòng bị đè nhau | ${off.lines} | ${on.lines} |`);
  L.push(`| Merge sạch nhưng code hỏng (lỗi type mới) | ${off.broken} | ${on.broken} |`);
  L.push(`| **Tổng merge có vấn đề** | **${off.conflicts + off.broken}** | **${on.conflicts + on.broken}** |`);
  L.push(`| B làm tiếp trên code của A (rebase/chờ) | ${off.rebased} | ${on.rebased} |`);
  L.push("");
  L.push("## Từng cặp", "");
  L.push("| # | Tình huống | Loại | off | on | Cảnh báo gtv (on) |", "|---|---|---|---|---|---|");
  for (const s of SCENARIOS) {
    const c = (r: string) => cells.get(`${r}/${s.id}`);
    if (!c("off") && !c("on")) continue;
    const warn = ops ? summarize(ops.filter((o) => o.message.includes(`${s.id}:`))) : "(không đọc server)";
    L.push(`| ${s.id} | ${s.title} | ${s.truth} | ${c("off") ? fmt(c("off")!.merged) : "-"} | ${c("on") ? fmt(c("on")!.merged) : "-"} | ${warn} |`);
  }
  L.push("", "## Lỗi type mới sau merge", "");
  for (const [k, c] of cells) for (const e of c.merged.typeErrors) L.push(`- ${k}: ${e}`);
  if (![...cells.values()].some((c) => c.merged.typeErrors.length)) L.push("- (không có)");
  L.push(
    "",
    "Các cột quan sát của người chạy (gtv báo lúc nào, agent có làm theo không, số lần phải nhắn nhau, thời gian) ghi trong bảng ở `docs/bench-real.md`.",
  );
  writeFileSync(join(ROOT, "docs/reports/bench-real.md"), L.join("\n") + "\n");
  console.log("\nWrote docs/reports/bench-real.md");
}

const fmt = (m: MergeResult) =>
  m.conflict ? `CONFLICT ${m.files.length} file, ${m.conflictLines} dòng` : m.newTypeErrors ? `HỎNG ${m.newTypeErrors} lỗi type` : "sạch";

function summarize(list: OperatorConflict[]): string {
  if (!list.length) return "không";
  const by = new Map<string, number>();
  for (const o of list) by.set(`${o.layer} ${o.level}`, (by.get(`${o.layer} ${o.level}`) ?? 0) + 1);
  return [...by].map(([k, n]) => `${k}×${n}`).join(", ");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
