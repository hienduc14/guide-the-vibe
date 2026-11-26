// Wiring an agent's hooks, MCP server and skill into a repo (and taking them out again), the background daemon,
// and installing the `gtv` command itself.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  openSync,
  rmSync,
  readdirSync,
  chmodSync,
  symlinkSync,
  unlinkSync,
  lstatSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR, daemonUrl, loadDaemonConfig, tokenFingerprint } from "./config.ts";

// Set by scripts/build-npm.mjs: the npm package is one bundled file with the skill inlined.
declare const __GTV_SKILL__: string | undefined;
declare const __GTV_TASKS_SKILL__: string | undefined;
declare const __GTV_VERSION__: string | undefined;
export const BUNDLED = typeof __GTV_SKILL__ === "string";

export const GTV_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/** What hooks and MCP run. The npm build copies itself to ~/.gtv/bin, so npx's cache can be cleared. */
export const GTV_BIN = (BUNDLED ? join(CONFIG_DIR, "bin", "gtv.mjs") : join(GTV_ROOT, "bin", "gtv.mjs")).replace(/\\/g, "/");
const skillText = () => (BUNDLED ? __GTV_SKILL__! : readFileSync(join(GTV_ROOT, "src", "adapters", "skill", "SKILL.md"), "utf8"));
/** The /gtv skill: pick work from the task board. */
const tasksSkillText = () => (BUNDLED ? __GTV_TASKS_SKILL__! : readFileSync(join(GTV_ROOT, "src", "adapters", "skill", "gtv", "SKILL.md"), "utf8"));

export const GTV_VERSION: string =
  typeof __GTV_VERSION__ === "string" ? __GTV_VERSION__ : (JSON.parse(readFileSync(join(GTV_ROOT, "package.json"), "utf8")) as { version: string }).version;

/** True when this process runs the copy in ~/.gtv/bin (the installed `gtv`), not npx's download. */
export const isInstalledCopy = () => !BUNDLED || resolve(fileURLToPath(import.meta.url)) === resolve(GTV_BIN);

function ensureBin(): void {
  if (!BUNDLED) return;
  mkdirSync(dirname(GTV_BIN), { recursive: true });
  const self = fileURLToPath(import.meta.url);
  if (resolve(self) !== resolve(GTV_BIN)) copyFileSync(self, GTV_BIN);
}

export const onPath = (cmd: string) => spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" }).status === 0;

/**
 * `npx guide-the-vibe`: copy the bundle to ~/.gtv/bin and put a `gtv` command on the PATH. Returns what it did,
 * as lines for the person. Running it again updates the copy.
 */
export function installSelf(): { bin: string; path: string } {
  ensureBin();
  const binDir = dirname(GTV_BIN);
  const dirs = (process.env.PATH ?? "").split(delimiter).map((d) => resolve(d));
  if (process.platform === "win32") {
    // WindowsApps is on every user's PATH; a .cmd there runs the copy in ~/.gtv/bin.
    const apps = join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Microsoft", "WindowsApps");
    const shim = join(binDir, "gtv.cmd");
    const body = `@echo off\r\nnode "${GTV_BIN.replace(/\//g, "\\")}" %*\r\n`;
    writeFileSync(shim, body);
    try {
      writeFileSync(join(apps, "gtv.cmd"), body);
      return { bin: shim, path: "Added gtv to your PATH (open a new terminal if `gtv` is not found)" };
    } catch {
      return { bin: shim, path: `Could not add gtv to your PATH. Run this once, then open a new terminal: setx PATH "%PATH%;${binDir}"` };
    }
  }
  const sh = join(binDir, "gtv");
  writeFileSync(sh, `#!/bin/sh\nexec node "${GTV_BIN}" "$@"\n`);
  chmodSync(sh, 0o755);
  if (dirs.includes(resolve(binDir))) return { bin: sh, path: "gtv is on your PATH" };
  const local = join(homedir(), ".local", "bin");
  if (dirs.includes(resolve(local))) {
    const link = join(local, "gtv");
    try {
      if (lstatExists(link)) unlinkSync(link);
      mkdirSync(local, { recursive: true });
      symlinkSync(sh, link);
      return { bin: sh, path: `Added gtv to your PATH (${link.replace(homedir(), "~")})` };
    } catch {
      // fall through to the shell profiles
    }
  }
  const line = `export PATH="${binDir === join(homedir(), ".gtv", "bin") ? "$HOME/.gtv/bin" : binDir}:$PATH"`;
  const edited: string[] = [];
  for (const rc of [".bashrc", ".zshrc"].map((f) => join(homedir(), f))) {
    if (!existsSync(rc)) continue;
    const text = readFileSync(rc, "utf8");
    if (!text.includes(line)) writeFileSync(rc, `${text}${text.endsWith("\n") || !text ? "" : "\n"}\n# gtv\n${line}\n`);
    edited.push(rc.replace(homedir(), "~"));
  }
  return {
    bin: sh,
    path: edited.length
      ? `Added gtv to your PATH in ${edited.join(" and ")} (open a new terminal if \`gtv\` is not found)`
      : `Add this line to your shell profile, then open a new terminal: ${line}`,
  };
}

const lstatExists = (p: string) => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

export interface DaemonHealth {
  pid?: number;
  dev: string;
  server: string;
  token?: string | null;
  reachable: boolean;
  projects: Record<string, boolean>;
  sessions: number;
}

/** The running daemon's /health, or undefined when none answers. */
export const daemonHealth = (daemon = daemonUrl()): Promise<DaemonHealth | undefined> =>
  fetch(`${daemon}/health`, { signal: AbortSignal.timeout(1000) })
    .then((r) => r.json() as Promise<DaemonHealth>)
    .catch(() => undefined);

/** Stops the daemon on this port; true when none is left running. */
export async function stopDaemon(daemon = daemonUrl()): Promise<boolean> {
  const h = await daemonHealth(daemon);
  if (!h) return true;
  if (!h.pid) return false;
  try {
    process.kill(h.pid);
  } catch {
    return false; // another user's process
  }
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 150));
    if (!(await daemonHealth(daemon))) return true;
  }
  return false;
}

/**
 * Starts the daemon in the background unless one already runs with the current config
 * (one running with another dev or server is stopped first). Returns false if it did not come up.
 */
export async function ensureDaemon(daemon = daemonUrl()): Promise<boolean> {
  const cfg = loadDaemonConfig();
  const health = () => daemonHealth(daemon);
  const h = await health();
  // A new invite rotates the token: a daemon still holding the old one would get 401s, so restart it.
  if (h && h.dev === cfg.dev && h.server === cfg.server && h.token === tokenFingerprint(cfg.token)) return true;
  if (h && !(await stopDaemon(daemon))) return false; // someone else's daemon on this port
  ensureBin();
  mkdirSync(CONFIG_DIR, { recursive: true });
  const logFd = openSync(join(CONFIG_DIR, "daemon.log"), "a");
  spawn(process.execPath, [GTV_BIN, "daemon"], { detached: true, stdio: ["ignore", logFd, logFd], windowsHide: true }).unref();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await health()) return true;
  }
  return false;
}

/** Every command carries the daemon URL explicitly, so several devs/daemons can share one machine. */
const cmd = (daemon: string, ...args: string[]) => `node "${GTV_BIN}" ${args.join(" ")} --daemon ${daemon}`;

function readJson(path: string): Record<string, any> {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8") || "{}") : {};
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

/**
 * Replace any previous gtv entries for each event, keep everything else. A gtv entry either runs gtv.mjs or
 * posts to a daemon's /hook/<agent> URL (that one has no "gtv" in it: missing it duplicated hooks on reinstall).
 */
export function mergeHooks(existing: Record<string, any[]> | undefined, add: Record<string, any[]>): Record<string, any[]> {
  const out: Record<string, any[]> = { ...(existing ?? {}) };
  for (const [event, groups] of Object.entries(add)) out[event] = [...(out[event] ?? []).filter((g) => !isGtvHook(g)), ...groups];
  return out;
}

export function isGtvHook(group: unknown): boolean {
  const s = JSON.stringify(group);
  return s.includes("gtv") || /https?:\/\/(127\.0\.0\.1|localhost):\d+\/hook\//.test(s);
}

// ---- taking gtv out of a repo (gtv off): only gtv's entries go, files are deleted only when nothing else is left ----

/** Hooks without gtv's groups; events left empty disappear. */
export function stripHooks(hooks: Record<string, any[]> | undefined): Record<string, any[]> | undefined {
  if (!hooks) return undefined;
  const out = Object.fromEntries(
    Object.entries(hooks)
      .map(([event, groups]) => [event, (groups ?? []).filter((g) => !isGtvHook(g))] as const)
      .filter(([, groups]) => groups.length),
  );
  return Object.keys(out).length ? out : undefined;
}

/** Codex config without the [mcp_servers.gtv] table. */
export const stripCodexToml = (toml: string) => toml.replace(/\n?\[mcp_servers\.gtv\][\s\S]*?(?=\n\[|$)/, "");

/** Rewrites (or deletes, when empty) a JSON file; returns whether it changed. */
function editJson(path: string, edit: (v: Record<string, any>) => Record<string, any>): boolean {
  if (!existsSync(path)) return false;
  const before = readJson(path);
  const after = edit(structuredClone(before));
  if (JSON.stringify(after) === JSON.stringify(before)) return false;
  if (Object.keys(after).length) writeJson(path, after);
  else rmSync(path);
  return true;
}

/** Removes empty folders upwards, stopping at the repo. */
function pruneDirs(dir: string, stop: string): void {
  while (resolve(dir) !== resolve(stop) && existsSync(dir) && !readdirSync(dir).length) {
    rmSync(dir, { recursive: true });
    dir = dirname(dir);
  }
}

function removeSkills(project: string, base: string): string[] {
  const removed: string[] = [];
  for (const name of ["gtv-collaboration", "gtv"]) {
    const dir = join(project, base, "skills", name);
    if (!existsSync(dir)) continue;
    rmSync(dir, { recursive: true });
    removed.push(dir);
    pruneDirs(dirname(dir), project);
  }
  return removed;
}

export function uninstallClaude(project: string): string[] {
  const removed: string[] = [];
  const settingsPath = join(project, ".claude", "settings.local.json");
  const changed = editJson(settingsPath, (v) => {
    const hooks = stripHooks(v.hooks);
    if (hooks) v.hooks = hooks;
    else delete v.hooks;
    if (v.statusLine && JSON.stringify(v.statusLine).includes("gtv")) delete v.statusLine;
    return v;
  });
  if (changed) removed.push(`${settingsPath} (gtv hooks)`);
  const mcpPath = join(project, ".mcp.json");
  if (
    editJson(mcpPath, (v) => {
      if (v.mcpServers) delete v.mcpServers.gtv;
      if (v.mcpServers && !Object.keys(v.mcpServers).length) delete v.mcpServers;
      return v;
    })
  )
    removed.push(`${mcpPath} (gtv MCP server)`);
  removed.push(...removeSkills(project, ".claude"));
  pruneDirs(join(project, ".claude"), project);
  return removed;
}

export function uninstallCodex(project: string): string[] {
  const removed: string[] = [];
  const hooksPath = join(project, ".codex", "hooks.json");
  if (
    editJson(hooksPath, (v) => {
      const hooks = stripHooks(v.hooks);
      if (hooks) v.hooks = hooks;
      else delete v.hooks;
      return v;
    })
  )
    removed.push(`${hooksPath} (gtv hooks)`);
  const tomlPath = join(project, ".codex", "config.toml");
  if (existsSync(tomlPath)) {
    const before = readFileSync(tomlPath, "utf8");
    const after = stripCodexToml(before);
    if (after !== before) {
      if (after.trim()) writeFileSync(tomlPath, after.replace(/\n*$/, "\n"));
      else rmSync(tomlPath);
      removed.push(`${tomlPath} (gtv MCP server)`);
    }
  }
  removed.push(...removeSkills(project, ".codex"));
  pruneDirs(join(project, ".codex"), project);
  return removed;
}

/**
 * Whether a repo's setup for an agent is what this version writes: "missing" (never set up), "ok", or "stale"
 * (written by an older version, for another daemon, or with duplicated hooks).
 */
export function setupState(project: string, agent: "claude" | "codex", daemon = daemonUrl()): "missing" | "ok" | "stale" {
  const hooksPath = agent === "claude" ? join(project, ".claude", "settings.local.json") : join(project, ".codex", "hooks.json");
  const hooks = (readJsonSafe(hooksPath).hooks ?? {}) as Record<string, any[]>;
  const gtvGroups = Object.values(hooks).flatMap((groups) => (groups ?? []).filter(isGtvHook));
  if (!gtvGroups.length) return "missing";
  const want = agent === "claude" ? `${daemon}/hook/claude` : cmd(daemon, "hook", "codex");
  const perEvent = Object.values(hooks).map((groups) => (groups ?? []).filter(isGtvHook).length);
  const mcp =
    agent === "claude" ? JSON.stringify(readJsonSafe(join(project, ".mcp.json")).mcpServers?.gtv ?? "") : readText(join(project, ".codex", "config.toml"));
  const skill = existsSync(join(project, agent === "claude" ? ".claude" : ".codex", "skills", "gtv-collaboration", "SKILL.md"));
  const dupes = perEvent.some((n) => n > 1);
  const commands = gtvGroups.flatMap((g) => (g.hooks ?? []).map((x: { url?: string; command?: string }) => x.url ?? x.command ?? ""));
  return commands.some((c) => c.startsWith(want)) && mcp.includes(GTV_BIN) && skill && !dupes ? "ok" : "stale";
}

const readText = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
function readJsonSafe(path: string): Record<string, any> {
  try {
    return readJson(path);
  } catch {
    return {};
  }
}

function installSkill(dir: string, text = skillText()): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), text);
  return join(dir, "SKILL.md");
}

export function installClaude(project: string, daemon = daemonUrl()): string[] {
  ensureBin();
  const http = (timeout: number) => ({ type: "http", url: `${daemon}/hook/claude`, timeout });
  const settingsPath = join(project, ".claude", "settings.local.json");
  const settings = readJson(settingsPath);
  settings.hooks = mergeHooks(settings.hooks, {
    SessionStart: [{ hooks: [http(15)] }],
    UserPromptSubmit: [{ hooks: [http(5)] }],
    PreToolUse: [{ matcher: "Edit|Write|MultiEdit|NotebookEdit|ExitPlanMode", hooks: [http(5)] }],
    PostToolUse: [{ matcher: "*", hooks: [http(5)] }],
    Stop: [{ hooks: [http(5), { type: "command", command: cmd(daemon, "hook-wait", "claude"), asyncRewake: true }] }],
    SessionEnd: [{ hooks: [http(3)] }],
  });
  if (!settings.statusLine || JSON.stringify(settings.statusLine).includes("gtv")) {
    settings.statusLine = { type: "command", command: cmd(daemon, "statusline") };
  }
  writeJson(settingsPath, settings);

  const mcpPath = join(project, ".mcp.json");
  const mcp = readJson(mcpPath);
  mcp.mcpServers = { ...(mcp.mcpServers ?? {}), gtv: { command: "node", args: [GTV_BIN, "mcp", "--agent", "auto", "--daemon", daemon] } };
  writeJson(mcpPath, mcp);
  const skill = installSkill(join(project, ".claude", "skills", "gtv-collaboration"));
  const tasks = installSkill(join(project, ".claude", "skills", "gtv"), tasksSkillText()); // /gtv
  return [settingsPath, mcpPath, skill, tasks];
}

export function installCodex(project: string, daemon = daemonUrl()): string[] {
  ensureBin();
  const hook = (timeout: number) => ({ type: "command", command: cmd(daemon, "hook", "codex"), timeout });
  const hooksPath = join(project, ".codex", "hooks.json");
  const hooks = readJson(hooksPath);
  hooks.hooks = mergeHooks(hooks.hooks, {
    SessionStart: [{ hooks: [hook(15)] }],
    UserPromptSubmit: [{ hooks: [hook(10)] }],
    PreToolUse: [{ matcher: "apply_patch|Edit|Write|update_plan", hooks: [hook(10)] }],
    PostToolUse: [{ hooks: [hook(10)] }],
    Stop: [{ hooks: [hook(10)] }],
    SessionEnd: [{ hooks: [hook(3)] }],
  });
  writeJson(hooksPath, hooks);

  const tomlPath = join(project, ".codex", "config.toml");
  let toml = existsSync(tomlPath) ? readFileSync(tomlPath, "utf8") : "";
  toml = toml.replace(/\n?\[mcp_servers\.gtv\][\s\S]*?(?=\n\[|$)/, "");
  toml += `${toml && !toml.endsWith("\n") ? "\n" : ""}\n[mcp_servers.gtv]\ncommand = "node"\nargs = ["${GTV_BIN}", "mcp", "--agent", "codex", "--daemon", "${daemon}"]\ntool_timeout_sec = 150\n# gtv tools only talk to the Operator (never touch code); without this Codex asks for every call, and fails them under approval_policy = "never"\ndefault_tools_approval_mode = "approve"\n`;
  writeFileSync(tomlPath, toml);
  const skill = installSkill(join(project, ".codex", "skills", "gtv-collaboration"));
  const tasks = installSkill(join(project, ".codex", "skills", "gtv"), tasksSkillText()); // $gtv
  return [hooksPath, tomlPath, skill, tasks];
}
