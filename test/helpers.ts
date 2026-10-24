import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { git } from "../src/shared/util.ts";

export const GIT_ENV = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};
Object.assign(process.env, GIT_ENV);

export function tempDir(prefix = "gtv-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [p, c] of Object.entries(files)) {
    const full = join(root, p);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, c);
  }
}

export interface Origin {
  root: string;
  bare: string;
  clone(name: string): Promise<string>;
  cleanup(): void;
}

/** A bare "GitHub" repo with an initial commit on main. */
export async function makeOrigin(files: Record<string, string>): Promise<Origin> {
  const root = tempDir();
  const bare = join(root, "origin.git");
  await git(root, ["init", "--bare", "-q", "-b", "main", bare]);
  const seed = join(root, "seed");
  await git(root, ["clone", "-q", bare, seed]);
  await git(seed, ["checkout", "-q", "-b", "main"]);
  writeFiles(seed, files);
  await git(seed, ["add", "-A"]);
  await git(seed, ["commit", "-q", "-m", "initial"]);
  await git(seed, ["push", "-q", "origin", "main"]);
  return {
    root,
    bare,
    async clone(name: string) {
      const dir = join(root, name);
      await git(root, ["clone", "-q", bare, dir]);
      return dir;
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export async function commitAndPush(dir: string, files: Record<string, string>, msg = "change"): Promise<void> {
  writeFiles(dir, files);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", msg]);
  await git(dir, ["push", "-q", "origin", "HEAD:main"]);
}
