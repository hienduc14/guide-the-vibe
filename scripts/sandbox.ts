// Create a local playground: sandbox/origin.git (the "GitHub" repo, seeded from examples/sample-repo)
// and one clone per developer, each wired to its own daemon:
//   alice → Claude Code (port 7391), bob → Codex (7392)
// Usage: node scripts/sandbox.ts [--reset]

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { git } from "../src/shared/util.ts";
import { installClaude, installCodex, GTV_ROOT } from "../src/daemon/install.ts";
import { writeLink } from "../src/daemon/workspace.ts";

const PROJECT = "mini-shop";

const SANDBOX = resolve(GTV_ROOT, "sandbox");
const ORIGIN = join(SANDBOX, "origin.git");
const DEVS = [
  { dev: "alice", agent: "claude", port: 7391 },
  { dev: "bob", agent: "codex", port: 7392 },
] as const;

if (process.argv.includes("--reset")) rmSync(SANDBOX, { recursive: true, force: true });
if (existsSync(ORIGIN)) {
  console.log(`${ORIGIN} already exists (use --reset to recreate).`);
} else {
  mkdirSync(SANDBOX, { recursive: true });
  await git(SANDBOX, ["init", "--bare", "-q", "-b", "main", ORIGIN]);
  const seed = join(SANDBOX, ".seed");
  cpSync(join(GTV_ROOT, "examples", "sample-repo"), seed, { recursive: true });
  await git(seed, ["init", "-q", "-b", "main"]);
  await git(seed, ["add", "-A"]);
  await git(seed, ["-c", "user.name=gtv", "-c", "user.email=gtv@localhost", "commit", "-q", "-m", "mini-shop: initial import"]);
  await git(seed, ["push", "-q", ORIGIN, "main"]);
  rmSync(seed, { recursive: true, force: true });
}

for (const d of DEVS) {
  const dir = join(SANDBOX, d.dev);
  if (!existsSync(dir)) {
    await git(SANDBOX, ["clone", "-q", ORIGIN, dir]);
    await git(dir, ["config", "user.name", d.dev]);
    await git(dir, ["config", "user.email", `${d.dev}@example.com`]);
  }
  const home = join(SANDBOX, `.home-${d.dev}`);
  mkdirSync(home, { recursive: true });
  // Keep an existing config: it may already hold this dev's token.
  if (!existsSync(join(home, "config.json"))) {
    writeFileSync(join(home, "config.json"), JSON.stringify({ dev: d.dev, server: "http://127.0.0.1:7390", port: d.port, remote: "origin" }, null, 2));
  }
  const daemon = `http://127.0.0.1:${d.port}`;
  if (d.agent === "claude") installClaude(dir, daemon);
  if (d.agent === "codex") installCodex(dir, daemon);
  // The clones point at a Windows path, the server sees /repos/origin.git: link explicitly.
  await writeLink(dir, PROJECT);
  // Agent config stays out of the shared repo history.
  writeFileSync(join(dir, ".git", "info", "exclude"), ".claude/\n.codex/\n.mcp.json\n");
}

const bin = join(GTV_ROOT, "bin", "gtv.mjs");
console.log(`Sandbox ready in ${SANDBOX}

1. Start the operator (docker):   docker compose -f docker/compose.yml --env-file docker/.env up -d --build
2. Create the project and dev tokens (dashboard http://127.0.0.1:7390, or CLI):
     MSYS_NO_PATHCONV=1 GTV_ADMIN_TOKEN=<admin> node "${bin}" project add ${PROJECT} --repo /repos/origin.git --branch main
     dashboard → Developers → alice / bob → copy each token, then per dev:
     $env:GTV_HOME="${join(SANDBOX, ".home-<dev>")}"; node "${bin}" init --dev <dev> --server http://127.0.0.1:7390 --port <7391|7392> --token <token>
3. Start one daemon per dev (separate terminals, PowerShell):
${DEVS.map((d) => `     $env:GTV_HOME="${join(SANDBOX, `.home-${d.dev}`)}"; node "${bin}" daemon`).join("\n")}
4. Agents:
     alice: open ${join(SANDBOX, "alice")} in Claude Code
     bob:   cd ${join(SANDBOX, "bob")}; codex
`);
