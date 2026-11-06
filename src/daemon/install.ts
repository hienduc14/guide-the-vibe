// `gtv install <agent>`: wire an agent's hooks, MCP and skill into a project.

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR, daemonUrl, loadDaemonConfig } from "./config.ts";

// Set by scripts/build-npm.mjs: the npm package is one bundled file with the skill inlined.
declare const __GTV_SKILL__: string | undefined;
const BUNDLED = typeof __GTV_SKILL__ === "string";

export const GTV_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/** What hooks and MCP run. The npm build copies itself to ~/.gtv/bin, so npx's cache can be cleared. */
export const GTV_BIN = (BUNDLED ? join(CONFIG_DIR, "bin", "gtv.mjs") : join(GTV_ROOT, "bin", "gtv.mjs")).replace(/\\/g, "/");
const skillText = () => (BUNDLED ? __GTV_SKILL__! : readFileSync(join(GTV_ROOT, "src", "adapters", "skill", "SKILL.md"), "utf8"));

function ensureBin(): void {
  if (!BUNDLED) return;
  mkdirSync(dirname(GTV_BIN), { recursive: true });
  const self = fileURLToPath(import.meta.url);
  if (resolve(self) !== resolve(GTV_BIN)) copyFileSync(self, GTV_BIN);
}

/**
 * Starts the daemon in the background unless one already runs with the current config
 * (one running with another dev or server is stopped first). Returns false if it did not come up.
 */
export async function ensureDaemon(daemon = daemonUrl()): Promise<boolean> {
  const cfg = loadDaemonConfig();
  const health = () =>
    fetch(`${daemon}/health`, { signal: AbortSignal.timeout(1000) })
      .then((r) => r.json() as Promise<{ pid?: number; dev: string; server: string }>)
      .catch(() => undefined);
  const h = await health();
  if (h && h.dev === cfg.dev && h.server === cfg.server) return true;
  if (h?.pid) {
    try {
      process.kill(h.pid);
    } catch {
      return false; // someone else's daemon on this port
    }
    await new Promise((r) => setTimeout(r, 500));
  }
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

/** Replace any previous gtv entries for each event, keep everything else. */
function mergeHooks(existing: Record<string, any[]> | undefined, add: Record<string, any[]>): Record<string, any[]> {
  const out: Record<string, any[]> = { ...(existing ?? {}) };
  const isGtv = (group: any) => JSON.stringify(group).includes("gtv");
  for (const [event, groups] of Object.entries(add)) out[event] = [...(out[event] ?? []).filter((g) => !isGtv(g)), ...groups];
  return out;
}

function installSkill(dir: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), skillText());
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
  return [settingsPath, mcpPath, skill];
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
  return [hooksPath, tomlPath, skill];
}
