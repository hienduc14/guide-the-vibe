// gtv command line. Heavy modules are imported lazily so hook invocations start fast.
// Person-facing commands live in setup.ts; hook, hook-wait, mcp, statusline, daemon and link are for agents and
// scripts and stay out of the help.

import { loadDaemonConfig, daemonUrl, CONFIG_FILE } from "./config.ts";
import { GTV_VERSION } from "./install.ts";

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
    const res = await fetch((flag("daemon") ?? daemonUrl()) + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const ct = res.headers.get("content-type") ?? "";
    return (ct.includes("json") ? await res.json() : await res.text()) as T;
  } finally {
    clearTimeout(t);
  }
}

const HELP = `gtv — your AI coding agents, coordinated with your team (gtv ${GTV_VERSION})

  gtv login [server]   Connect this computer to your account.
  gtv on               Set up gtv for this repo (hooks, MCP server, skill) and start the background service.
  gtv off              Remove gtv from this repo.
  gtv status           Who you are, this computer, the background service; inside a repo: project, your role,
                       your tasks, what waits for you.
  gtv doctor           Check everything and fix what it can.
  gtv open             Open this repo's project in the browser.
  gtv answer <id> "…"  Answer a question that waits for you.
  gtv logout           Disconnect this computer (revokes its key, stops the background service).
  gtv daemon start|stop|restart|status
  gtv help | --version

Guide: https://github.com/hienduc14/guide-the-vibe/blob/main/docs/cli.md
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
      // Headless Claude (claude -p, SDK) has nobody to wake, and it would wait for this waiter (up to 30 min)
      // before exiting. Messages stay in the inbox and arrive with the next hook.
      if (process.env.CLAUDE_CODE_SESSION_ATTENDED === "0") return;
      try {
        const input = JSON.parse((await readStdin()) || "{}");
        const res = await daemon<{ text: string | null }>(
          "GET",
          `/wait?agent=${agent}&session=${encodeURIComponent(input.session_id ?? "")}&timeout=${30 * 60_000}`,
          undefined,
          31 * 60_000,
        );
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
      const sub = rest[0];
      if (sub === "start" || sub === "stop" || sub === "restart" || sub === "status") {
        const { daemonHealth, ensureDaemon, stopDaemon } = await import("./install.ts");
        const url = flag("daemon") ?? daemonUrl();
        if (sub === "stop" || sub === "restart") {
          if (!(await stopDaemon(url))) throw new Error(`Could not stop the background service on ${url} (started by another user?)`);
          if (sub === "stop") return console.log("✔ Background service stopped");
        }
        if (sub !== "status") {
          if (!(await ensureDaemon(url)))
            throw new Error(`The background service did not start. See why: gtv daemon (log: ${CONFIG_FILE.replace(/config\.json$/, "daemon.log")})`);
        }
        const h = await daemonHealth(url);
        if (!h) return console.log(`No background service on ${url}. Start it: gtv daemon start`);
        console.log(`Background service running on ${url} (pid ${h.pid ?? "?"}) as ${h.dev}`);
        console.log(`  server   ${h.server} ${h.reachable ? "(reachable)" : "(UNREACHABLE)"}`);
        const projects = Object.entries(h.projects ?? {});
        console.log(
          `  projects ${projects.length ? projects.map(([id, ok]) => `${id}${ok ? "" : " (disconnected)"}`).join(", ") : "none yet (connects when an agent session starts in a repo with gtv on)"}`,
        );
        console.log(`  sessions ${h.sessions}`);
        return;
      }
      const { Daemon } = await import("./daemon.ts");
      const d = new Daemon(loadDaemonConfig());
      await d.start();
      process.on("SIGINT", () => void d.stop().then(() => process.exit(0)));
      return;
    }
    case "login":
      return (await import("./setup.ts")).login(rest[0]);
    case "on":
      return (await import("./setup.ts")).on();
    case "install": {
      // `install claude|codex [dir] [--daemon <url>]`: wire one agent by hand (scripts, sandboxes); otherwise `on`.
      if (rest[0] !== "claude" && rest[0] !== "codex") return (await import("./setup.ts")).on();
      const { installClaude, installCodex } = await import("./install.ts");
      const dir = rest[1] && !rest[1].startsWith("--") ? rest[1] : process.cwd();
      const written = (rest[0] === "claude" ? installClaude : installCodex)(dir, flag("daemon"));
      console.log("Wrote:\n  " + written.join("\n  "));
      return;
    }
    case "off":
      return (await import("./setup.ts")).off();
    case "status":
      return (await import("./setup.ts")).status();
    case "doctor":
      return (await import("./setup.ts")).doctor();
    case "open":
      return (await import("./setup.ts")).open();
    case "answer":
      return (await import("./setup.ts")).answer(rest[0], rest.slice(1).join(" "));
    case "logout":
      return (await import("./setup.ts")).logout();
    case "join":
      throw new Error("Invite links are gone. Run: gtv login");
    case "link": {
      const { writeLink } = await import("./workspace.ts");
      if (!rest[0]) throw new Error("Usage: gtv link <project id> [dir]");
      const dir = rest[1] && !rest[1].startsWith("--") ? rest[1] : process.cwd();
      console.log(`✔ Linked ${dir} to project ${rest[0]} (${await writeLink(dir, rest[0])}). Now run: gtv on`);
      return;
    }
    case "--version":
    case "-v":
    case "version":
      console.log(GTV_VERSION);
      return;
    case undefined: {
      // `npx guide-the-vibe` with nothing after it installs (or updates) the gtv command; `gtv` alone shows help.
      const { install, isInstalledCopy } = { ...(await import("./setup.ts")), ...(await import("./install.ts")) };
      if (!isInstalledCopy()) return install();
      console.log(HELP);
      return;
    }
    default:
      if (command !== "help" && command !== "--help" && command !== "-h") console.log(`Unknown command: ${command}\n`);
      console.log(HELP);
  }
}

await main().catch((e: Error) => {
  console.error(`✘ ${e.message}`);
  process.exit(1);
});
