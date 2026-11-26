// The person-facing commands: gtv login / on / off / status / doctor / open / answer / logout, and installing the
// gtv command (npx guide-the-vibe). Everything printed is English, short, and every error names a command that fixes it.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { CONFIG_DIR, daemonUrl, loadDaemonConfig, loadRepos, saveDaemonConfig, saveRepos, savedServer, type DaemonConfig } from "./config.ts";
import { ServerClient } from "./client.ts";
import {
  GTV_VERSION,
  daemonHealth,
  ensureDaemon,
  installClaude,
  installCodex,
  installSelf,
  onPath,
  setupState,
  stopDaemon,
  uninstallClaude,
  uninstallCodex,
} from "./install.ts";
import { readLink, remoteUrl, removeLink, writeLink } from "./workspace.ts";
import { repoTop } from "./snapshot.ts";
import { git, repoKey } from "../shared/util.ts";

const ok = (s: string) => console.log(`✔ ${s}`);
const warn = (s: string) => console.log(`! ${s}`);
const bad = (s: string) => console.log(`✘ ${s}`);
const tilde = (p: string) => p.replace(homedir(), "~");
const hostOf = (server: string) => server.replace(/^https?:\/\//, "");

/** A failure the person can fix; the CLI prints it as "✘ <message>" and exits 1. */
export class CliError extends Error {}

// ---- prompts -------------------------------------------------------------------------------------

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`? ${question}`)).trim();
  } finally {
    rl.close();
  }
}

/** Yes/no with yes as the default; scripts (no terminal) get the default. */
async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return true;
  return !/^n/i.test(await prompt(`${question} (Y/n) `));
}

function openBrowser(url: string): void {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args as string[], { detached: true, stdio: "ignore" });
    child.on("error", () => undefined); // no browser here: the URL is printed anyway
    child.unref();
  } catch {
    // ignore
  }
}

// ---- pure helpers (tested in test/cli.test.ts) ---------------------------------------------------------

/** What to try for a server the person typed: with or without https://, trailing slashes dropped; http only locally. */
export function serverCandidates(input: string): string[] {
  const s = input.trim().replace(/\/+$/, "");
  if (!s) return [];
  if (/^https?:\/\//i.test(s)) return [s];
  const host = s.split("/")[0].replace(/:\d+$/, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" ? [`https://${s}`, `http://${s}`] : [`https://${s}`];
}

export interface MyProject {
  id: string;
  name: string;
  access: "manager" | "developer" | "viewer";
  repos: string[];
}

/** The project a repo belongs to among mine: its `gtv link` first, else its remote matched by repoKey(). */
export function matchProject(projects: MyProject[], linked: string | undefined, remote: string | undefined): MyProject | undefined {
  if (linked) return projects.find((p) => p.id === linked);
  if (!remote) return undefined;
  const key = repoKey(remote);
  return projects.find((p) => p.repos.includes(key));
}

/** What `gtv on` keeps out of git, in .git/info/exclude. */
export const EXCLUDED = [".mcp.json", ".claude/settings.local.json", ".claude/skills/gtv/", ".claude/skills/gtv-*/", ".codex/"];
const BLOCK_START = "# gtv (managed)";
const BLOCK_END = "# end gtv";

/** The exclude file without gtv's block. */
export function withoutExcludeBlock(text: string): string {
  const a = text.indexOf(`${BLOCK_START}\n`);
  const b = a < 0 ? -1 : text.indexOf(BLOCK_END, a);
  if (b < 0) return text;
  return text.slice(0, a) + text.slice(b + BLOCK_END.length).replace(/^\n/, "");
}

/** The exclude file with gtv's block holding exactly these paths (replacing an earlier block). */
export function withExcludeBlock(text: string, paths: string[]): string {
  const rest = withoutExcludeBlock(text);
  if (!paths.length) return rest;
  const block = `${BLOCK_START}\n${paths.join("\n")}\n${BLOCK_END}\n`;
  return rest ? `${rest.replace(/\n*$/, "\n")}${block}` : block;
}

// ---- server calls -------------------------------------------------------------------------------------

interface Me {
  user: string;
  device: { id: string; name: string } | null;
  projects: MyProject[];
}

function needLogin(cfg = loadDaemonConfig()): DaemonConfig {
  if (!cfg.token) throw new CliError("Not logged in. Run: gtv login");
  return cfg;
}

async function getMe(cfg: DaemonConfig): Promise<Me> {
  try {
    return await new ServerClient(cfg).call<Me>("GET", "/v1/me");
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 401) throw new CliError("This computer's key is no longer valid (revoked, or the account was deleted). Run: gtv login");
    throw new CliError(`Cannot reach ${cfg.server} (${err.message}). Check your network, or run: gtv doctor`);
  }
}

async function findServer(candidates: string[]): Promise<string | undefined> {
  for (const c of candidates) {
    const okHealth = await fetch(`${c}/health`, { signal: AbortSignal.timeout(6000) })
      .then((r) => r.json() as Promise<{ ok?: boolean }>)
      .then((j) => !!j?.ok)
      .catch(() => false);
    if (okHealth) return c;
  }
  return undefined;
}

/** The project of the repo at `top`, among the projects I can see; throws a fixable error otherwise. */
async function projectOf(cfg: DaemonConfig, me: Me, top: string): Promise<MyProject> {
  const linked = await readLink(top);
  const remote = await remoteUrl(top, cfg.remote);
  const mine = matchProject(me.projects, linked, remote);
  if (mine) return mine;
  // Not among mine: does it belong to a project I am not a member of?
  const client = new ServerClient(cfg);
  const other = linked
    ? ((await client.call<{ id: string; name: string }[]>("GET", "/v1/projects").catch(() => [])).find((p) => p.id === linked) ?? { id: linked, name: linked })
    : remote
      ? await client.call<{ id: string; name: string }>("GET", `/v1/resolve?remote=${encodeURIComponent(remote)}`).catch(() => undefined)
      : undefined;
  if (other) throw new CliError(`You are not a member of project ${other.name}. Ask a project manager to add you.`);
  throw new CliError(
    `This repo is not part of any project on ${hostOf(cfg.server)}.\n  Its remote is ${remote ?? "(none)"}: check it with git remote -v. ` +
      "A fork of a project's repo? Link it by hand: gtv link <project>",
  );
}

const accessWords = { manager: "a manager", developer: "a developer", viewer: "a viewer" } as const;
const viewerError = (p: MyProject) => new CliError(`You are a viewer in project ${p.name}; agents need developer access. Ask a project manager to change it.`);

// ---- npx guide-the-vibe ---------------------------------------------------------------------------

export function install(): void {
  const r = installSelf();
  ok(`Installed gtv ${GTV_VERSION} → ${tilde(r.bin)}`);
  if (/^Added|on your PATH$/.test(r.path)) ok(r.path);
  else warn(r.path);
  console.log("\nNext: gtv login");
}

// ---- gtv login ----------------------------------------------------------------------------------------

export async function login(arg?: string): Promise<void> {
  let input = arg;
  if (!input) {
    if (!process.stdin.isTTY) throw new CliError("Pass the server: gtv login <url>");
    const prev = savedServer();
    input = (await prompt(`Your gtv server${prev ? ` (${hostOf(prev)})` : ""}: `)) || prev || "";
    if (!input) throw new CliError("No server given. Run: gtv login <url>");
  }
  const candidates = serverCandidates(input);
  const server = await findServer(candidates);
  if (!server) throw new CliError(`No gtv server at ${candidates[0] ?? input}. Check the address, then run: gtv login <url>`);
  ok(`Found gtv at ${hostOf(server)}`);

  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const res = await fetch(server + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new CliError(json.error ?? `${server} answered ${res.status}`);
    return json;
  };
  const start = await post<{ device_code: string; user_code: string; interval: number; expires_at: string }>("/v1/connect/start", {
    device_name: hostname(),
    platform: process.platform,
  });
  const url = `${server}/connect?code=${start.user_code}`;
  console.log(`\nOpen this page to approve this computer:\n  ${url}\nCode: ${start.user_code}\n`);
  openBrowser(url);
  console.log("Waiting for approval… (Ctrl+C to cancel)");
  let got: { user: string; token: string; device_id: string } | undefined;
  while (!got) {
    await new Promise((r) => setTimeout(r, (start.interval || 2) * 1000));
    try {
      const r = await post<{ status: string; user: string; token: string; device_id: string }>("/v1/connect/poll", { device_code: start.device_code });
      if (r.status === "approved") got = r;
    } catch (e) {
      const msg = (e as Error).message;
      if (/denied/.test(msg)) throw new CliError("The request was denied on the dashboard. Run gtv login to try again.");
      if (/expired|unknown/.test(msg)) throw new CliError("The code expired before it was approved. Run: gtv login");
      if (e instanceof CliError) throw e;
      // network hiccup: keep waiting
    }
  }
  const previous = loadDaemonConfig();
  const cfg = saveDaemonConfig({ server, dev: got.user, token: got.token, device_id: got.device_id });
  ok(`This computer (${hostname()}) is connected as ${got.user}`);
  // A daemon running for another account or server picks up the new key.
  if (await daemonHealth(daemonUrl(cfg))) {
    if (await ensureDaemon())
      ok(previous.dev !== got.user || previous.server !== server ? "Background service restarted for this account" : "Background service running");
  }

  const top = await repoTop(process.cwd());
  if (top) {
    const me = await getMe(cfg).catch(() => undefined);
    const p = me && matchProject(me.projects, await readLink(top), await remoteUrl(top, cfg.remote));
    if (p && p.access !== "viewer" && (await confirm(`Set up this repo too (${p.name})?`))) {
      console.log("");
      await on(top);
      return;
    }
  }
  console.log("\nNext: in a project repo, run  gtv on");
}

// ---- gtv on / off --------------------------------------------------------------------------------------

/** Agents found on this computer. */
function detectAgents(): { claude: boolean; codex: boolean } {
  return {
    claude: onPath("claude") || existsSync(`${homedir()}/.claude`),
    codex: onPath("codex") || existsSync(`${homedir()}/.codex`),
  };
}

async function excludeFile(top: string): Promise<string> {
  const r = await git(top, ["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"]);
  return r.stdout.trim();
}

async function tracked(top: string, path: string): Promise<boolean> {
  const r = await git(top, ["ls-files", "--", path.replace(/\/$/, "")], { allowFail: true });
  return !!r.stdout.trim();
}

function upsertRepo(path: string, project: string | undefined): void {
  const repos = loadRepos().filter((r) => r.path !== path);
  saveRepos(project ? [...repos, { path, project }] : repos);
}

export async function on(dir = process.cwd()): Promise<void> {
  const cfg = needLogin();
  const top = await repoTop(dir);
  if (!top) throw new CliError("Not a git repository. Run gtv on inside your project's folder.");
  const me = await getMe(cfg);
  const p = await projectOf(cfg, me, top);
  if (p.access === "viewer") throw viewerError(p);
  ok(`This repo belongs to ${p.name} (you are ${accessWords[p.access]})`);

  const found = detectAgents();
  const names = [found.claude && "Claude Code", found.codex && "Codex"].filter(Boolean) as string[];
  let pick = { claude: true, codex: true };
  if (names.length === 2) {
    if (!(await confirm("Agents on this computer: Claude Code, Codex. Set up both?")))
      pick = { claude: await confirm("Set up Claude Code?"), codex: await confirm("Set up Codex?") };
  } else if (names.length === 1) {
    pick = { claude: found.claude, codex: found.codex };
    if (!(await confirm(`Agent on this computer: ${names[0]}. Set it up?`))) pick = { claude: false, codex: false };
  } else console.log("  No Claude Code or Codex found on this computer: setting up both, ready for when you install one.");

  const daemon = daemonUrl(cfg);
  if (pick.claude) {
    installClaude(top, daemon);
    ok("Claude Code: hooks, MCP server, skill");
  }
  if (pick.codex) {
    installCodex(top, daemon);
    ok("Codex: hooks, MCP server, skill");
  }
  await writeLink(top, p.id);

  // Keep gtv's files out of commits; a file the repo already tracks stays visible (and is said so).
  const keep: string[] = [];
  for (const path of EXCLUDED) {
    if (await tracked(top, path)) warn(`${path} is tracked by git, so gtv's entries in it will show in git status`);
    else keep.push(path);
  }
  const exclude = await excludeFile(top);
  const before = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
  writeFileSync(exclude, withExcludeBlock(before, keep));
  ok("Kept out of git (.git/info/exclude)");

  upsertRepo(top, p.id);
  if (await ensureDaemon(daemon)) ok("Background service running");
  else warn(`The background service did not start. See why: gtv daemon (log: ${tilde(CONFIG_DIR)}/daemon.log)`);
  console.log("\nDone. Start a new agent session and gtv takes it from there.");
}

export async function off(dir = process.cwd()): Promise<void> {
  const top = await repoTop(dir);
  if (!top) throw new CliError("Not a git repository. Run gtv off inside the repo to clean up.");
  const removed = [...uninstallClaude(top), ...uninstallCodex(top)].map((p) => p.replace(`${top}/`, "").replace(top, "."));
  const exclude = await excludeFile(top);
  if (existsSync(exclude)) {
    const before = readFileSync(exclude, "utf8");
    const after = withoutExcludeBlock(before);
    if (after !== before) {
      writeFileSync(exclude, after);
      removed.push(".git/info/exclude (gtv block)");
    }
  }
  if (await removeLink(top)) removed.push(".git/gtv-project (project link)");
  if (loadRepos().some((r) => r.path === top)) {
    upsertRepo(top, undefined);
    removed.push(`${tilde(CONFIG_DIR)}/repos.json (this repo)`);
  }
  if (!removed.length) return console.log("Nothing of gtv's is set up in this repo.");
  for (const r of removed) ok(`Removed ${r}`);
  console.log("\ngtv is off in this repo. Turn it back on with: gtv on");
}

// ---- gtv status / doctor ---------------------------------------------------------------------------

export async function status(): Promise<void> {
  const cfg = loadDaemonConfig();
  if (!cfg.token) return console.log("Not logged in. Run: gtv login");
  const health = await daemonHealth(daemonUrl(cfg));
  const me = await getMe(cfg).catch((e: Error) => e);
  const computer = me instanceof Error ? hostname() : (me.device?.name ?? hostname());
  console.log(
    `${cfg.dev} @ ${hostOf(cfg.server)} · computer ${computer} · background service ${health ? `running (port ${cfg.port})` : "stopped (start it: gtv daemon start)"}`,
  );
  if (me instanceof Error) return bad(me.message);
  const top = await repoTop(process.cwd());
  const repos = loadRepos();
  const here = top ? repos.find((r) => r.path === top) : undefined;
  if (!here) {
    if (top) console.log("\nThis repo is not set up. Run: gtv on");
    if (!repos.length) return console.log(top ? "" : "\nNo repo set up yet. In a project repo, run: gtv on");
    console.log("\nRepos with gtv on:");
    for (const r of repos) {
      const p = me.projects.find((x) => x.id === r.project);
      console.log(`  ${tilde(r.path)}  ${p ? `${p.name} (${p.access})` : `${r.project} (not a member any more)`}`);
    }
    return;
  }
  const p = me.projects.find((x) => x.id === here.project);
  if (!p) return bad(`You are not a member of project ${here.project} any more. Ask a project manager to add you.`);
  console.log(`${p.name} (${p.access})`);
  const client = new ServerClient(cfg);
  const base = `/v1/p/${encodeURIComponent(p.id)}`;
  const [tasks, questions, incidents] = await Promise.all([
    client.call<{ id: string; title: string; status: string; priority: string }[]>("GET", `${base}/board?scope=mine`).catch(() => []),
    client.call<{ id: string; from_dev: string; question: string; forwarded_question?: string }[]>("GET", `${base}/tickets?scope=for_me`).catch(() => []),
    client
      .call<{ id: string; dev_a: string; dev_b: string; status: string; files: string[] }[]>("GET", `${base}/incidents`)
      .then((all) => all.filter((i) => i.status === "open" && (i.dev_a === cfg.dev || i.dev_b === cfg.dev)))
      .catch(() => []),
  ]);
  console.log("\nYour tasks");
  if (!tasks.length) console.log("  none assigned to you");
  for (const t of tasks)
    console.log(`  ${t.status.replace("_", " ").padEnd(11)} ${t.title}${t.priority === "urgent" || t.priority === "high" ? ` (${t.priority})` : ""}`);
  console.log("\nWaiting for you");
  if (!questions.length && !incidents.length) console.log("  nothing");
  for (const q of questions) console.log(`  question ${q.id} from ${q.from_dev}: ${(q.forwarded_question ?? q.question).slice(0, 120)}`);
  for (const i of incidents)
    console.log(`  clash with ${i.dev_a === cfg.dev ? i.dev_b : i.dev_a}${i.files.length ? ` in ${i.files.slice(0, 3).join(", ")}` : ""}`);
  if (questions.length) console.log(`\nAnswer: gtv answer ${questions[0].id} "<your answer>"`);
  if (incidents.length || questions.length) console.log("See it all: gtv open");
}

export async function doctor(): Promise<void> {
  const cfg = loadDaemonConfig();
  let problems = 0;
  const fail = (s: string) => (problems++, bad(s));
  if (!cfg.token) return fail("Not logged in. Run: gtv login");
  const reachable = await fetch(`${cfg.server}/health`, { signal: AbortSignal.timeout(6000) })
    .then((r) => r.ok)
    .catch(() => false);
  if (!reachable) return fail(`Cannot reach ${cfg.server}. Check your network; if the server moved, run: gtv login <new url>`);
  ok(`Server ${hostOf(cfg.server)} reachable`);
  let me: Me;
  try {
    me = await getMe(cfg);
  } catch (e) {
    return fail((e as Error).message);
  }
  ok(`Logged in as ${me.user}${me.device ? ` (computer ${me.device.name})` : ""}`);

  const daemon = daemonUrl(cfg);
  const h = await daemonHealth(daemon);
  if (h && h.dev === cfg.dev && h.server === cfg.server) ok(`Background service running (port ${cfg.port})`);
  else if (await ensureDaemon(daemon)) warn(h ? "Background service was running for another account: restarted" : "Background service was stopped: started");
  else fail(`The background service does not start. See why: gtv daemon (log: ${tilde(CONFIG_DIR)}/daemon.log)`);

  const agents = detectAgents();
  const repos = loadRepos();
  for (const r of repos) {
    const name = tilde(r.path);
    if (!existsSync(r.path)) {
      upsertRepo(r.path, undefined);
      warn(`${name} no longer exists: removed from the list`);
      continue;
    }
    const p = me.projects.find((x) => x.id === r.project);
    if (!p) fail(`${name}: you are not a member of project ${r.project} any more. Ask a project manager to add you.`);
    else if (p.access === "viewer") fail(`${name}: ${viewerError(p).message}`);
    for (const agent of ["claude", "codex"] as const) {
      const label = agent === "claude" ? "Claude Code" : "Codex";
      const state = setupState(r.path, agent, daemon);
      if (state === "stale") {
        (agent === "claude" ? installClaude : installCodex)(r.path, daemon);
        warn(`${name}: ${label} setup was outdated or duplicated: reinstalled`);
      } else if (state === "missing" && agents[agent]) fail(`${name}: ${label} is on this computer but not set up here. Run gtv on in that repo`);
      else if (state === "ok") ok(`${name}: ${label} set up`);
    }
  }
  if (!repos.length) console.log("  No repo set up yet. In a project repo, run: gtv on");
  console.log(problems ? `\n${problems} thing(s) need you (see ✘ above).` : "\nAll good.");
  if (problems) process.exitCode = 1;
}

// ---- gtv open / answer / logout ------------------------------------------------------------------------

export async function open(): Promise<void> {
  const cfg = needLogin();
  const top = await repoTop(process.cwd());
  let url = cfg.server;
  if (top) {
    const p = await projectOf(cfg, await getMe(cfg), top);
    url = `${cfg.server}/p/${encodeURIComponent(p.id)}`;
  }
  console.log(url);
  openBrowser(url);
}

export async function answer(ticket: string | undefined, text: string): Promise<void> {
  if (!ticket || !text.trim()) throw new CliError('Usage: gtv answer <question id> "<your answer>" (ids are in gtv status)');
  const cfg = needLogin();
  const me = await getMe(cfg);
  const top = await repoTop(process.cwd());
  const client = new ServerClient(cfg);
  // The question's project: this repo's, else whichever of mine has it.
  const candidates = top ? [await projectOf(cfg, me, top)] : me.projects;
  for (const p of candidates) {
    const base = `/v1/p/${encodeURIComponent(p.id)}`;
    const t = await client.call<{ id?: string }>("GET", `${base}/tickets/${encodeURIComponent(ticket)}`).catch(() => undefined);
    if (!t?.id) continue;
    const res = await client.call<{ from_dev: string }>("POST", `${base}/tickets/${encodeURIComponent(ticket)}/reply`, { answer: text.trim() });
    return ok(`Answered ${ticket}: it goes to ${res.from_dev}'s agent`);
  }
  throw new CliError(`No question ${ticket} in your projects. See the ids with: gtv status`);
}

export async function logout(): Promise<void> {
  const cfg = loadDaemonConfig();
  if (!cfg.token) return console.log("This computer is not logged in.");
  await new ServerClient(cfg).call("POST", "/v1/me/logout").catch(() => undefined); // revoked or offline: forget it anyway
  if ((await daemonHealth(daemonUrl(cfg))) && (await stopDaemon(daemonUrl(cfg)))) ok("Background service stopped");
  saveDaemonConfig({ token: null, device_id: null });
  ok(`This computer is disconnected from ${hostOf(cfg.server)}`);
  console.log("Repos keep their setup; run gtv off in a repo to remove it.");
}
