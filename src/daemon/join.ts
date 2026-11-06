// `gtv join <invite link>` and interactive `gtv install`: the one-command setup for a developer.

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { CONFIG_FILE, loadDaemonConfig, saveDaemonConfig } from "./config.ts";
import { ServerClient } from "./client.ts";
import { ensureDaemon, installClaude, installCodex } from "./install.ts";
import { remoteUrl, writeLink } from "./workspace.ts";
import { repoTop } from "./snapshot.ts";

const ok = (s: string) => console.log(`✔ ${s}`);
const warn = (s: string) => console.log(`! ${s}`);

async function ask(question: string, fallback: string): Promise<string> {
  if (!process.stdin.isTTY) return fallback;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`? ${question} [${fallback}]: `)).trim() || fallback;
  } finally {
    rl.close();
  }
}

/** "https://gtv.example.com/j/abc" → server "https://gtv.example.com", code "abc" (the server may sit under a path). */
export function parseInvite(link: string): { server: string; code: string } {
  const u = new URL(link);
  const m = u.pathname.match(/^(.*)\/j\/([\w-]+)\/?$/);
  if (!m) throw new Error(`not an invite link: ${link} (expected https://<server>/j/<code>)`);
  return { server: u.origin + m[1], code: m[2] };
}

export async function join(link: string): Promise<void> {
  const { server, code } = parseInvite(link);
  const res = await fetch(`${server}/v1/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(15_000),
  }).catch((e: Error) => {
    throw new Error(`cannot reach ${server}: ${e.message}`);
  });
  const json = (await res.json().catch(() => ({}))) as { dev?: string; token?: string; error?: string };
  if (!res.ok || !json.token) throw new Error(json.error ?? `${server} answered ${res.status}`);
  saveDaemonConfig({ dev: json.dev, server, token: json.token });
  ok(`Connected to ${new URL(server).host} as ${json.dev} (saved to ${CONFIG_FILE})`);
  await setupRepo(process.cwd());
}

const onPath = (cmd: string) => spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" }).status === 0;

/** Link the repo to its project, wire the chosen agents, start the daemon. */
export async function setupRepo(dir: string): Promise<void> {
  const top = await repoTop(dir);
  if (!top) {
    warn("This folder is not a git repository. In your project's folder, run: npx guide-the-vibe install");
    await startDaemon();
    return;
  }
  const cfg = loadDaemonConfig();
  const client = new ServerClient(cfg);
  const url = await remoteUrl(top, cfg.remote);
  let project = url ? (await client.call<{ id: string }>("GET", `/v1/resolve?remote=${encodeURIComponent(url)}`).catch(() => undefined))?.id : undefined;
  if (!project) {
    const projects = await client.call<{ id: string; name: string; repo_url: string }[]>("GET", "/v1/projects");
    if (!projects.length) throw new Error("the server has no projects yet: ask the admin to add this repo on the dashboard");
    console.log(`  This repo's remote (${url ?? "none"}) matches no project. Projects on the server:`);
    projects.forEach((p, i) => console.log(`    ${i + 1}) ${p.id}  ${p.repo_url}`));
    const pick = projects[Number(await ask("Which project is this repo", "1")) - 1];
    if (!pick) throw new Error("no such project");
    project = pick.id;
  }
  await writeLink(top, project);
  ok(`This repo belongs to project "${project}"`);

  const has = { claude: onPath("claude"), codex: onPath("codex") };
  const fallback = has.claude && !has.codex ? "1" : has.codex && !has.claude ? "2" : "3";
  const mark = (b: boolean) => (b ? " (installed)" : "");
  console.log(`  Agents:  1) Claude Code${mark(has.claude)}   2) Codex${mark(has.codex)}   3) both`);
  const choice = await ask("Wire gtv into which agent", fallback);
  if (choice === "1" || choice === "3") {
    installClaude(top);
    ok("Claude Code: hooks, MCP and skill added (.claude/, .mcp.json). Approve the gtv MCP server when Claude asks.");
  }
  if (choice === "2" || choice === "3") {
    installCodex(top);
    ok("Codex: hooks, MCP and skill added (.codex/). Trust the project and review the hooks with /hooks.");
  }
  await startDaemon();
  console.log("\nDone. Open Claude Code or Codex in this folder. Another repo: run `npx guide-the-vibe install` inside it.");
}

async function startDaemon(): Promise<void> {
  if (await ensureDaemon()) ok("Daemon is running in the background (agent sessions restart it if it stops)");
  else warn("The daemon did not start: run `npx guide-the-vibe daemon` in a terminal to see why (log: ~/.gtv/daemon.log)");
}
