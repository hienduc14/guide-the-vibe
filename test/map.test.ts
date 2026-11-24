// Code map: modules/files with import edges, and call graphs around a symbol.

import { test } from "node:test";
import assert from "node:assert/strict";
import { indexFile } from "../src/codeintel/extract.ts";
import { CodeGraph, BASE } from "../src/codeintel/graph.ts";
import { callMap, structureMap } from "../src/codeintel/map.ts";
import { PROJECT_SCHEMA } from "../src/server/project/schema.ts";
import { Db } from "../src/shared/db.ts";

const FILES: Record<string, string> = {
  "src/api/routes.ts": `import { createOrder } from "../orders/service";\nimport { login } from "../auth/service";\nexport function mount() { createOrder(1); login("a"); }\n`,
  "src/orders/service.ts": `import { findUser } from "../users/repo";\nimport express from "express";\nexport function createOrder(id: number) { return total(id) + findUser(id); }\nexport function total(id: number) { return id }\n`,
  "src/auth/service.ts": `import { findUser } from "../users/repo";\nexport function login(name: string) { return findUser(1); }\n`,
  "src/users/repo.ts": `export function findUser(id: number) { return id }\n`,
  "app/models.py": `def user():\n    return 1\n`,
  "app/views.py": `from app.models import user\n\ndef show():\n    return user()\n`,
};

async function graph(): Promise<CodeGraph> {
  const g = new CodeGraph(new Db(":memory:", PROJECT_SCHEMA));
  for (const [path, src] of Object.entries(FILES)) g.replaceFile(BASE, (await indexFile(path, src))!);
  return g;
}

test("module map: folders with import edges, external packages left out", async () => {
  const m = structureMap(await graph(), BASE);
  assert.equal(m.level, "dir");
  assert.deepEqual(m.nodes.map((n) => n.id).sort(), ["app", "src/api", "src/auth", "src/orders", "src/users"]);
  const edges = m.edges.map((e) => `${e.source}->${e.target}`).sort();
  assert.deepEqual(edges, ["src/api->src/auth", "src/api->src/orders", "src/auth->src/users", "src/orders->src/users"]);
  assert.equal(m.nodes.find((n) => n.id === "src/orders")!.symbols, 2);
});

test("file map: relative and Python dotted imports resolve; focus keeps a folder and its neighbours", async () => {
  const g = await graph();
  const m = structureMap(g, BASE, { level: "file" });
  const edges = m.edges.map((e) => `${e.source}->${e.target}`);
  assert.ok(edges.includes("src/orders/service.ts->src/users/repo.ts"));
  assert.ok(edges.includes("app/views.py->app/models.py"));
  const f = structureMap(g, BASE, { level: "file", focus: "src/users" });
  assert.deepEqual(f.nodes.map((n) => n.id).sort(), ["src/auth/service.ts", "src/orders/service.ts", "src/users/repo.ts"]);
});

test("call map: callers and callees of a symbol", async () => {
  const c = callMap(await graph(), "createOrder", BASE);
  assert.equal(c.center?.label, "createOrder");
  const byRole = (role: string) =>
    c.nodes
      .filter((n) => n.role === role)
      .map((n) => n.label)
      .sort();
  assert.deepEqual(byRole("caller"), ["mount"]);
  assert.deepEqual(byRole("callee"), ["findUser", "total"]);
  assert.deepEqual(callMap(await graph(), "nope", BASE).nodes, []);
});
