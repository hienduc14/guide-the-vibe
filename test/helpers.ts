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

type App = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

/**
 * A request as the dashboard sends it (session cookie + this server's Origin) or as a computer, share link or script
 * does (Bearer). Returns the session cookie the server set, if any.
 */
export async function api<T = any>(
  app: App,
  path: string,
  init: { method?: string; body?: unknown; cookie?: string; token?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: T; cookie?: string }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.cookie) Object.assign(headers, { cookie: `gtv_session=${init.cookie}`, origin: "http://localhost" });
  Object.assign(headers, init.headers);
  const res = await app.request(path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const cookie = /gtv_session=([^;]*)/.exec(res.headers.get("set-cookie") ?? "")?.[1] || undefined;
  return { status: res.status, json: (await res.json()) as T, cookie };
}

/** Signs up on the dashboard; returns the session cookie. */
export async function signup(app: App, name: string, opts: { invite?: string; password?: string } = {}): Promise<string> {
  const r = await api(app, "/api/auth/signup", {
    method: "POST",
    body: { name, display_name: name.toUpperCase(), password: opts.password ?? `${name}-password`, invite: opts.invite },
  });
  if (r.status !== 200 || !r.cookie) throw new Error(`signup ${name}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.cookie;
}

/** Connects a computer to the logged-in account the way gtv login does; returns its key. */
export async function connectDevice(app: App, cookie: string, name = "laptop"): Promise<{ token: string; device_id: string }> {
  const start = (await api(app, "/v1/connect/start", { method: "POST", body: { device_name: name, platform: "linux" } })).json;
  await api(app, `/api/connect/${start.user_code}/approve`, { method: "POST", cookie });
  return (await api(app, "/v1/connect/poll", { method: "POST", body: { device_code: start.device_code } })).json;
}

/**
 * An account with a connected computer (and a password when given), member of the projects listed.
 * Returns the computer's key (`device`) and, with a password, a dashboard session (sent as Bearer or cookie).
 */
export async function addPerson(
  srv: { hub: Hub; app: App },
  name: string,
  opts: { role?: "admin" | "member"; projects?: Record<string, "manager" | "developer" | "viewer">; password?: string } = {},
): Promise<{ device: string; session?: string }> {
  const { hub } = srv;
  if (!hub.accounts.user(name)) hub.accounts.createUser(name, { role: opts.role ?? "member", password: opts.password ?? null });
  for (const [id, access] of Object.entries(opts.projects ?? {})) (await hub.runtime(id)).engine.store.saveMember(name, { access });
  const device = `gtvd_test_${name}_${randomBytes(6).toString("hex")}`;
  hub.accounts.addDevice(name, hashToken(device), `${name}-laptop`, "linux");
  if (!opts.password) return { device };
  const r = await api(srv.app, "/api/auth/login", { method: "POST", body: { name, password: opts.password } });
  return { device, session: r.cookie };
}
