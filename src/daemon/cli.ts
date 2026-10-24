// gtv command line. Heavy modules are imported lazily so hook invocations start fast.

import { loadDaemonConfig, saveDaemonConfig, daemonUrl, CONFIG_FILE } from "./config.ts";

const argv = process.argv.slice(2);
const [command, ...rest] = argv;

function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function daemon<T = any>(method: string, path: string, body?: unknown, timeoutMs = 10_000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch((flag("daemon") ?? daemonUrl()) + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
    const ct = res.headers.get("content-type") ?? "";
    return (ct.includes("json") ? await res.json() : await res.text()) as T;
  } finally {
    clearTimeout(t);
  }
}

async function server<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const { ServerClient } = await import("./client.ts");
  return new ServerClient(loadDaemonConfig()).call<T>(method, path, body, 60_000);
}

/** Project of the current repo: --project, the .git/gtv-project link, or the server's match of the remote. */
async function project(): Promise<string> {
  const explicit = flag("project");
  if (explicit) return explicit;
  const { readLink, remoteUrl } = await import("./workspace.ts");
  const { repoTop } = await import("./snapshot.ts");
  const top = await repoTop(process.cwd());
  if (top) {
    const linked = await readLink(top);
    if (linked) return linked;
    const url = await remoteUrl(top, loadDaemonConfig().remote);
    if (url) {
      const p = await server<{ id: string }>("GET", `/v1/resolve?remote=${encodeURIComponent(url)}`).catch(() => undefined);
      if (p) return p.id;
    }
  }
  throw new Error("cannot tell which project this is: run inside a linked repo, use --project <id>, or gtv link <id>");
}

const inProject = async (path: string) => `/v1/p/${await project()}${path}`;

const HELP = `gtv — Project Operator client

Setup
  gtv init --dev <name> --server <url> [--token <t>] [--port 7391]
  gtv daemon                         run the local daemon (keep it open)
  gtv install claude|codex [dir] [--daemon <url>]   wire hooks + MCP + skill into a project (default: cwd;
                                     --daemon when several daemons share a machine)
  gtv install omp [--daemon <url>]   print how to start omp with the gtv extension

Projects (one per repo)
  gtv projects                       list projects on the server
  gtv link <project> [dir]           tie a working copy to a project (otherwise matched by its remote URL)
  gtv project add <id> --repo <url> [--branch main] [--name <name>]   create a project (needs GTV_ADMIN_TOKEN)

Daily use (inside a linked repo, or pass --project <id>)
  gtv status                         who is doing what, open conflicts
  gtv inbox                          questions waiting for you (human decisions)
  gtv answer <ticket> "<text>"       answer a question as a human
  gtv ack|dismiss <conflict>         acknowledge / dismiss a conflict
  gtv kb search "<q>" | gtv kb confirm <id> | gtv kb add <title> <file>
  gtv features [set <feature> on|shadow|off|default]
  gtv snapshot                       push a WIP snapshot now

Used by agents
  gtv hook <agent> [--daemon <url>]  hook entry point (reads JSON on stdin)
  gtv hook-wait <agent> [--daemon <url>]   Claude asyncRewake waiter
  gtv mcp [--agent auto|claude|codex] [--daemon <url>]   stdio MCP server
  gtv statusline [--daemon <url>]    one-line status for agent status bars

Environment: GTV_HOME (config dir, default ~/.gtv), GTV_SERVER, GTV_TOKEN, GTV_DEV, GTV_DAEMON_PORT
`;

async function main(): Promise<void> {
  switch (command) {
    case "hook": {
      // Must never break the agent: any failure prints nothing and exits 0.
      const agent = rest[0] ?? "other";
      try {
        const input = await readStdin();
        const out = await daemon("POST", `/hook/${agent}`, input ? JSON.parse(input) : {}, 8000);
        if (out && typeof out === "object") process.stdout.write(JSON.stringify(out));
      } catch {
        // fail open
      }
      return;
    }
    case "hook-wait": {
      const agent = rest[0] ?? "claude";
      try {
        const input = JSON.parse((await readStdin()) || "{}");
        const res = await daemon<{ text: string | null }>("GET", `/wait?agent=${agent}&session=${encodeURIComponent(input.session_id ?? "")}&timeout=${30 * 60_000}`, undefined, 31 * 60_000);
        if (res?.text) {
          process.stderr.write(res.text);
          process.exit(2); // asyncRewake: wake the agent with stderr as a system reminder
        }
      } catch {
        // ignore
      }
      return;
    }
    case "statusline": {
      try {
        const input = await readStdin();
        const cwd = (input && (JSON.parse(input).workspace?.current_dir ?? JSON.parse(input).cwd)) || process.cwd();
        process.stdout.write(await daemon<string>("GET", `/statusline?cwd=${encodeURIComponent(cwd)}`, undefined, 1500));
      } catch {
        process.stdout.write("gtv ○ daemon off");
      }
      return;
    }
    case "mcp": {
      const { runMcp } = await import("./mcp.ts");
      await runMcp(flag("agent"), flag("daemon"));
      return;
    }
    case "daemon": {
      const { Daemon } = await import("./daemon.ts");
      const d = new Daemon(loadDaemonConfig());
      await d.start();
      process.on("SIGINT", () => void d.stop().then(() => process.exit(0)));
      return;
    }
    case "init": {
      const cfg = saveDaemonConfig({ dev: flag("dev"), server: flag("server"), token: flag("token"), port: flag("port") ? Number(flag("port")) : undefined });
      console.log(`Saved ${CONFIG_FILE}: dev=${cfg.dev} server=${cfg.server} port=${cfg.port}`);
      return;
    }
    case "install": {
      const { installClaude, installCodex, ompCommand } = await import("./install.ts");
      const dir = rest[1] && !rest[1].startsWith("--") ? rest[1] : process.cwd();
      const d = flag("daemon");
      if (rest[0] === "claude") console.log("Wrote:\n  " + installClaude(dir, d).join("\n  ") + "\nRestart Claude Code in this project and approve the gtv MCP server.");
      else if (rest[0] === "codex") console.log("Wrote:\n  " + installCodex(dir, d).join("\n  ") + "\nIn Codex, trust the project and review the hooks with /hooks.");
      else if (rest[0] === "omp") console.log(`Start omp with the gtv extension:\n  ${ompCommand(d)}`);
      else console.log("usage: gtv install claude|codex|omp [project-dir]");
      return;
    }
    case "status": {
      try {
        console.log(await daemon<string>("GET", `/status?cwd=${encodeURIComponent(process.cwd())}`));
      } catch {
        const s = await server("GET", await inProject("/state"));
        console.log(JSON.stringify(s, null, 2));
      }
      return;
    }
    case "inbox": {
      const tickets = await server<any[]>("GET", await inProject("/tickets?scope=for_me"));
      if (!tickets.length) console.log("No questions waiting for you.");
      for (const t of tickets) console.log(`${t.id} [${t.status}] from ${t.from_dev}: ${t.forwarded_question ?? t.question}`);
      return;
    }
    case "answer": {
      const [id, ...words] = rest;
      const t = await server("POST", await inProject(`/tickets/${id}/reply`), { answer: words.join(" ") });
      console.log(`Answered ${t.id}; it will be delivered to ${t.from_dev}'s agent.`);
      return;
    }
    case "ack":
    case "dismiss": {
      const c = await server("POST", await inProject(`/conflicts/${rest[0]}/${command}`), {});
      console.log(`${c.id} → ${c.status}`);
      return;
    }
    case "kb": {
      const [sub, ...args] = rest;
      if (sub === "search") for (const h of await server<any[]>("GET", await inProject(`/kb?q=${encodeURIComponent(args.join(" "))}`))) console.log(`${h.id} [${h.type}/${h.status}] ${h.section}\n  ${h.snippet}`);
      else if (sub === "confirm" || sub === "reject") console.log(await server("POST", await inProject(`/kb/${args[0]}/${sub}`), {}));
      else if (sub === "add") {
        const { readFileSync } = await import("node:fs");
        console.log(await server("POST", await inProject("/kb"), { title: args[0], body: readFileSync(args[1], "utf8") }));
      } else for (const d of await server<any[]>("GET", await inProject("/kb"))) console.log(`${d.id} [${d.type}/${d.status}] ${d.title}`);
      return;
    }
    case "features": {
      if (rest[0] === "set") {
        const mode = rest[2] === "default" ? null : rest[2];
        await server("PUT", await inProject("/features"), { feature: rest[1], mode });
      }
      const f = await server("GET", await inProject("/features"));
      for (const [k, v] of Object.entries(f.modes)) console.log(`${k.padEnd(30)} ${v}${f.tripped[k] ? `  (tripped: ${f.tripped[k]})` : ""}`);
      return;
    }
    case "snapshot":
      console.log(await daemon("POST", "/snapshot", { cwd: process.cwd() }));
      return;
    case "link": {
      const { writeLink } = await import("./workspace.ts");
      if (!rest[0]) throw new Error("usage: gtv link <project> [dir]");
      const dir = rest[1] && !rest[1].startsWith("--") ? rest[1] : process.cwd();
      console.log(`Linked ${dir} to project ${rest[0]} (${await writeLink(dir, rest[0])})`);
      return;
    }
    case "projects":
      for (const p of await server<any[]>("GET", "/v1/projects")) console.log(`${p.id.padEnd(20)} ${p.main_branch.padEnd(10)} ${p.repo_url}`);
      return;
    case "project": {
      // Admin: gtv project add <id> --repo <url> [--branch main] [--name "Nice name"] (uses GTV_ADMIN_TOKEN or open mode)
      if (rest[0] !== "add" || !rest[1]) throw new Error("usage: gtv project add <id> --repo <url> [--branch main] [--name <name>]");
      const cfg = loadDaemonConfig();
      const res = await fetch(`${cfg.server}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(process.env.GTV_ADMIN_TOKEN ? { authorization: `Bearer ${process.env.GTV_ADMIN_TOKEN}` } : {}) },
        body: JSON.stringify({ id: rest[1], repo_url: flag("repo"), main_branch: flag("branch") ?? "main", name: flag("name") ?? rest[1] }),
      });
      const json = (await res.json()) as { error?: string; id?: string };
      if (!res.ok) throw new Error(json.error);
      console.log(`Created project ${json.id}`);
      return;
    }
    default:
      console.log(HELP);
  }
}

await main();
