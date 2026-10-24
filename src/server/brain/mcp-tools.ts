// Read-only MCP tools for the Operator brain (served over streamable HTTP, stateless).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Engine } from "../project/engine.ts";
import { BASE } from "../../codeintel/graph.ts";
import { truncate } from "../../shared/util.ts";

const MAX_TEXT = 24_000;

function text(value: unknown) {
  const s = typeof value === "string" ? value : JSON.stringify(value, null, 1);
  return { content: [{ type: "text" as const, text: truncate(s, MAX_TEXT) }] };
}

const VIEW = z.string().optional().describe('Code view: "base" (main, default) or a workspace id from gtv_team_status');

export function buildBrainMcp(engine: Engine): McpServer {
  const server = new McpServer({ name: "gtv-operator", version: "0.1.0" });
  const { store, graph, kb, repo } = engine;

  const shaFor = async (view?: string): Promise<string | undefined> => {
    if (!view || view === BASE) return engine.mainSha ?? (await repo?.mainSha());
    return store.workspace(view)?.snapshot_sha ?? undefined;
  };

  server.registerTool(
    "team_status",
    { description: "Active sessions, registered tasks (with scopes), files being edited and open conflicts, per workspace." },
    async () => {
      const s = store.teamState();
      return text({
        workspaces: s.workspaces.map((w) => ({ id: w.id, dev: w.dev, label: w.label, branch: w.branch, has_snapshot: !!w.snapshot_sha })),
        sessions: s.sessions.map((x) => ({ id: x.id, dev: x.dev, agent: x.agent, workspace: x.workspace_id, status: x.status })),
        tasks: s.tasks.map((t) => ({ id: t.id, dev: t.dev, workspace: t.workspace_id, title: t.title, goal: t.goal, resources: t.resources })),
        editing: s.footprints.map((f) => ({ dev: f.dev, workspace: f.workspace_id, path: f.path, last: f.last_at })),
        conflicts: s.conflicts.map((c) => ({ id: c.id, layer: c.layer, level: c.level, subject: c.subject, message: c.message })),
      });
    },
  );

  server.registerTool(
    "read_file",
    { description: "Read a file from main or from a workspace's WIP snapshot.", inputSchema: { path: z.string(), view: VIEW, start_line: z.number().int().optional(), end_line: z.number().int().optional() } },
    async ({ path, view, start_line, end_line }) => {
      const sha = await shaFor(view);
      if (!sha || !repo) return text("No snapshot for that view.");
      const content = await repo.readFile(sha, path);
      if (content === undefined) return text(`${path} does not exist in view ${view ?? BASE}.`);
      const lines = content.split("\n");
      const from = Math.max(1, start_line ?? 1);
      const to = Math.min(lines.length, end_line ?? from + 399);
      return text(lines.slice(from - 1, to).map((l, i) => `${from + i}: ${l}`).join("\n"));
    },
  );

  server.registerTool(
    "grep",
    { description: "Search code with an extended regex (git grep) in main or a workspace view.", inputSchema: { pattern: z.string(), view: VIEW } },
    async ({ pattern, view }) => {
      const sha = await shaFor(view);
      if (!sha || !repo) return text("No snapshot for that view.");
      const hits = await repo.grep(sha, pattern);
      return text(hits.length ? hits.join("\n") : "No matches.");
    },
  );

  server.registerTool(
    "wip_diff",
    { description: "What a workspace changed relative to where it branched from main (unified diff, truncated).", inputSchema: { workspace: z.string(), path: z.string().optional() } },
    async ({ workspace, path }) => {
      const ws = store.workspace(workspace);
      if (!ws?.snapshot_sha || !ws.snapshot_base || !repo) return text("No WIP snapshot for that workspace.");
      const { git } = await import("../../shared/util.ts");
      const args = ["diff", "--stat", "-p", "--unified=2", ws.snapshot_base, ws.snapshot_sha];
      if (path) args.push("--", path);
      const r = await git(repo.dir, args, { allowFail: true });
      return text(r.stdout || "No changes.");
    },
  );

  server.registerTool(
    "find_symbol",
    { description: "Find functions/classes/methods by name, Qualified.name or id (path#qualname).", inputSchema: { query: z.string(), view: VIEW } },
    async ({ query, view }) => text(graph.findSymbols(query, view ?? BASE).map((s) => ({ id: s.id, kind: s.kind, sig: s.sig, lines: `${s.start_line}-${s.end_line}`, exported: !!s.exported, layer: s.layer }))),
  );

  server.registerTool(
    "who_calls",
    { description: "Call sites / type usages of a symbol in a view, with confidence (local, import, name).", inputSchema: { symbol: z.string(), view: VIEW } },
    async ({ symbol, view }) => {
      const v = view ?? BASE;
      const targets = graph.findSymbols(symbol, v, 3);
      if (!targets.length) return text(`Symbol ${symbol} not found in view ${v}.`);
      return text(targets.map((t) => ({ symbol: t.id, callers: graph.whoCalls(t, v).map((h) => ({ at: `${h.path}:${h.line}`, in: h.from_symbol, confidence: h.confidence, layer: h.layer })) })));
    },
  );

  server.registerTool(
    "impact",
    { description: "Transitive callers of a symbol (what may break if it changes).", inputSchema: { symbol: z.string(), view: VIEW, depth: z.number().int().min(1).max(4).optional() } },
    async ({ symbol, view, depth }) => {
      const v = view ?? BASE;
      const [t] = graph.findSymbols(symbol, v, 1);
      if (!t) return text(`Symbol ${symbol} not found.`);
      return text({ symbol: t.id, impact: graph.impact(t, v, depth ?? 2) });
    },
  );

  server.registerTool(
    "file_symbols",
    { description: "Outline of a file: its symbols and signatures.", inputSchema: { path: z.string(), view: VIEW } },
    async ({ path, view }) => text(graph.fileSymbols(path, view ?? BASE).map((s) => ({ id: s.id, kind: s.kind, sig: s.sig, lines: `${s.start_line}-${s.end_line}` }))),
  );

  server.registerTool(
    "overview",
    { description: "Most referenced symbols of the codebase (a quick map).", inputSchema: { view: VIEW, limit: z.number().int().max(80).optional() } },
    async ({ view, limit }) => text(graph.overview(view ?? BASE, limit ?? 30)),
  );

  server.registerTool(
    "owners",
    { description: "Who has worked on a path (git history authors) and recent commits.", inputSchema: { path: z.string() } },
    async ({ path }) => {
      const sha = await shaFor(BASE);
      if (!sha || !repo) return text("No repository.");
      return text({ authors: await repo.authors(sha, path), recent: await repo.log(sha, path, 8) });
    },
  );

  server.registerTool(
    "kb_search",
    { description: "Search team knowledge: business docs, ADRs (decisions) and past Q&A. Q&A marked unverified is not confirmed by a human.", inputSchema: { query: z.string(), type: z.enum(["doc", "adr", "qa", "req"]).optional() } },
    async ({ query, type }) => text(kb.search(query, { limit: 8, types: type ? [type] : undefined })),
  );

  server.registerTool(
    "kb_get",
    { description: "Read a knowledge document by id.", inputSchema: { id: z.string() } },
    async ({ id }) => text(kb.get(id) ?? `No document ${id}.`),
  );

  server.registerTool(
    "conflicts",
    { description: "Open conflicts with their evidence (optionally for one workspace).", inputSchema: { workspace: z.string().optional() } },
    async ({ workspace }) => text(store.conflicts("open").filter((c) => !workspace || c.workspace_a === workspace || c.workspace_b === workspace)),
  );

  return server;
}

export async function handleBrainMcp(engine: Engine, req: Request): Promise<Response> {
  const server = buildBrainMcp(engine);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void server.close();
  }
}
