// Builds the npm package `guide-the-vibe` (the gtv CLI: login, on/off, daemon, hooks, MCP) into dist/npm:
// one bundled gtv.mjs with no dependencies, since Node does not run TypeScript from node_modules.
// Publish: npm run build:npm && npm publish dist/npm

import { build } from "esbuild";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const out = new URL("dist/npm/", root);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [fileURLToPath(new URL("bin/gtv.mjs", root))],
  outfile: fileURLToPath(new URL("gtv.mjs", out)),
  bundle: true,
  minify: true,
  platform: "node",
  format: "esm",
  target: "node20",
  define: {
    __GTV_SKILL__: JSON.stringify(readFileSync(new URL("src/adapters/skill/SKILL.md", root), "utf8")),
    __GTV_TASKS_SKILL__: JSON.stringify(readFileSync(new URL("src/adapters/skill/gtv/SKILL.md", root), "utf8")),
    __GTV_VERSION__: JSON.stringify(pkg.version),
  },
  // CommonJS dependencies inside an ES module bundle need require().
  banner: { js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" },
});

writeFileSync(
  new URL("package.json", out),
  JSON.stringify(
    {
      name: "guide-the-vibe",
      version: pkg.version,
      description: "gtv: coordinate several developers' AI coding agents (Claude Code, Codex) on one repo. The gtv command.",
      type: "module",
      bin: { "guide-the-vibe": "gtv.mjs", gtv: "gtv.mjs" },
      files: ["gtv.mjs"],
      engines: { node: ">=20" },
      repository: { type: "git", url: "git+https://github.com/hienduc14/guide-the-vibe.git" },
      homepage: "https://github.com/hienduc14/guide-the-vibe",
      keywords: ["claude-code", "codex", "mcp", "ai-agents", "coordination"],
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  new URL("README.md", out),
  `# guide-the-vibe

The \`gtv\` command for [gtv](https://github.com/hienduc14/guide-the-vibe): it connects your Claude Code or Codex
sessions to your team's gtv server, so agents warn about overlapping work before coding and ask the team instead
of guessing.

\`\`\`bash
npx guide-the-vibe        # installs the gtv command (run again to update)
gtv login                 # asks for your team's server, then you approve this computer in the browser
gtv on                    # inside a project repo: hooks, MCP server and skill for your agents
\`\`\`

Daily: \`gtv status\`, \`gtv open\`, \`gtv answer <id> "…"\`. Something off: \`gtv doctor\`. Remove: \`gtv off\`, \`gtv logout\`.
Your account comes from your team's admin (an activation link). Needs Node.js 20 or newer and git.
Guide: https://github.com/hienduc14/guide-the-vibe/blob/main/docs/cli.md
`,
);
console.log(`dist/npm: guide-the-vibe@${pkg.version}`);
