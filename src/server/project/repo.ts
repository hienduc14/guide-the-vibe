// Bare mirror of the team repo on the server: main + every dev's WIP snapshot refs (refs/gtv/*).

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { git, log } from "../../shared/util.ts";

export interface MergeConflict {
  paths: string[];
  type: string;
  message: string;
}

export interface MergeResult {
  clean: boolean;
  conflictedFiles: string[];
  conflicts: MergeConflict[];
}

export interface DiffEntry {
  status: string; // A, M, D, T
  path: string;
}

export const SNAPSHOT_PREFIX = "refs/gtv/";
/** Snapshots a daemon uploads (a git bundle over HTTP). Not under refs/gtv/, which `fetch --prune` mirrors from origin. */
export const UPLOAD_PREFIX = "refs/gtv-wip/";
/** The ref a daemon's bundle carries its snapshot under. */
export const BUNDLE_REF = "refs/gtv-local/snapshot";

export class Repo {
  readonly dir: string;
  readonly url: string;
  readonly mainBranch: string;

  constructor(dir: string, url: string, mainBranch = "main") {
    this.dir = dir;
    this.url = url;
    this.mainBranch = mainBranch;
  }

  async ensure(): Promise<void> {
    if (!existsSync(this.dir + "/HEAD")) {
      mkdirSync(this.dir, { recursive: true });
      await git(this.dir, ["init", "--bare", "-q"]);
      await git(this.dir, ["remote", "add", "origin", this.url]);
      await git(this.dir, ["config", "remote.origin.fetch", "+refs/heads/*:refs/heads/*"]);
      await git(this.dir, ["config", "--add", "remote.origin.fetch", `+${SNAPSHOT_PREFIX}*:${SNAPSHOT_PREFIX}*`]);
      log("repo", `initialised mirror of ${this.url}`);
    } else {
      // The project's repo URL may have been edited since the mirror was created.
      const current = await git(this.dir, ["remote", "get-url", "origin"], { allowFail: true });
      if (current.stdout.trim() !== this.url) await git(this.dir, ["remote", "set-url", "origin", this.url]);
    }
  }

  async fetch(): Promise<void> {
    await git(this.dir, ["fetch", "--prune", "--quiet", "origin"]);
  }

  /**
   * Take a snapshot from a bundle file into `ref`. "missing" when the bundle builds on commits this mirror does not
   * have (the developer's origin is ahead of ours, or local unpushed commits): fetch, then ask for a full bundle.
   */
  async importBundle(file: string, ref: string): Promise<"ok" | "missing"> {
    const r = await git(this.dir, ["fetch", "--quiet", "--no-tags", file, `+${BUNDLE_REF}:${ref}`], { allowFail: true });
    if (r.code === 0) return "ok";
    if (/prerequisite|lacks|missing|did not send all necessary objects/i.test(r.stderr)) return "missing";
    throw new Error(`could not read the snapshot bundle: ${r.stderr.trim().slice(0, 300)}`);
  }

  async revParse(ref: string): Promise<string | undefined> {
    const r = await git(this.dir, ["rev-parse", "--verify", "--quiet", ref + "^{commit}"], { allowFail: true });
    return r.code === 0 ? r.stdout.trim() : undefined;
  }

  mainSha(): Promise<string | undefined> {
    return this.revParse(`refs/heads/${this.mainBranch}`);
  }

  /** refs/gtv/<dev>/<workspace> -> sha */
  async snapshotRefs(): Promise<Map<string, string>> {
    const r = await git(this.dir, ["for-each-ref", "--format=%(refname) %(objectname)", SNAPSHOT_PREFIX]);
    const out = new Map<string, string>();
    for (const line of r.stdout.split("\n")) {
      const [ref, sha] = line.trim().split(" ");
      if (ref && sha) out.set(ref, sha);
    }
    return out;
  }

  async listFiles(sha: string): Promise<string[]> {
    const r = await git(this.dir, ["ls-tree", "-r", "--name-only", "-z", sha]);
    return r.stdout.split("\0").filter(Boolean);
  }

  /** path -> blob oid (the oid doubles as a content hash). */
  async listBlobs(sha: string): Promise<Map<string, string>> {
    const r = await git(this.dir, ["ls-tree", "-r", "-z", sha]);
    const out = new Map<string, string>();
    for (const entry of r.stdout.split("\0")) {
      const tab = entry.indexOf("\t");
      if (tab < 0) continue;
      const [, type, oid] = entry.slice(0, tab).split(" ");
      if (type === "blob") out.set(entry.slice(tab + 1), oid);
    }
    return out;
  }

  /** Committer date, ISO 8601 UTC (comparable with our timestamps). */
  async commitTime(sha: string): Promise<string | undefined> {
    const r = await git(this.dir, ["show", "-s", "--format=%ct", sha], { allowFail: true });
    const secs = Number(r.stdout.trim());
    return r.code === 0 && secs ? new Date(secs * 1000).toISOString() : undefined;
  }

  async mergeBase(a: string, b: string): Promise<string | undefined> {
    const r = await git(this.dir, ["merge-base", a, b], { allowFail: true });
    return r.code === 0 ? r.stdout.trim() : undefined;
  }

  async diffNames(from: string, to: string): Promise<DiffEntry[]> {
    const r = await git(this.dir, ["diff", "--name-status", "--no-renames", "-z", from, to]);
    const parts = r.stdout.split("\0").filter((x) => x !== "");
    const out: DiffEntry[] = [];
    for (let i = 0; i + 1 < parts.length; i += 2) out.push({ status: parts[i][0], path: parts[i + 1] });
    return out;
  }

  /** Lines added or modified in `to` relative to `from`, per file, as inclusive [start, end] ranges. */
  async changedLines(from: string, to: string): Promise<Map<string, [number, number][]>> {
    const r = await git(this.dir, ["diff", "-U0", "--no-renames", "--no-color", from, to]);
    const out = new Map<string, [number, number][]>();
    let file: string | undefined;
    for (const line of r.stdout.split("\n")) {
      if (line.startsWith("+++ ")) {
        file = line === "+++ /dev/null" ? undefined : line.slice(6);
        if (file && !out.has(file)) out.set(file, []);
        continue;
      }
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (m && file) {
        const start = Number(m[1]);
        const count = m[2] === undefined ? 1 : Number(m[2]);
        if (count > 0) out.get(file)!.push([start, start + count - 1]);
      }
    }
    return out;
  }

  /** Read many blobs at once with `git cat-file --batch`. Missing paths map to undefined. */
  readFiles(sha: string, paths: string[]): Promise<Map<string, string | undefined>> {
    return new Promise((resolve, reject) => {
      const out = new Map<string, string | undefined>();
      if (paths.length === 0) return resolve(out);
      const child = spawn("git", ["cat-file", "--batch"], { cwd: this.dir, windowsHide: true });
      const chunks: Buffer[] = [];
      child.stdout.on("data", (d: Buffer) => chunks.push(d));
      child.on("error", reject);
      child.on("close", () => {
        const buf = Buffer.concat(chunks);
        let pos = 0;
        for (const p of paths) {
          const nl = buf.indexOf(10, pos);
          if (nl < 0) break;
          const head = buf.subarray(pos, nl).toString("utf8");
          pos = nl + 1;
          if (head.endsWith(" missing") || head.endsWith(" ambiguous")) {
            out.set(p, undefined);
            continue;
          }
          const size = Number(head.split(" ")[2]);
          out.set(p, buf.subarray(pos, pos + size).toString("utf8"));
          pos += size + 1; // trailing LF
        }
        resolve(out);
      });
      child.stdin.end(paths.map((p) => `${sha}:${p}`).join("\n") + "\n");
    });
  }

  /** Unified diff of one file between two commits (`context` lines around changes), "" when it did not change. */
  async diffFile(from: string, to: string, path: string, context = 3): Promise<string> {
    const r = await git(this.dir, ["diff", "--no-renames", "--no-color", `-U${context}`, from, to, "--", path], { allowFail: true });
    return r.code === 0 ? r.stdout : "";
  }

  async readFile(sha: string, path: string): Promise<string | undefined> {
    return (await this.readFiles(sha, [path])).get(path);
  }

  /** Speculative merge without touching any worktree. Relies on the exit status, not the output. */
  async mergeTree(a: string, b: string): Promise<MergeResult> {
    const r = await git(this.dir, ["merge-tree", "--write-tree", "--name-only", "-z", a, b], { allowFail: true });
    if (r.code !== 0 && r.code !== 1) throw new Error(`merge-tree failed (${r.code}): ${r.stderr.trim()}`);
    return parseMergeTree(r.stdout, r.code === 0);
  }

  async grep(sha: string, pattern: string, limit = 60): Promise<string[]> {
    // -e: the pattern comes from the brain, so a leading "-" must not be read as an option (e.g. --open-files-in-pager=<cmd>)
    const r = await git(this.dir, ["grep", "-n", "-I", "-E", "--max-count=20", "-e", pattern, sha, "--"], { allowFail: true });
    return r.stdout
      .split("\n")
      .filter(Boolean)
      .slice(0, limit)
      .map((l) => l.slice(sha.length + 1));
  }

  /** Recent authors of a path (cheap ownership signal). */
  async authors(sha: string, path: string): Promise<{ author: string; commits: number }[]> {
    const r = await git(this.dir, ["log", "-n", "300", "--format=%an <%ae>", sha, "--", path], { allowFail: true });
    const counts = new Map<string, number>();
    for (const a of r.stdout.split("\n").filter(Boolean)) counts.set(a, (counts.get(a) ?? 0) + 1);
    return [...counts].map(([author, commits]) => ({ author, commits })).sort((x, y) => y.commits - x.commits);
  }

  async log(sha: string, path: string | undefined, n = 10): Promise<string[]> {
    const args = ["log", `-n${n}`, "--format=%h %ad %an: %s", "--date=short", sha];
    if (path) args.push("--", path);
    const r = await git(this.dir, args, { allowFail: true });
    return r.stdout.split("\n").filter(Boolean);
  }
}

/**
 * Parse `git merge-tree --write-tree --name-only -z` output:
 *   <tree>NUL <conflicted path>NUL ... NUL <npaths>NUL <path>NUL... <type>NUL <message>NUL ...
 */
export function parseMergeTree(stdout: string, clean: boolean): MergeResult {
  const parts = stdout.split("\0");
  let i = 1; // skip tree oid
  const conflictedFiles: string[] = [];
  if (!clean) {
    while (i < parts.length && parts[i] !== "") conflictedFiles.push(parts[i++]);
  }
  i++; // empty separator before informational messages
  const conflicts: MergeConflict[] = [];
  while (i < parts.length) {
    const n = Number(parts[i]);
    if (!Number.isInteger(n) || n <= 0) break;
    const paths = parts.slice(i + 1, i + 1 + n);
    const type = parts[i + 1 + n] ?? "";
    const message = (parts[i + 2 + n] ?? "").trim();
    conflicts.push({ paths, type, message });
    i += n + 3;
  }
  return { clean, conflictedFiles, conflicts };
}
