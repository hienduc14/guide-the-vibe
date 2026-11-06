// stdio MCP server that coding agents launch (`gtv mcp --agent claude|codex|auto`).
// Every tool is forwarded to the local daemon, which knows the agent's session and workspace.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { daemonUrl } from "./config.ts";
import type { AgentKind } from "../shared/types.ts";

const RESOURCE = z.object({
  kind: z
    .enum(["path", "module", "symbol", "contract"])
    .describe("path = file or glob (src/auth/**); symbol = Class.method or function; contract = API route / event / schema"),
  value: z.string(),
  op: z.enum(["read", "modify", "create", "delete", "rename", "sig_change"]).optional().describe("sig_change/rename/delete = breaking for callers"),
  certainty: z.enum(["committed", "contingent"]).optional(),
});

export function detectAgent(arg: string | undefined): AgentKind {
  if (arg && arg !== "auto") return arg as AgentKind;
  if (process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT) return "claude";
  if (Object.keys(process.env).some((k) => k.startsWith("CODEX_"))) return "codex";
  return "other";
}

export async function runMcp(agentArg?: string, daemon = daemonUrl()): Promise<void> {
  const agent = detectAgent(agentArg);
  const cwd = process.env.GTV_CWD ?? process.cwd();
  const server = new McpServer({ name: "gtv", version: "0.1.0" });

  const call = async (tool: string, args: Record<string, unknown>) => {
    try {
      const res = await fetch(`${daemon}/api/${tool}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent, cwd, args }),
      });
      const json = (await res.json()) as { text?: string; error?: string };
      return { content: [{ type: "text" as const, text: json.text ?? `gtv error: ${json.error}` }], isError: !res.ok };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `gtv daemon is not reachable (${(e as Error).message}). Start it with: gtv daemon` }], isError: true };
    }
  };

  server.registerTool(
    "gtv_register_task",
    {
      description:
        "Register the task you are about to do BEFORE editing files, so teammates' agents and the Project Operator know. Returns overlaps with other developers' work, relevant team knowledge and advice. Re-register when starting a new task.",
      inputSchema: {
        title: z.string(),
        goal: z.string().optional(),
        resources: z.array(RESOURCE).describe("Files/globs, modules, symbols and contracts you expect to touch"),
      },
    },
    (args) => call("register_task", args),
  );
  server.registerTool(
    "gtv_update_task",
    {
      description: "Update your registered task, e.g. add files/symbols you now need to touch (scope drift) or change status.",
      inputSchema: {
        title: z.string().optional(),
        goal: z.string().optional(),
        add_resources: z.array(RESOURCE).optional(),
        resources: z.array(RESOURCE).optional(),
        status: z.enum(["pr_open", "done", "abandoned"]).optional(),
      },
    },
    (args) => call("update_task", args),
  );
  server.registerTool(
    "gtv_finish_task",
    { description: "Mark your registered task finished (done) or abandoned.", inputSchema: { status: z.enum(["done", "abandoned"]).optional() } },
    (args) => call("finish_task", args),
  );
  server.registerTool(
    "gtv_ask",
    {
      description:
        "Ask the Project Operator a question while coding: what teammates are doing or changing, who calls/owns some code, how a business rule or past decision works. It answers from the code graph, team docs and other developers' WIP, or forwards the question to the right teammate's agent (then the answer is delivered to you later). Set to_dev to ask a specific teammate directly.",
      inputSchema: { question: z.string(), context: z.string().optional().describe("What you are doing and why you ask"), to_dev: z.string().optional() },
    },
    (args) => call("ask", args),
  );
  server.registerTool(
    "gtv_reply",
    {
      description: "Answer a question a teammate's agent sent you (ticket id from the message). Set escalate=true if your user must decide.",
      inputSchema: { ticket_id: z.string(), answer: z.string(), escalate: z.boolean().optional() },
    },
    (args) => call("reply", args),
  );
  server.registerTool("gtv_status", { description: "Who is working on what right now: teammates' tasks, files being edited, open conflicts." }, () =>
    call("status", {}),
  );
  server.registerTool(
    "gtv_check",
    {
      description: "Before touching files or symbols, check whether a teammate is working on them.",
      inputSchema: { paths: z.array(z.string()).optional(), symbols: z.array(z.string()).optional() },
    },
    (args) => call("check", args),
  );
  server.registerTool("gtv_inbox", { description: "Read pending gtv messages and questions waiting for you." }, () => call("inbox", {}));
  server.registerTool(
    "gtv_ack",
    { description: "Acknowledge a conflict after you coordinated with the teammate.", inputSchema: { conflict_id: z.string() } },
    (args) => call("ack", args),
  );

  await server.connect(new StdioServerTransport());
}
