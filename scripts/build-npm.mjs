// Builds the npm package `guide-the-vibe` (the developer CLI: daemon, hooks, MCP, join) into dist/npm:
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
      description: "gtv: coordinate several developers' AI coding agents (Claude Code, Codex) on one repo. Developer CLI.",
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

Developer CLI for [gtv](https://github.com/hienduc14/guide-the-vibe): it connects your Claude Code or Codex
sessions to your team's gtv server, so agents warn about overlapping work before coding and ask the team's
Operator instead of guessing.

\`\`\`bash
# in your project's folder, with the link from the dashboard (Developers › Invite):
npx guide-the-vibe join https://<your gtv server>/j/<code>

# another repo later:
npx guide-the-vibe install
\`\`\`

\`join\` saves your token in \`~/.gtv/config.json\`, links the repo to its project, adds hooks, MCP and a skill
for the agents you pick, and starts the background daemon. Needs Node.js 20 or newer and git.
`,
);
console.log(`dist/npm: guide-the-vibe@${pkg.version}`);
