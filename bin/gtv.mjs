#!/usr/bin/env node
// Entry point. `gtv hook <agent>` is on every agent tool call, so it is handled here in plain JS
// (no TypeScript loading). Everything else runs the TypeScript CLI (Node >= 24 strips types).

const [command, agent = "other"] = process.argv.slice(2);

if (command === "hook") {
  const i = process.argv.indexOf("--daemon");
  const daemon = i > 0 ? process.argv[i + 1] : process.env.GTV_DAEMON_URL ?? `http://127.0.0.1:${process.env.GTV_DAEMON_PORT ?? 7391}`;
  try {
    const chunks = [];
    if (!process.stdin.isTTY) for await (const c of process.stdin) chunks.push(c);
    const body = Buffer.concat(chunks).toString("utf8") || "{}";
    const res = await fetch(`${daemon}/hook/${agent}`, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(8000) });
    const text = await res.text();
    if (text) process.stdout.write(text);
  } catch {
    // fail open: never break the agent because gtv is down
  }
} else {
  await import("../src/daemon/cli.ts");
}
