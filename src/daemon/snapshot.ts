// WIP snapshot: commit the working tree into a throwaway commit using a temporary index, then
// force-push it to refs/gtv/<dev>/<workspace>. The dev's branch, index and stash are never touched.

import { join } from "node:path";
import { git } from "../shared/util.ts";

const SNAPSHOT_IDENTITY = {
  GIT_AUTHOR_NAME: "gtv-snapshot",
  GIT_AUTHOR_EMAIL: "gtv@localhost",
  GIT_COMMITTER_NAME: "gtv-snapshot",
  GIT_COMMITTER_EMAIL: "gtv@localhost",
};

const lastTree = new Map<string, string>();

export interface SnapshotResult {
  sha: string;
  tree: string;
  branch?: string;
  pushed: boolean;
}

export async function repoTop(dir: string): Promise<string | undefined> {
  const r = await git(dir, ["rev-parse", "--show-toplevel"], { allowFail: true });
  return r.code === 0 ? r.stdout.trim() : undefined;
}

export async function currentBranch(dir: string): Promise<string | undefined> {
  const r = await git(dir, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFail: true });
  const b = r.stdout.trim();
  return r.code === 0 && b !== "HEAD" ? b : undefined;
}

/** Returns undefined when `dir` is not a git repo. Skips the push when the tree did not change. */
export async function snapshotWorktree(dir: string, ref: string, opts: { remote?: string; push?: boolean } = {}): Promise<SnapshotResult | undefined> {
  const top = await repoTop(dir);
  if (!top) return undefined;
  const gitDir = (await git(top, ["rev-parse", "--absolute-git-dir"])).stdout.trim();
  const env = { GIT_INDEX_FILE: join(gitDir, "gtv-snapshot-index"), ...SNAPSHOT_IDENTITY };
  const head = await git(top, ["rev-parse", "--verify", "--quiet", "HEAD"], { allowFail: true });
  const headSha = head.code === 0 ? head.stdout.trim() : undefined;

  await git(top, headSha ? ["read-tree", headSha] : ["read-tree", "--empty"], { env });
  await git(top, ["add", "-A"], { env });
  const tree = (await git(top, ["write-tree"], { env })).stdout.trim();
  const branch = await currentBranch(top);

  const key = `${top}|${ref}`;
  const commitArgs = ["commit-tree", tree, "-m", `gtv wip snapshot${branch ? ` of ${branch}` : ""}`];
  if (headSha) commitArgs.splice(2, 0, "-p", headSha);
  const sha = (await git(top, commitArgs, { env })).stdout.trim();

  if (lastTree.get(key) === `${tree}|${headSha}`) return { sha, tree, branch, pushed: false };
  if (opts.push !== false) {
    await git(top, ["push", "--quiet", "--force", opts.remote ?? "origin", `${sha}:${ref}`]);
  }
  lastTree.set(key, `${tree}|${headSha}`);
  return { sha, tree, branch, pushed: opts.push !== false };
}
