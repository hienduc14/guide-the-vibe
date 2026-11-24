// Conversations between agents, the Operator and people, grouped into threads for the dashboard's chat view:
//   question  a gtv_ask ticket: the question, the Operator's routing, the teammate's answer
//   conflict  a detected clash: what gtv told each side, acknowledgements
//   task      a board task handed to someone, and notes sent about it
//   note      a message a lead sent from the dashboard
// Built from tickets, conflicts and the messages table (every message delivered into an agent).

import type { Engine } from "./engine.ts";
import type { Conflict, Level, Message, Ticket } from "../../shared/types.ts";
import { parseJson } from "../../shared/db.ts";

export interface ChatEntry {
  id: string;
  from: string; // a developer (their agent), "operator", "gtv", or a dashboard user
  to: string | null;
  at: string;
  kind: string; // question | forward | answer | human | conflict | ack | note | task | system
  body: string;
}

export interface Thread {
  id: string;
  kind: "question" | "conflict" | "task" | "note";
  title: string;
  status: string;
  level?: Level;
  participants: string[];
  started_at: string;
  updated_at: string;
  entries: ChatEntry[];
}

const strip = (body: string) => body.replace(/^\[gtv[^\]]*\]\s*/, "").replace(/\n\(conflict [^)]*\)$/, "");

function questionThread(t: Ticket, msgs: Message[]): Thread {
  const entries: ChatEntry[] = [
    {
      id: `${t.id}:q`,
      from: t.from_dev,
      to: t.to_dev ?? "operator",
      at: t.created_at,
      kind: "question",
      body: t.question + (t.context ? `\n\n${t.context}` : ""),
    },
  ];
  for (const m of msgs) {
    const kind = m.kind === "ticket_question" ? "forward" : m.kind === "human_request" ? "human" : m.kind === "ticket_answer" ? "answer" : "note";
    // The asker's own "forwarded to X" notice adds nothing to the thread.
    if (kind === "answer" && /^Question \S+ (was forwarded|is waiting)/.test(m.body)) continue;
    entries.push({
      id: m.id,
      from: m.from_dev ?? "gtv",
      to: m.to_dev,
      at: m.created_at,
      kind,
      body: strip(m.body).replace(/\nAnswer with the gtv_reply tool[\s\S]*$/, ""),
    });
  }
  // A synchronous answer (gtv_ask returned it directly) has no message: take it from the ticket.
  if (t.answer && (t.status === "answered" || t.status === "closed" || t.status === "expired") && !entries.some((e) => e.kind === "answer"))
    entries.push({
      id: `${t.id}:a`,
      from: t.answered_by?.replace(/'s agent$| \(human\)$/, "") ?? "operator",
      to: t.from_dev,
      at: t.updated_at,
      kind: "answer",
      body: t.answer,
    });
  return finish({
    id: t.id,
    kind: "question",
    title: t.question.length > 90 ? `${t.question.slice(0, 89)}…` : t.question,
    status: t.status,
    participants: [],
    started_at: t.created_at,
    updated_at: t.updated_at,
    entries,
  });
}

function conflictThread(c: Conflict, msgs: Message[], acks: { ts: string; actor: string | null; type: string }[]): Thread {
  const entries: ChatEntry[] = [{ id: `${c.id}:d`, from: "gtv", to: null, at: c.created_at, kind: "conflict", body: c.message }];
  for (const m of msgs) entries.push({ id: m.id, from: m.from_dev ?? "gtv", to: m.to_dev, at: m.created_at, kind: "conflict", body: strip(m.body) });
  for (const a of acks)
    entries.push({
      id: `${c.id}:${a.ts}`,
      from: a.actor ?? "?",
      to: null,
      at: a.ts,
      kind: "ack",
      body: a.type === "conflict_ack" ? "đã biết, đang phối hợp" : a.type === "conflict_dismiss" ? "bỏ qua conflict này" : "mở lại",
    });
  return finish({
    id: c.id,
    kind: "conflict",
    title: `${c.dev_a} ↔ ${c.dev_b}: ${c.subject}`,
    status: c.status,
    level: c.level,
    participants: [c.dev_a, c.dev_b].filter((d) => d !== "main"),
    started_at: c.created_at,
    updated_at: c.updated_at,
    entries,
  });
}

function finish(t: Thread): Thread {
  t.entries.sort((a, b) => a.at.localeCompare(b.at));
  const people = new Set(t.participants);
  for (const e of t.entries) for (const p of [e.from, e.to]) if (p && p !== "gtv") people.add(p);
  t.participants = [...people];
  t.updated_at = t.entries.reduce((m, e) => (e.at > m ? e.at : m), t.updated_at);
  return t;
}

/** The most recently active threads. */
export function conversations(engine: Engine, limit = 40): Thread[] {
  const db = engine.db;
  const byRef = new Map<string, Message[]>();
  const loose: Message[] = [];
  for (const m of db.all<Message>(`SELECT * FROM messages ORDER BY created_at DESC LIMIT 2000`).reverse()) {
    if (m.ref_id) byRef.set(m.ref_id, [...(byRef.get(m.ref_id) ?? []), m]);
    else loose.push(m);
  }
  const threads: Thread[] = [];
  for (const t of engine.store.tickets()) {
    threads.push(questionThread(t, byRef.get(t.id) ?? []));
    byRef.delete(t.id);
  }
  const acks = new Map<string, { ts: string; actor: string | null; type: string }[]>();
  for (const e of db.all<{ ts: string; actor: string | null; type: string; payload: string }>(
    `SELECT ts, actor, type, payload FROM event_log WHERE type IN ('conflict_ack','conflict_dismiss','conflict_reopen') ORDER BY id DESC LIMIT 500`,
  )) {
    const id = parseJson<{ id?: string }>(e.payload, {}).id;
    if (id) acks.set(id, [...(acks.get(id) ?? []), e]);
  }
  for (const c of engine.store.conflicts("all").slice(0, 150)) {
    const msgs = byRef.get(c.id) ?? [];
    byRef.delete(c.id);
    if (c.level === "info" && !msgs.length) continue; // info is never sent to agents: not a conversation
    threads.push(conflictThread(c, msgs, acks.get(c.id) ?? []));
  }
  // Board tasks handed out, and notes sent about something.
  for (const [ref, msgs] of byRef) {
    const item = engine.board.get(ref);
    threads.push(
      finish({
        id: ref,
        kind: item ? "task" : "note",
        title: item ? item.title : `Ghi chú về ${ref}`,
        status: item?.status ?? "sent",
        participants: [],
        started_at: msgs[0].created_at,
        updated_at: msgs.at(-1)!.created_at,
        entries: msgs.map((m) => ({ id: m.id, from: m.from_dev ?? "gtv", to: m.to_dev, at: m.created_at, kind: item ? "task" : "note", body: strip(m.body) })),
      }),
    );
  }
  // Notes from the dashboard without a subject: one thread per recipient.
  const notes = new Map<string, Message[]>();
  for (const m of loose.filter((x) => x.kind === "info" && x.from_dev && x.from_dev !== "gtv")) notes.set(m.to_dev, [...(notes.get(m.to_dev) ?? []), m]);
  for (const [dev, msgs] of notes)
    threads.push(
      finish({
        id: `note:${dev}`,
        kind: "note",
        title: `Ghi chú gửi ${dev}`,
        status: "sent",
        participants: [],
        started_at: msgs[0].created_at,
        updated_at: msgs.at(-1)!.created_at,
        entries: msgs.map((m) => ({ id: m.id, from: m.from_dev!, to: m.to_dev, at: m.created_at, kind: "note", body: strip(m.body) })),
      }),
    );
  return threads.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, limit);
}

export interface AttentionItem {
  kind: "conflict" | "question" | "overdue" | "blocked" | "unassigned" | "stale";
  level: Level;
  title: string;
  detail: string;
  ref: string;
  at: string;
}

/** What a lead should look at now, most serious first. */
export function attention(engine: Engine): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const c of engine.store.conflicts("open"))
    if (c.status === "open" && (c.level === "high" || c.level === "critical"))
      out.push({ kind: "conflict", level: c.level, title: `${c.dev_a} ↔ ${c.dev_b}: ${c.subject}`, detail: c.message, ref: c.id, at: c.updated_at });
  for (const t of engine.store.tickets({ status: ["waiting_human"] }))
    out.push({
      kind: "question",
      level: "high",
      title: `${t.from_dev} cần ${t.to_dev ?? "một người"} quyết định`,
      detail: t.forwarded_question ?? t.question,
      ref: t.id,
      at: t.updated_at,
    });
  const stale = Date.now() - 15 * 60_000;
  for (const t of engine.store.tickets({ status: ["forwarded"] }))
    if (Date.parse(t.updated_at) < stale)
      out.push({
        kind: "question",
        level: "warning",
        title: `${t.to_dev} chưa trả lời ${t.from_dev}`,
        detail: t.forwarded_question ?? t.question,
        ref: t.id,
        at: t.updated_at,
      });
  for (const b of engine.board.list({ open: true })) {
    if (b.blocked)
      out.push({
        kind: "blocked",
        level: "high",
        title: `Việc bị chặn: ${b.title}`,
        detail: b.conflicts[0]?.message ?? "Đánh dấu bị chặn",
        ref: b.id,
        at: b.updated_at,
      });
    if (b.overdue)
      out.push({
        kind: "overdue",
        level: b.priority === "urgent" || b.priority === "high" ? "high" : "warning",
        title: `Quá hạn: ${b.title}`,
        detail: `Hạn ${b.due_date}${b.assignee ? ` · ${b.assignee}` : " · chưa giao"}`,
        ref: b.id,
        at: b.updated_at,
      });
    if (!b.assignee && b.status === "todo" && (b.priority === "urgent" || b.priority === "high"))
      out.push({ kind: "unassigned", level: "warning", title: `Chưa ai nhận: ${b.title}`, detail: `Ưu tiên ${b.priority}`, ref: b.id, at: b.updated_at });
  }
  const rank: Record<Level, number> = { critical: 3, high: 2, warning: 1, info: 0 };
  return out.sort((a, b) => rank[b.level] - rank[a.level] || b.at.localeCompare(a.at));
}
