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
  // Every agent session starts this process, so it is where a stopped daemon gets started again.
  const autostart = daemon === daemonUrl() && !process.env.GTV_NO_AUTOSTART;
  const startDaemon = () => import("./install.ts").then((m) => m.ensureDaemon(daemon)).catch(() => false);
  if (autostart) void startDaemon();
  const server = new McpServer({ name: "gtv", version: "0.1.0" });

  const post = (tool: string, args: Record<string, unknown>) =>
    fetch(`${daemon}/api/${tool}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent, cwd, args }) });
  const call = async (tool: string, args: Record<string, unknown>) => {
    try {
      const res = await post(tool, args).catch(async (e) => {
        if (autostart && (await startDaemon())) return post(tool, args);
        throw e;
      });
      const json = (await res.json()) as { text?: string; error?: string };
      return { content: [{ type: "text" as const, text: json.text ?? `gtv error: ${json.error}` }], isError: !res.ok };
    } catch (e) {
      return {
        content: [
          {
            type: "text" as const,
            text: `gtv daemon is not reachable (${(e as Error).message}). Its log is ~/.gtv/daemon.log; run \`npx guide-the-vibe daemon\` to see errors.`,
          },
        ],
        isError: true,
      };
    }
  };

  server.registerTool(
    "gtv_register_task",
    {
      description:
        "Register the task you are about to do BEFORE editing files, so teammates' agents and the Project Operator know. Returns overlaps with other developers' work, relevant team knowledge and advice. Re-register when starting a new task.",
      inputSchema: {
        title: z.string().max(80).describe("Short title in the team's language from the briefing, at most 60 characters"),
        goal: z.string().optional(),
        resources: z
          .array(RESOURCE)
          .describe("Files/globs, modules, symbols and contracts you expect to touch. Name concrete files when you know them, not only globs"),
        board_task_id: z
          .string()
          .optional()
          .describe("The task-board item this work is for (not needed after gtv_pick_task; without one, gtv adds your work to the board)"),
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
    {
      description: "Mark your registered task finished (done) or abandoned, with a short summary the lead reads on the dashboard.",
      inputSchema: {
        status: z.enum(["done", "abandoned"]).optional(),
        summary: z.string().optional().describe("1-3 short lines in the team's language: what you changed, what you tested, what is left (or why you stopped)"),
      },
    },
    (args) => call("finish_task", args),
  );
  server.registerTool(
    "gtv_ask",
    {
      description:
        "Ask the Project Operator a question while coding: what teammates are doing or changing, who calls/owns some code, how a business rule or past decision works. It answers from the code graph, team docs and other developers' WIP, or forwards the question to the right teammate's agent (then the answer is delivered to you later). Set to_dev to ask a specific teammate directly.",
      inputSchema: {
        question: z.string().describe("The question alone, one or two sentences, in the team's language"),
        context: z.string().optional().describe("What you are doing and why you ask"),
        to_dev: z.string().optional(),
        options: z
          .array(z.string().max(80))
          .max(5)
          .optional()
          .describe("When someone has to choose, the choices (2-5 short phrases): the lead can pick one with a click"),
      },
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
  server.registerTool(
    "gtv_withdraw",
    {
      description:
        "Withdraw a question you asked (gtv_ask) that no longer needs an answer, e.g. you and the teammate already settled it. It leaves the team lead's list and the teammate stops being asked.",
      inputSchema: { ticket_id: z.string(), reason: z.string().optional().describe("One short line in the team's language: why it is no longer needed") },
    },
    (args) => call("withdraw", args),
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
    "gtv_tasks",
    {
      description:
        "List the project's task board: open tasks with priority, due date and assignee, most urgent first. Use it when the user asks what to work on, or runs /gtv.",
      inputSchema: { mine: z.boolean().optional().describe("Only tasks assigned to you") },
    },
    (args) => call("tasks", args),
  );
  server.registerTool(
    "gtv_pick_task",
    {
      description:
        "Take a task from the board (after the user agreed): it is assigned to you and goes in progress. Returns its description and notes. Then plan and call gtv_register_task.",
      inputSchema: { task_id: z.string() },
    },
    (args) => call("pick_task", args),
  );
  server.registerTool(
    "gtv_docs",
    {
      description:
        "Read the team's project documents (requirements, business rules, decisions, guides). No arguments: list the core documents the team expects you to follow. query: search all documents. id: read one in full.",
      inputSchema: { query: z.string().optional(), id: z.string().optional() },
    },
    (args) => call("docs", args),
  );
  server.registerTool(
    "gtv_log_work",
    {
      description:
        "Add a note to your board task's work log: progress, a decision, a blocker or an open question. The lead reads the one-line summary on the dashboard.",
      inputSchema: {
        kind: z.enum(["progress", "decision", "blocker", "question"]).optional().describe("What the note is about (default progress)"),
        summary: z.string().max(140).optional().describe("One line, at most 120 characters, in the team's language"),
        detail: z.string().optional().describe("Longer explanation if needed"),
        note: z.string().optional().describe("Older form of summary + detail in one text"),
        task_id: z.string().optional().describe("Defaults to the board task of your registered work"),
      },
    },
    (args) => call("log_work", args),
  );
  server.registerTool(
    "gtv_ack",
    { description: "Acknowledge a conflict after you coordinated with the teammate.", inputSchema: { conflict_id: z.string() } },
    (args) => call("ack", args),
  );

  await server.connect(new StdioServerTransport());
}
