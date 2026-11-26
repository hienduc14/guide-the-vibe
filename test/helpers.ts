import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { git } from "../src/shared/util.ts";
import { hashToken } from "../src/server/hub/accounts.ts";
import type { Hub } from "../src/server/hub/hub.ts";

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

/**
 * An account with a connected computer (and a password when given), member of the projects listed.
 * Returns the computer's key (`device`) and, with a password, a dashboard session.
 */
export async function addPerson(
  srv: { hub: Hub; app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> } },
  name: string,
  opts: { role?: "admin" | "member"; projects?: Record<string, "manager" | "developer" | "viewer">; password?: string } = {},
): Promise<{ device: string; session?: string }> {
  const { hub } = srv;
  if (!hub.accounts.user(name)) hub.accounts.createUser(name, opts.role ?? "member", "test");
  for (const [id, access] of Object.entries(opts.projects ?? {})) (await hub.runtime(id)).engine.store.saveMember(name, { access });
  const device = `gtvd_test_${name}_${randomBytes(6).toString("hex")}`;
  hub.accounts.addDevice(name, hashToken(device), `${name}-laptop`, "linux");
  if (!opts.password) return { device };
  hub.accounts.setPassword(name, opts.password);
  const res = await srv.app.request("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, password: opts.password }),
  });
  return { device, session: ((await res.json()) as { token: string }).token };
}
