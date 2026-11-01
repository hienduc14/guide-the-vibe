// Read-only MCP tools for the Operator brain (served over streamable HTTP, stateless).
// Two endpoints share these tools: /p/<project>/mcp is scoped to one project (OpenCode registers one per
// project); /mcp serves every project and each tool takes a `project` argument (Hermes has one static MCP config).

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

const PROJECT = z.string().describe("Project id given in the job prompt");

/** `resolve(undefined)` must return the fixed project's engine; with `shared`, tools require a project id. */
export function buildBrainMcp(resolve: (project?: string) => Promise<Engine>, shared = false): McpServer {
  const server = new McpServer({ name: "gtv-operator", version: "0.1.0" });

  const shaFor = async (e: Engine, view?: string): Promise<string | undefined> => {
    if (!view || view === BASE) return e.mainSha ?? (await e.repo?.mainSha());
    return e.store.workspace(view)?.snapshot_sha ?? undefined;
  };

  // Registers a tool whose handler gets the project's engine; in shared mode the schema gains `project`.
  const tool = (name: string, config: { description: string; inputSchema?: z.ZodRawShape }, fn: (e: Engine, args: any) => Promise<unknown> | unknown) =>
    server.registerTool(name, { description: config.description, inputSchema: { ...config.inputSchema, ...(shared ? { project: PROJECT } : {}) } }, (async (
      args: any,
    ) => {
      let e: Engine;
      try {
        e = await resolve(shared ? args.project : undefined);
      } catch (err) {
        return text((err as Error).message);
      }
      return fn(e, args);
    }) as any);

  tool("team_status", { description: "Active sessions, registered tasks (with scopes), files being edited and open conflicts, per workspace." }, async (e) => {
    const s = e.store.teamState();
    return text({
      workspaces: s.workspaces.map((w) => ({ id: w.id, dev: w.dev, label: w.label, branch: w.branch, has_snapshot: !!w.snapshot_sha })),
      sessions: s.sessions.map((x) => ({ id: x.id, dev: x.dev, agent: x.agent, workspace: x.workspace_id, status: x.status })),
      tasks: s.tasks.map((t) => ({ id: t.id, dev: t.dev, workspace: t.workspace_id, title: t.title, goal: t.goal, resources: t.resources })),
      editing: s.footprints.map((f) => ({ dev: f.dev, workspace: f.workspace_id, path: f.path, last: f.last_at })),
      conflicts: s.conflicts.map((c) => ({ id: c.id, layer: c.layer, level: c.level, subject: c.subject, message: c.message })),
    });
  });

  tool(
    "read_file",
    {
      description: "Read a file from main or from a workspace's WIP snapshot.",
      inputSchema: { path: z.string(), view: VIEW, start_line: z.number().int().optional(), end_line: z.number().int().optional() },
    },
    async (e, { path, view, start_line, end_line }) => {
      const sha = await shaFor(e, view);
      if (!sha || !e.repo) return text("No snapshot for that view.");
      const content = await e.repo.readFile(sha, path);
      if (content === undefined) return text(`${path} does not exist in view ${view ?? BASE}.`);
      const lines = content.split("\n");
      const from = Math.max(1, start_line ?? 1);
      const to = Math.min(lines.length, end_line ?? from + 399);
      return text(
        lines
          .slice(from - 1, to)
          .map((l, i) => `${from + i}: ${l}`)
          .join("\n"),
      );
    },
  );

  tool(
    "grep",
    { description: "Search code with an extended regex (git grep) in main or a workspace view.", inputSchema: { pattern: z.string(), view: VIEW } },
    async (e, { pattern, view }) => {
      const sha = await shaFor(e, view);
      if (!sha || !e.repo) return text("No snapshot for that view.");
      const hits = await e.repo.grep(sha, pattern);
      return text(hits.length ? hits.join("\n") : "No matches.");
    },
  );

  tool(
    "wip_diff",
    {
      description: "What a workspace changed relative to where it branched from main (unified diff, truncated).",
      inputSchema: { workspace: z.string(), path: z.string().optional() },
    },
    async (e, { workspace, path }) => {
      const ws = e.store.workspace(workspace);
      if (!ws?.snapshot_sha || !ws.snapshot_base || !e.repo) return text("No WIP snapshot for that workspace.");
      const { git } = await import("../../shared/util.ts");
      const args = ["diff", "--stat", "-p", "--unified=2", ws.snapshot_base, ws.snapshot_sha];
      if (path) args.push("--", path);
      const r = await git(e.repo.dir, args, { allowFail: true });
      return text(r.stdout || "No changes.");
    },
  );

  tool(
    "find_symbol",
    { description: "Find functions/classes/methods by name, Qualified.name or id (path#qualname).", inputSchema: { query: z.string(), view: VIEW } },
    async (e, { query, view }) =>
      text(
        e.graph
          .findSymbols(query, view ?? BASE)
          .map((s) => ({ id: s.id, kind: s.kind, sig: s.sig, lines: `${s.start_line}-${s.end_line}`, exported: !!s.exported, layer: s.layer })),
      ),
  );

  tool(
    "who_calls",
    { description: "Call sites / type usages of a symbol in a view, with confidence (local, import, name).", inputSchema: { symbol: z.string(), view: VIEW } },
    async (e, { symbol, view }) => {
      const v = view ?? BASE;
      const targets = e.graph.findSymbols(symbol, v, 3);
      if (!targets.length) return text(`Symbol ${symbol} not found in view ${v}.`);
      return text(
        targets.map((t) => ({
          symbol: t.id,
          callers: e.graph.whoCalls(t, v).map((h) => ({ at: `${h.path}:${h.line}`, in: h.from_symbol, confidence: h.confidence, layer: h.layer })),
        })),
      );
    },
  );

  tool(
    "impact",
    {
      description: "Transitive callers of a symbol (what may break if it changes).",
      inputSchema: { symbol: z.string(), view: VIEW, depth: z.number().int().min(1).max(4).optional() },
    },
    async (e, { symbol, view, depth }) => {
      const v = view ?? BASE;
      const [t] = e.graph.findSymbols(symbol, v, 1);
      if (!t) return text(`Symbol ${symbol} not found.`);
      return text({ symbol: t.id, impact: e.graph.impact(t, v, depth ?? 2) });
    },
  );

  tool(
    "file_symbols",
    { description: "Outline of a file: its symbols and signatures.", inputSchema: { path: z.string(), view: VIEW } },
    async (e, { path, view }) =>
      text(e.graph.fileSymbols(path, view ?? BASE).map((s) => ({ id: s.id, kind: s.kind, sig: s.sig, lines: `${s.start_line}-${s.end_line}` }))),
  );

  tool(
    "overview",
    { description: "Most referenced symbols of the codebase (a quick map).", inputSchema: { view: VIEW, limit: z.number().int().max(80).optional() } },
    async (e, { view, limit }) => text(e.graph.overview(view ?? BASE, limit ?? 30)),
  );

  tool(
    "owners",
    { description: "Who has worked on a path (git history authors) and recent commits.", inputSchema: { path: z.string() } },
    async (e, { path }) => {
      const sha = await shaFor(e, BASE);
      if (!sha || !e.repo) return text("No repository.");
      return text({ authors: await e.repo.authors(sha, path), recent: await e.repo.log(sha, path, 8) });
    },
  );

  tool(
    "kb_search",
    {
      description: "Search team knowledge: business docs, ADRs (decisions) and past Q&A. Q&A marked unverified is not confirmed by a human.",
      inputSchema: { query: z.string(), type: z.enum(["doc", "adr", "qa", "req"]).optional() },
    },
    async (e, { query, type }) => text(e.kb.search(query, { limit: 8, types: type ? [type] : undefined })),
  );

  tool("kb_get", { description: "Read a knowledge document by id.", inputSchema: { id: z.string() } }, async (e, { id }) =>
    text(e.kb.get(id) ?? `No document ${id}.`),
  );

  tool(
    "conflicts",
    { description: "Open conflicts with their evidence (optionally for one workspace).", inputSchema: { workspace: z.string().optional() } },
    async (e, { workspace }) => text(e.store.conflicts("open").filter((c) => !workspace || c.workspace_a === workspace || c.workspace_b === workspace)),
  );

  return server;
}

export async function handleBrainMcp(resolve: (project?: string) => Promise<Engine>, req: Request, shared = false): Promise<Response> {
  const server = buildBrainMcp(resolve, shared);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void server.close();
  }
}
