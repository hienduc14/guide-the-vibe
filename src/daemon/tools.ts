// The gtv_* tools agents call (through MCP), executed against the server.

import type { ServerClient } from "./client.ts";
import type { LocalSession } from "./decide.ts";
import type { WorkspaceInfo } from "./workspace.ts";
import { charterText, type TeamState, type Ticket } from "../shared/types.ts";

export interface ToolContext {
  client: ServerClient;
  session: LocalSession;
  ws: WorkspaceInfo;
  state: TeamState | undefined;
  serverUrl: string;
  /** Drain this session's pending messages into text. */
  drain(): string | undefined;
  snapshotSoon(): void;
}

export async function runTool(ctx: ToolContext, name: string, args: Record<string, any>): Promise<string> {
  const { client, session, ws, state } = ctx;
  const p = `/v1/p/${ws.project}`;
  const myTask = () => state?.tasks.find((t) => t.session_id === session.id) ?? state?.tasks.find((t) => t.workspace_id === ws.id);
  switch (name) {
    case "register_task": {
      const { board_task_id, ...reg } = args;
      const fb = await client.call("POST", `${p}/tasks`, { session_id: session.id, ...reg, board_id: board_task_id }, 60_000);
      session.seen.add("nudge_register");
      const lines = [`Registered task ${fb.task.id} "${fb.task.title}". Status: ${fb.status}.`];
      if (fb.board)
        lines.push(`Board task: ${fb.board.id} "${fb.board.title}" (priority ${fb.board.priority}${fb.board.due_date ? `, due ${fb.board.due_date}` : ""}).`);
      for (const o of fb.overlaps) lines.push(`- [${o.level} ${o.layer}] with ${o.with}: ${o.message} (${o.conflict_id})`);
      if (fb.advice) lines.push(`Operator advice: ${fb.advice}`);
      if (fb.knowledge.length) lines.push("Relevant team knowledge:", ...fb.knowledge.map((k: any) => `- ${k.id} [${k.status}] ${k.section}: ${k.snippet}`));
      if (fb.l3 === "pending") lines.push("The Operator is still analysing; any finding will be delivered to you.");
      if (fb.status !== "ok") lines.push("Adjust your plan or coordinate (gtv_ask) before editing the overlapping parts.");
      return lines.join("\n");
    }
    case "update_task": {
      const t = myTask();
      if (!t) return "No registered task for this session. Use gtv_register_task first.";
      const next = await client.call("PATCH", `${p}/tasks/${t.id}`, args);
      return `Task ${next.id} updated: ${next.title}; scope: ${next.resources.map((r: any) => `${r.kind}:${r.value}`).join(", ")}`;
    }
    case "finish_task": {
      const t = myTask();
      if (!t) return "No open task for this session (it may already be finished).";
      await client.call("PATCH", `${p}/tasks/${t.id}`, { status: args.status ?? "done", summary: args.summary });
      ctx.snapshotSoon();
      return `Task ${t.id} marked ${args.status ?? "done"}.`;
    }
    case "ask": {
      const t = await client.call<Ticket & { formatted?: string }>(
        "POST",
        `${p}/tickets`,
        { session_id: session.id, question: args.question, context: args.context, to_dev: args.to_dev, options: args.options },
        120_000,
      );
      if (t.status === "answered" || t.status === "closed") return t.formatted ?? t.answer ?? "(no answer)";
      if (t.status === "forwarded")
        return `Ticket ${t.id}: forwarded to ${t.to_dev}${t.answer ? ` (Operator note: ${t.answer})` : ""}. Continue with work that does not depend on the answer; it will be delivered to you automatically.`;
      if (t.status === "waiting_human") return `Ticket ${t.id}: waiting for a human decision from ${t.to_dev}. It will be delivered to you.`;
      return `Ticket ${t.id} is still being analysed by the Operator; the answer will be delivered to you automatically.`;
    }
    case "reply": {
      const t = await client.call<Ticket>("POST", `${p}/tickets/${args.ticket_id}/reply`, {
        answer: args.answer ?? "",
        escalate: !!args.escalate,
        session_id: session.id,
      });
      return args.escalate ? `Escalated ${t.id} to your user. Ask them and they can answer with: gtv answer ${t.id} "<answer>"` : `Answer sent for ${t.id}.`;
    }
    case "status":
      return describeStatus(state, ctx.serverUrl, session.dev, ws);
    case "check": {
      const r = await client.call("POST", `${p}/check`, { session_id: session.id, paths: args.paths, symbols: args.symbols });
      return r.clear ? "Clear: nobody else is working on these." : r.findings.map((f: any) => `- ${f.detail}`).join("\n");
    }
    case "inbox": {
      const text = ctx.drain();
      const forMe = await client.call<Ticket[]>("GET", `${p}/tickets?scope=for_me`);
      const lines = [text ?? "No new messages."];
      if (forMe.length)
        lines.push("Questions waiting for you/your user:", ...forMe.map((t) => `- ${t.id} from ${t.from_dev}: ${t.forwarded_question ?? t.question}`));
      return lines.join("\n");
    }
    case "tasks": {
      const items = await client.call<any[]>("GET", `${p}/board?scope=${args.mine ? "mine" : "open"}`);
      const open = items.filter((t) => t.status !== "review");
      if (!open.length)
        return args.mine ? "No open board tasks are assigned to you." : "The task board has no open tasks. Register your own work with gtv_register_task.";
      const lines = ["Open tasks (most urgent first). Pick one with gtv_pick_task:"];
      for (const t of open) lines.push(formatBoardLine(t, session.dev));
      return lines.join("\n");
    }
    case "pick_task": {
      const t = await client.call<any>("POST", `${p}/board/${encodeURIComponent(args.task_id)}/pick`, { session_id: session.id });
      const lines = [
        `You picked ${t.id}: "${t.title}" — priority ${t.priority}${t.due_date ? `, due ${t.due_date}` : ""}${t.estimate_h ? `, estimate ${t.estimate_h} h` : ""}.`,
      ];
      if (t.description) lines.push("", t.description);
      const notes = (t.notes ?? []).filter((n: any) => n.kind === "note");
      if (notes.length) lines.push("", "Notes on this task:", ...notes.slice(-8).map((n: any) => `- ${n.author}: ${n.body}`));
      if (t.conflicts?.length) lines.push("", "Watch out:", ...t.conflicts.map((c: any) => `- [${c.level}] ${c.message}`));
      lines.push(
        "",
        "Next: plan the change, then call gtv_register_task with the files/symbols you will touch (it links to this task automatically). Log progress or decisions with gtv_log_work; call gtv_finish_task when done.",
      );
      return lines.join("\n");
    }
    case "docs": {
      if (args.id) {
        const d = await client.call<any>("GET", `${p}/kb/${encodeURIComponent(args.id)}`);
        if (d.error) return `No document ${args.id}.`;
        const body = d.body.length > 30_000 ? `${d.body.slice(0, 30_000)}\n… (truncated)` : d.body;
        return `# ${d.title} [${d.type}${d.pinned ? ", core" : ""}, ${d.id}]\n\n${body}`;
      }
      if (args.query) {
        const hits = await client.call<any[]>("GET", `${p}/kb?q=${encodeURIComponent(args.query)}&limit=8`);
        if (!hits.length) return "No team document matches. Ask the Operator with gtv_ask, or your user.";
        return [
          "Matching team documents (read one in full with gtv_docs id):",
          ...hits.map((h) => `- ${h.id} [${h.type}${h.status === "unverified" ? ", unverified" : ""}] ${h.section}: ${h.snippet}`),
        ].join("\n");
      }
      const core = await client.call<any[]>("GET", `${p}/kb?core=1`);
      if (!core.length) return "The team has not marked core documents. Search with gtv_docs query, or ask with gtv_ask.";
      return ["Core project documents (follow them; read one with gtv_docs id):", ...core.map((d) => `- ${d.id} [${d.type}] ${d.title}`)].join("\n");
    }
    case "log_work": {
      const t = myTask();
      const boardId = args.task_id ?? t?.board_id;
      if (!boardId) return "No board task for this session. Pick one with gtv_pick_task or register your work with gtv_register_task first.";
      const summary = args.summary ?? undefined;
      const body = args.detail ?? args.note ?? summary;
      if (!body) return "Nothing to log: give a summary (and optionally detail).";
      await client.call("POST", `${p}/board/${encodeURIComponent(boardId)}/notes`, { body, summary, tag: args.kind });
      return `Logged on ${boardId}.`;
    }
    case "ack": {
      const c = await client.call("POST", `${p}/conflicts/${args.conflict_id}/ack`, {});
      return `Acknowledged ${c.id} (${c.subject}).`;
    }
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

function formatBoardLine(t: any, me: string): string {
  const who = t.assignee ? (t.assignee === me ? "you" : t.assignee) : "unassigned";
  const flags = [t.overdue ? "OVERDUE" : "", t.blocked ? "BLOCKED" : "", t.status === "in_progress" ? "in progress" : ""].filter(Boolean).join(", ");
  return `- ${t.id} [${t.priority}${t.due_date ? `, due ${t.due_date}` : ""}] ${t.title} — ${who}${flags ? ` (${flags})` : ""}`;
}

export function describeStatus(st: TeamState | undefined, server: string, dev: string, ws?: WorkspaceInfo): string {
  if (!st) return "gtv: not connected to the Operator server for this project.";
  const lines: string[] = [`Connected to ${server} as ${dev}${ws ? ` — project ${ws.project}, workspace ${ws.id} (${ws.label})` : ""}.`];
  const charter = charterText(st.charter);
  if (charter) lines.push("Project charter:", charter);
  lines.push("Active tasks:");
  for (const t of st.tasks) {
    const scope = t.resources.map((r) => `${r.kind}:${r.value}${r.op ? `(${r.op})` : ""}`).join(", ");
    lines.push(`- ${t.id} ${t.dev}${t.workspace_id === ws?.id ? " (you)" : ""} "${t.title}"${scope ? ` — ${scope}` : ""}`);
  }
  if (!st.tasks.length) lines.push("- none");
  const editing = st.footprints.filter((f) => f.workspace_id !== ws?.id).slice(0, 15);
  if (editing.length) lines.push("Teammates are editing:", ...editing.map((f) => `- ${f.dev}: ${f.path}`));
  const conflicts = st.conflicts.filter((c) => !ws || c.workspace_a === ws.id || c.workspace_b === ws.id);
  if (conflicts.length)
    lines.push("Open conflicts:", ...conflicts.map((c) => `- ${c.id} [${c.level} ${c.layer}${c.status === "acked" ? ", acked" : ""}] ${c.message}`));
  const snaps = st.workspaces.filter((w) => w.id !== ws?.id && w.snapshot_sha).map((w) => `${w.dev}:${w.label}`);
  if (snaps.length) lines.push(`WIP snapshots from: ${snaps.join(", ")}`);
  return lines.join("\n");
}
