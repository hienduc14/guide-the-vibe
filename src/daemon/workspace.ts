// Working copies: repo root, branch and which gtv project they belong to.
// Project = `.git/gtv-project` (written by `gtv link`) or the server's match of the remote URL.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { repoTop, currentBranch } from "./snapshot.ts";
import { git, shortHash } from "../shared/util.ts";

export interface WorkspaceInfo {
  id: string;
  top: string;
  label: string;
  project: string;
  branch?: string;
  branchAt: number;
}

export const LINK_FILE = "gtv-project";

async function gitCommonDir(top: string): Promise<string> {
  const r = await git(top, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return r.stdout.trim();
}

export async function readLink(top: string): Promise<string | undefined> {
  const f = join(await gitCommonDir(top), LINK_FILE);
  return existsSync(f) ? readFileSync(f, "utf8").trim() || undefined : undefined;
}

export async function writeLink(dir: string, project: string): Promise<string> {
  const top = await repoTop(dir);
  if (!top) throw new Error(`${dir} is not inside a git repository`);
  const f = join(await gitCommonDir(top), LINK_FILE);
  writeFileSync(f, project + "\n");
  return f;
}

export async function remoteUrl(top: string, remote: string): Promise<string | undefined> {
  const r = await git(top, ["remote", "get-url", remote], { allowFail: true });
  return r.code === 0 ? r.stdout.trim() : undefined;
}

/** Caches git lookups: spawning git costs ~100ms on Windows. */
export class Workspaces {
  private readonly dev: string;
  private readonly remote: string;
  private readonly resolveRemote: (url: string) => Promise<string | undefined>;
  private byTop = new Map<string, WorkspaceInfo>();
  private topByCwd = new Map<string, string | null>();

  constructor(dev: string, remote: string, resolveRemote: (url: string) => Promise<string | undefined>) {
    this.dev = dev;
    this.remote = remote;
    this.resolveRemote = resolveRemote;
  }

  all(): WorkspaceInfo[] {
    return [...this.byTop.values()];
  }

  /** undefined when cwd is not a git repo or the repo is not linked to any project. */
  async get(cwd: string): Promise<WorkspaceInfo | undefined> {
    let top = this.topByCwd.get(cwd);
    if (top === undefined) {
      top = (await repoTop(cwd)) ?? null;
      this.topByCwd.set(cwd, top);
    }
    if (!top) return undefined;
    let info = this.byTop.get(top);
    if (!info) {
      const linked = await readLink(top);
      const url = linked ? undefined : await remoteUrl(top, this.remote);
      const project = linked ?? (url ? await this.resolveRemote(url) : undefined);
      if (!project) {
        this.topByCwd.delete(cwd); // retry later: the project may be created meanwhile
        return undefined;
      }
      info = {
        id: `ws_${shortHash(`${this.dev}|${top.toLowerCase()}`, 10)}`,
        top,
        label: basename(top),
        project,
        branch: await currentBranch(top),
        branchAt: Date.now(),
      };
      this.byTop.set(top, info);
    } else if (Date.now() - info.branchAt > 15_000) {
      info.branch = await currentBranch(top);
      info.branchAt = Date.now();
    }
    return info;
  }
}
