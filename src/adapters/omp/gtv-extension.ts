// gtv extension for omp (oh-my-pi). Load with: omp -e <path-to>/gtv-extension.ts
// Forwards hook events to the local gtv daemon, blocks risky edits, injects Operator messages into the
// running agent, and registers the gtv_* tools natively (no MCP needed).

const DAEMON = process.env.GTV_DAEMON_URL ?? `http://127.0.0.1:${process.env.GTV_DAEMON_PORT ?? 7391}`;

type Decision = { decision: "allow" | "ask" | "deny"; reason?: string; context?: string };

async function post(path: string, body: unknown, timeoutMs = 3000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(DAEMON + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined; // daemon down: never block omp
  } finally {
    clearTimeout(t);
  }
}

function editPaths(toolName: string, input: Record<string, any>): string[] {
  if (!["edit", "write", "multiedit", "notebook_edit", "patch"].includes(toolName.toLowerCase())) return [];
  const out = [input.path, input.file_path, ...(Array.isArray(input.paths) ? input.paths : [])].filter((p) => typeof p === "string");
  return [...new Set(out)];
}

export default function gtv(pi: any) {
  let sessionId = `omp-${process.pid}`;
  let cwd = process.cwd();
  const hook = (ev: Record<string, unknown>, timeoutMs?: number): Promise<Decision | undefined> =>
    post("/hook/omp", { session_id: sessionId, cwd, ...ev }, timeoutMs);

  const capture = (ctx: any) => {
    if (ctx?.cwd) cwd = ctx.cwd;
    const id = ctx?.sessionManager?.getSessionId?.();
    if (id) sessionId = id;
  };

  const inject = (text?: string) => {
    if (!text) return;
    try {
      pi.sendMessage({ customType: "gtv", content: text, display: true }, { deliverAs: "steer" });
    } catch {
      // older omp builds: ignore
    }
  };

  pi.on("session_start", async (_ev: unknown, ctx: any) => {
    capture(ctx);
    const d = await hook({ hook_event_name: "SessionStart" }, 15_000);
    inject(d?.context);
  });

  pi.on("input", async (ev: { text?: string }, ctx: any) => {
    capture(ctx);
    const d = await hook({ hook_event_name: "UserPromptSubmit", prompt: ev.text ?? "" });
    inject(d?.context);
    return undefined;
  });

  pi.on("tool_call", async (ev: { toolName: string; input: Record<string, any> }, ctx: any) => {
    capture(ctx);
    const paths = editPaths(ev.toolName, ev.input ?? {});
    if (!paths.length) return undefined;
    const d = await hook({ hook_event_name: "PreToolUse", tool_name: ev.toolName, paths });
    if (d && d.decision !== "allow") return { block: true, reason: [d.reason, d.context].filter(Boolean).join("\n") };
    inject(d?.context);
    return undefined;
  });

  pi.on("tool_result", async (ev: { toolName: string; input: Record<string, any>; content: any[] }, ctx: any) => {
    capture(ctx);
    const paths = editPaths(ev.toolName, ev.input ?? {});
    const d = await hook({ hook_event_name: "PostToolUse", tool_name: ev.toolName, paths });
    if (!d?.context) return undefined;
    // Append the Operator's messages to the tool result the model is about to read.
    return { content: [...(ev.content ?? []), { type: "text", text: `\n\n${d.context}` }] };
  });

  pi.on("session_shutdown", async () => {
    await hook({ hook_event_name: "SessionEnd" }, 1000);
  });

  // ---- tools ----
  const z = pi.zod;
  const resource = z.object({
    kind: z.enum(["path", "module", "symbol", "contract"]),
    value: z.string(),
    op: z.enum(["read", "modify", "create", "delete", "rename", "sig_change"]).optional(),
    certainty: z.enum(["committed", "contingent"]).optional(),
  });
  const tool = (name: string, description: string, parameters: unknown, api: string) =>
    pi.registerTool({
      name,
      label: name,
      description,
      parameters,
      loadMode: "essential",
      approval: "read",
      async execute(_id: string, params: Record<string, unknown>) {
        const res = await post(`/api/${api}`, { agent: "omp", cwd, args: params }, 130_000);
        return { content: [{ type: "text", text: res?.text ?? `gtv error: ${res?.error ?? "daemon not reachable"}` }] };
      },
    });

  tool(
    "gtv_register_task",
    "Register the task you are about to do BEFORE editing files (title, goal, files/symbols you will touch). Returns overlaps with teammates' work and relevant knowledge.",
    z.object({ title: z.string(), goal: z.string().optional(), resources: z.array(resource) }),
    "register_task",
  );
  tool(
    "gtv_update_task",
    "Update your registered task (add_resources when your scope grows, or status).",
    z.object({
      title: z.string().optional(),
      goal: z.string().optional(),
      add_resources: z.array(resource).optional(),
      status: z.enum(["pr_open", "done", "abandoned"]).optional(),
    }),
    "update_task",
  );
  tool(
    "gtv_finish_task",
    "Mark your registered task finished (done) or abandoned.",
    z.object({ status: z.enum(["done", "abandoned"]).optional() }),
    "finish_task",
  );
  tool(
    "gtv_ask",
    "Ask the Project Operator: what teammates are doing, who calls/owns code, business rules, past decisions. It may forward to a teammate; the answer then arrives later.",
    z.object({ question: z.string(), context: z.string().optional(), to_dev: z.string().optional() }),
    "ask",
  );
  tool(
    "gtv_reply",
    "Answer a question a teammate's agent sent you (ticket id). escalate=true if your user must decide.",
    z.object({ ticket_id: z.string(), answer: z.string(), escalate: z.boolean().optional() }),
    "reply",
  );
  tool("gtv_status", "Who is working on what right now, and open conflicts.", z.object({}), "status");
  tool(
    "gtv_check",
    "Check whether teammates are working on these files or symbols.",
    z.object({ paths: z.array(z.string()).optional(), symbols: z.array(z.string()).optional() }),
    "check",
  );
  tool("gtv_inbox", "Read pending gtv messages and questions waiting for you.", z.object({}), "inbox");
  tool("gtv_ack", "Acknowledge a conflict after coordinating.", z.object({ conflict_id: z.string() }), "ack");
}
