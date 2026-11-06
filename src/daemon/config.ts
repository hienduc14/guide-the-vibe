// Per-developer config: ~/.gtv/config.json, overridable by environment variables.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DaemonConfig {
  dev: string;
  server: string;
  token?: string;
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
    port: Number(process.env.GTV_DAEMON_PORT ?? file.port ?? 7391),
    remote: process.env.GTV_REMOTE ?? file.remote ?? "origin",
    snapshotDebounceMs: Number(process.env.GTV_SNAPSHOT_DEBOUNCE_MS ?? file.snapshotDebounceMs ?? 300_000),
  };
}

export function saveDaemonConfig(cfg: Partial<DaemonConfig>): DaemonConfig {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const current = existsSync(CONFIG_FILE) ? JSON.parse(readFileSync(CONFIG_FILE, "utf8")) : {};
  const next = { ...current, ...Object.fromEntries(Object.entries(cfg).filter(([, v]) => v !== undefined)) };
  writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
  return loadDaemonConfig();
}

/** Short hash of the token, so a running daemon can tell whether it still has the current one (never the token). */
export const tokenFingerprint = (token?: string) => (token ? createHash("sha256").update(token).digest("hex").slice(0, 12) : null);

export function daemonUrl(cfg: DaemonConfig = loadDaemonConfig()): string {
  return `http://127.0.0.1:${cfg.port}`;
}
