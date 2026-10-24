// L1: speculative merge of WIP snapshots (and of each snapshot against main) with git merge-tree.

import type { Repo, MergeResult } from "../project/repo.ts";
import type { Workspace } from "../../shared/types.ts";
import type { FoundConflict } from "./l0.ts";

const cache = new Map<string, MergeResult>();

async function merge(repo: Repo, a: string, b: string): Promise<MergeResult> {
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const res = await repo.mergeTree(a, b);
  if (cache.size > 2000) cache.clear();
  cache.set(key, res);
  return res;
}

function describe(res: MergeResult, path: string): string {
  return res.conflicts.find((c) => c.paths.includes(path))?.type ?? "CONFLICT";
}

/** Conflicts between `ws` and every other workspace with a snapshot, plus `ws` against main. */
export async function detectL1For(repo: Repo, ws: Workspace, others: Workspace[], mainSha: string | undefined): Promise<FoundConflict[]> {
  if (!ws.snapshot_sha) return [];
  const out: FoundConflict[] = [];
  for (const o of others) {
    if (o.id === ws.id || !o.snapshot_sha) continue;
    const res = await merge(repo, ws.snapshot_sha, o.snapshot_sha);
    if (res.clean) continue;
    const [x, y] = ws.id < o.id ? [ws, o] : [o, ws];
    for (const path of res.conflictedFiles) {
      out.push({
        key: `L1|${x.id}|${y.id}|${path}`,
        layer: "L1",
        kind: "text",
        level: "high",
        workspace_a: x.id,
        workspace_b: y.id,
        dev_a: x.dev,
        dev_b: y.dev,
        subject: path,
        evidence: { type: describe(res, path), snapshots: [x.snapshot_sha, y.snapshot_sha] },
        message: `Merging the current work of ${x.dev} (${x.label}) and ${y.dev} (${y.label}) would conflict in ${path} (${describe(res, path)}). Agree who changes what before going further.`,
      });
    }
  }
  if (mainSha && ws.snapshot_base !== mainSha) {
    const res = await merge(repo, ws.snapshot_sha, mainSha);
    if (!res.clean) {
      for (const path of res.conflictedFiles) {
        out.push({
          key: `L1|${ws.id}|main|${path}`,
          layer: "L1",
          kind: "main",
          level: "warning",
          workspace_a: ws.id,
          workspace_b: "main",
          dev_a: ws.dev,
          dev_b: "main",
          subject: path,
          evidence: { type: describe(res, path), main: mainSha },
          message: `Your work in ${ws.label} already conflicts with the latest main in ${path}. Rebase or merge main soon while the change is fresh.`,
        });
      }
    }
  }
  return out;
}
