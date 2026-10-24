import fs from "node:fs"; import path from "node:path";
const root = path.resolve("src");
const moves = {
  "server/engine.ts": "server/project/engine.ts", "server/store.ts": "server/project/store.ts", "server/repo.ts": "server/project/repo.ts",
  "server/db.ts": "shared/db.ts", "server/tickets.ts": "server/qa/tickets.ts", "server/kb.ts": "server/knowledge/kb.ts",
  "server/mcp.ts": "server/brain/mcp-tools.ts", "server/app.ts": "server/http/agent-routes.ts",
};
const inv = Object.fromEntries(Object.entries(moves).map(([a, b]) => [b, a]));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".ts") ? [path.join(d, e.name)] : []);
const files = [...walk(root), ...walk(path.resolve("test")), path.resolve("scripts/sandbox.ts")];
for (const f of files) {
  const relNew = path.relative(root, f).replace(/\/g, "/");
  const oldAbs = f.startsWith(root) ? path.join(root, inv[relNew] ?? relNew) : f;
  let src = fs.readFileSync(f, "utf8"); let changed = false;
  src = src.replace(/(from\s+|import\()(["'])(\.{1,2}\/[^"']+)\2/g, (m, pre, q, spec) => {
    const targetOld = path.resolve(path.dirname(oldAbs), spec);
    const relT = path.relative(root, targetOld).replace(/\/g, "/");
    const targetNew = moves[relT] ? path.join(root, moves[relT]) : targetOld;
    let rel = path.relative(path.dirname(f), targetNew).replace(/\/g, "/");
    if (!rel.startsWith(".")) rel = "./" + rel;
    if (rel !== spec) changed = true;
    return `${pre}${q}${rel}${q}`;
  });
  if (changed) { fs.writeFileSync(f, src); console.log("fixed", path.relative(".", f)); }
}
