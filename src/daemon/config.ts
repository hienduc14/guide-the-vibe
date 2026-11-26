// Per-developer config: ~/.gtv/config.json, overridable by environment variables.

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DaemonConfig {
  dev: string;
  server: string;
  token?: string;
  /** This computer's id on the server (gtv login). */
  device_id?: string;
  port: number;
  remote: string; // git remote that snapshots are pushed to
  snapshotDebounceMs: number;
}

export const CONFIG_DIR = process.env.GTV_HOME ?? join(homedir(), ".gtv");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function loadDaemonConfig(): DaemonConfig {
  const file = existsSync(CONFIG_FILE) ? (JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Partial<DaemonConfig>) : {};
  return {
    dev: process.env.GTV_DEV ?? file.dev ?? process.env.USERNAME ?? process.env.USER ?? "dev",
    server: (process.env.GTV_SERVER ?? file.server ?? "http://127.0.0.1:7390").replace(/\/$/, ""),
    token: process.env.GTV_TOKEN ?? file.token,
    device_id: file.device_id,
    port: Number(process.env.GTV_DAEMON_PORT ?? file.port ?? 7391),
    remote: process.env.GTV_REMOTE ?? file.remote ?? "origin",
    snapshotDebounceMs: Number(process.env.GTV_SNAPSHOT_DEBOUNCE_MS ?? file.snapshotDebounceMs ?? 300_000),
  };
}

/** The saved server, whatever the environment says (to suggest it again at login). */
export const savedServer = (): string | undefined =>
  existsSync(CONFIG_FILE) ? (JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as { server?: string }).server : undefined;

/** Merge into ~/.gtv/config.json; a key set to null is removed. The file holds a key: only its owner reads it. */
export function saveDaemonConfig(cfg: Partial<Record<keyof DaemonConfig, unknown>>): DaemonConfig {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const current = existsSync(CONFIG_FILE) ? JSON.parse(readFileSync(CONFIG_FILE, "utf8")) : {};
  const next = { ...current, ...Object.fromEntries(Object.entries(cfg).filter(([, v]) => v !== undefined)) };
  for (const [k, v] of Object.entries(next)) if (v === null) delete next[k];
  writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(CONFIG_FILE, 0o600);
  return loadDaemonConfig();
}

/** Repos where `gtv on` ran: ~/.gtv/repos.json. */
export interface RepoEntry {
  path: string;
  project: string;
}
const REPOS_FILE = join(CONFIG_DIR, "repos.json");

export function loadRepos(): RepoEntry[] {
  try {
    return existsSync(REPOS_FILE) ? (JSON.parse(readFileSync(REPOS_FILE, "utf8")) as RepoEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveRepos(repos: RepoEntry[]): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(REPOS_FILE, JSON.stringify(repos, null, 2) + "\n");
}

/** Short hash of the token, so a running daemon can tell whether it still has the current one (never the token). */
export const tokenFingerprint = (token?: string) => (token ? createHash("sha256").update(token).digest("hex").slice(0, 12) : null);

export function daemonUrl(cfg: DaemonConfig = loadDaemonConfig()): string {
  return `http://127.0.0.1:${cfg.port}`;
}
