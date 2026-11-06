// Merge two commits without a worktree and judge the result: git conflict (files, conflicted lines) or,
// when clean, type errors that the base does not have (a "logic" conflict). Shared by the scripted
// benchmark (conflicts.ts) and the measurement of real runs (measure.ts).

import { rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { git, run } from "../../src/shared/util.ts";

const TSC = join(resolve(import.meta.dirname, "../.."), "node_modules/typescript/bin/tsc");

export interface MergeResult {
  conflict: boolean;
  files: string[];
  conflictLines: number;
  newTypeErrors: number;
  typeErrors: string[];
}

/** Merge `theirs` into `ours` without touching any worktree; count conflicted lines; typecheck if clean. */
export async function merge(scratch: string, ours: string, theirs: string, baseErrors: Set<string>): Promise<MergeResult> {
  const r = await git(scratch, ["merge-tree", "--write-tree", "--name-only", ours, theirs], { allowFail: true });
  const [tree, ...rest] = r.stdout.split("\n");
  const files = r.code === 1 ? rest.slice(0, rest.indexOf("")).filter(Boolean) : [];
  let conflictLines = 0;
  for (const f of files) {
    const text = (await git(scratch, ["show", `${tree}:${f}`], { allowFail: true })).stdout;
    let inside = false;
    for (const line of text.split("\n")) {
      if (line.startsWith("<<<<<<<")) inside = true;
      else if (line.startsWith(">>>>>>>")) inside = false;
      else if (inside && !line.startsWith("=======")) conflictLines++;
    }
  }
  if (files.length) return { conflict: true, files, conflictLines, newTypeErrors: 0, typeErrors: [] };
  const errors = await typeErrors(scratch, tree.trim());
  const fresh = [...errors].filter((e) => !baseErrors.has(e));
  return { conflict: false, files, conflictLines: 0, newTypeErrors: fresh.length, typeErrors: fresh };
}

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
    target: "es2022",
    module: "preserve",
    moduleResolution: "bundler",
    types: [],
  },
  include: ["src/app/**/*.ts"],
});

/** tsc errors of a tree, keyed without line numbers (so unrelated line shifts do not count as new errors). */
export async function typeErrors(scratch: string, treeish: string): Promise<Set<string>> {
  await git(scratch, [
    "checkout",
    "-q",
    "--force",
    "--detach",
    treeish.length === 40 && !(await isCommit(scratch, treeish)) ? await commitTree(scratch, treeish) : treeish,
  ]);
  await git(scratch, ["clean", "-qfd"]);
  writeFileSync(join(scratch, "tsconfig.bench.json"), TSCONFIG);
  const r = await run(process.execPath, [TSC, "-p", "tsconfig.bench.json"], { cwd: scratch });
  rmSync(join(scratch, "tsconfig.bench.json"));
  const out = new Set<string>();
  for (const line of r.stdout.split("\n")) {
    if (/error TS5\d{3}/.test(line)) throw new Error(`tsc config: ${line.trim()}`); // a broken config would hide every type error
    const m = /^(.+?)\(\d+,\d+\): error (TS\d+): (.*)$/.exec(line.trim());
    if (m && !/TS2307|TS7016|TS2591/.test(m[2])) out.add(`${m[1]} ${m[2]} ${m[3]}`); // missing node_modules/@types: same on every tree
  }
  return out;
}

async function isCommit(dir: string, sha: string): Promise<boolean> {
  return (await git(dir, ["cat-file", "-t", sha], { allowFail: true })).stdout.trim() === "commit";
}
async function commitTree(dir: string, tree: string): Promise<string> {
  return (await git(dir, ["commit-tree", tree, "-m", "merged"])).stdout.trim();
}
