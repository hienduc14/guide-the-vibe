// `gtv install <agent>`: wire an agent's hooks, MCP and skill into a project.

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { daemonUrl } from "./config.ts";

export const GTV_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const GTV_BIN = join(GTV_ROOT, "bin", "gtv.mjs").replace(/\\/g, "/");
const SKILL = join(GTV_ROOT, "src", "adapters", "skill", "SKILL.md");
const OMP_EXTENSION = join(GTV_ROOT, "src", "adapters", "omp", "gtv-extension.ts").replace(/\\/g, "/");

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
  copyFileSync(SKILL, join(dir, "SKILL.md"));
  return join(dir, "SKILL.md");
}

export function installClaude(project: string, daemon = daemonUrl()): string[] {
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
  toml += `${toml && !toml.endsWith("\n") ? "\n" : ""}\n[mcp_servers.gtv]\ncommand = "node"\nargs = ["${GTV_BIN}", "mcp", "--agent", "codex", "--daemon", "${daemon}"]\ntool_timeout_sec = 150\n`;
  writeFileSync(tomlPath, toml);
  const skill = installSkill(join(project, ".codex", "skills", "gtv-collaboration"));
  return [hooksPath, tomlPath, skill];
}

export function ompCommand(daemon = daemonUrl()): string {
  return process.platform === "win32"
    ? `$env:GTV_DAEMON_URL="${daemon}"; omp -e "${OMP_EXTENSION}"`
    : `GTV_DAEMON_URL=${daemon} omp -e "${OMP_EXTENSION}"`;
}
