// Trao đổi: what agents wrote, asked and were told, one thread per task. Questions an agent asked while on a task,
// and clashes touching that task's work, show inside the task's thread with a link to act on them.

import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, ChevronRight, CircleHelp, Send, Sparkles, Zap } from "lucide-react";
import { api } from "../../api/endpoints";
import type { ChatEntry, Incident, Thread } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { useProject } from "./ProjectLayout";
import { Av, Avs, Blank, usePc } from "../../components/pj";
import { Loading } from "../../components/Empty";
import { NOTE_TAG } from "../../components/Message";
import { STATUS_INFO } from "../../components/Task";
import { incidentTitle } from "../../lib/incident";
import { ago, clock } from "../../lib/format";

interface Msg {
  id: string;
  from: string;
  at: string;
  tag: string; // progress | decision | blocker | question | done | clash | note | answer
  text: string;
  more?: string;
  link?: { to: string; label: string };
  delivered_at?: string | null;
  to?: string | null;
  /** Written by a person on the dashboard, not by an agent. */
  human?: boolean;
}
interface Conv {
  id: string;
  title: string;
  status: string;
  who: string;
  people: string[];
  msgs: Msg[];
  summary?: string;
  updated_at: string;
  boardId?: string;
}

const TAG_LABEL: Record<string, string> = {
  ...Object.fromEntries(Object.entries(NOTE_TAG).map(([k, v]) => [k, v.label.toLowerCase()])),
  clash: "đụng nhau",
  note: "ghi chú",
  answer: "trả lời",
  question: "câu hỏi",
};
const TAG_CHIP: Record<string, string> = { blocker: "clash", clash: "clash", question: "warn", done: "ok", answer: "ok" };

function entryMsg(e: ChatEntry): Msg {
  const line = e.summary?.trim();
  const tag =
    e.kind === "work"
      ? (e.tag ?? "progress")
      : e.kind === "question" || e.kind === "forward" || e.kind === "human"
        ? "question"
        : e.kind === "answer"
          ? "answer"
          : e.kind === "conflict"
            ? "clash"
            : "note";
  return {
    id: e.id,
    from: e.from,
    at: e.at,
    tag,
    text: line || e.body,
    more: line && e.body.trim().length > line.length + 10 ? e.body : undefined,
    delivered_at: e.delivered_at,
    to: e.to,
    human: e.kind === "note" || e.kind === "task",
  };
}

function build(projectId: string, threads: Thread[], incidents: Incident[]): Conv[] {
  const byBoard = new Map<string, Thread[]>();
  for (const t of threads) if (t.kind === "question" && t.board_id) byBoard.set(t.board_id, [...(byBoard.get(t.board_id) ?? []), t]);
  const out: Conv[] = [];
  for (const t of threads) {
    if (t.kind === "question" && t.board_id && threads.some((x) => x.id === t.board_id)) continue;
    const msgs = t.entries.filter((e) => e.kind !== "forward" || t.kind !== "question").map(entryMsg);
    if (t.kind === "task") {
      for (const q of byBoard.get(t.id) ?? []) {
        const first = q.entries[0];
        msgs.push({
          id: q.id,
          from: first?.from ?? "?",
          at: q.started_at,
          tag: "question",
          text: first?.summary ?? q.title,
          more: first?.body,
          link: ["waiting_human", "forwarded"].includes(q.status) ? { to: `/p/${projectId}/inbox?i=${q.id}`, label: "Trả lời" } : undefined,
        });
        const ans = q.entries.find((e) => e.kind === "answer");
        if (ans) msgs.push({ ...entryMsg(ans), tag: "answer" });
      }
      for (const i of incidents.filter((x) => x.board_ids.includes(t.id)))
        msgs.push({
          id: i.id,
          from: "gtv",
          at: i.created_at,
          tag: "clash",
          text: `${incidentTitle(i)} (${i.dev_a} và ${i.dev_b}).`,
          link: { to: `/p/${projectId}/inbox?i=${i.id}`, label: i.status === "open" ? "Xem vụ đụng nhau" : "Đã xử lý, xem lại" },
        });
    }
    msgs.sort((a, b) => a.at.localeCompare(b.at));
    if (!msgs.length) continue;
    const people = [...new Set(msgs.map((m) => m.from).filter((f) => f !== "gtv" && f !== "operator"))];
    out.push({
      id: t.id,
      title: t.title,
      status: t.status,
      who: t.participants[0] ?? people[0] ?? "",
      people,
      msgs,
      summary: t.ai_summary?.text,
      updated_at: msgs.at(-1)!.at,
      boardId: t.kind === "task" ? t.id : undefined,
    });
  }
  return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

const FILTERS: [string, string][] = [
  ["all", "Tất cả"],
  ["question", "Có câu hỏi"],
  ["clash", "Có đụng nhau"],
  ["decision", "Có quyết định"],
];

export function TalkPage() {
  const { id, detail } = useProject();
  const { manage } = useProject();
  const run = useAction();
  const pc = usePc();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState("all");
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const threads = usePoll(() => api.projects.conversations(id, 100, ["task", "question", "note"]), [id], 8000);
  const incs = usePoll(() => api.incidents.list(id, true), [id], 15_000);
  const convs = useMemo(() => (threads.data && incs.data ? build(id, threads.data, incs.data) : null), [id, threads.data, incs.data]);
  if (!convs) return <Loading />;
  const list = convs.filter((c) => filter === "all" || c.msgs.some((m) => m.tag === filter));
  const cur = list.find((c) => c.id === params.get("t")) ?? list[0];
  const select = (cid: string) => {
    const next = new URLSearchParams(params);
    next.set("t", cid);
    setParams(next, { replace: true });
  };
  const recipient = to || cur?.who || detail.members[0]?.dev || "";

  return (
    <>
      <div className="head">
        <div>
          <h1>Trao đổi</h1>
          <p className="lead">Agent ghi gì, hỏi gì, gtv báo gì, xếp theo từng việc.</p>
        </div>
        <div className="tools">
          <div className="filters">
            {FILTERS.map(([k, l]) => (
              <button key={k} type="button" className={`fchip${filter === k ? " on" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="talk">
        <section className="panel list">
          {list.length === 0 ? (
            <Blank title="Không có trao đổi nào khớp bộ lọc" />
          ) : (
            list.map((c) => (
              <button type="button" key={c.id} className={`p-row${cur?.id === c.id ? " sel" : ""}`} onClick={() => select(c.id)}>
                <span style={{ gridRow: "span 2", alignSelf: "center" }}>
                  <Avs people={c.people.slice(0, 3).map((w) => ({ who: w }))} />
                </span>
                <span className="t">{c.title}</span>
                <span className="when">{ago(c.updated_at)}</span>
                <span className="s">
                  {c.msgs.some((m) => m.tag === "question") && (
                    <span className="p-chip warn">
                      <CircleHelp />
                      câu hỏi
                    </span>
                  )}
                  {c.msgs.some((m) => m.tag === "clash") && (
                    <span className="p-chip clash">
                      <Zap />
                      đụng nhau
                    </span>
                  )}
                  <span>{c.msgs.length} tin</span>
                </span>
              </button>
            ))
          )}
        </section>
        {cur && (
          <section className="panel p-chat">
            <div className="chead">
              <div>
                <h2>{cur.title}</h2>
                <span className="muted">
                  {cur.boardId ? (STATUS_INFO[cur.status as keyof typeof STATUS_INFO]?.label ?? cur.status) : "Câu hỏi và ghi chú ngoài bảng việc"}
                  {cur.who ? ` · ${cur.who}` : ""}
                </span>
              </div>
              {cur.boardId && (
                <Link className="p-btn sm" style={{ marginLeft: "auto" }} to={`/p/${id}/work?task=${cur.boardId}`}>
                  Mở việc
                </Link>
              )}
            </div>
            {cur.summary && (
              <div className="aibox sum">
                <b>
                  <Sparkles />
                  Tóm tắt của AI
                </b>
                {cur.summary}
              </div>
            )}
            <div className="stream">
              {cur.msgs.map((m) => (
                <div key={m.id} className={`msg${m.tag === "question" ? " q" : m.tag === "clash" ? " sys" : ""}`} style={pc(m.from)}>
                  <Av who={m.from} />
                  <div className="h">
                    <b>{m.from === "operator" ? "AI của gtv" : m.from}</b>
                    {m.from !== "gtv" && m.from !== "operator" && <span>{m.human ? "nhắn từ dashboard" : "agent"}</span>}
                    <span className={`p-chip ${TAG_CHIP[m.tag] ?? ""}`}>{TAG_LABEL[m.tag] ?? m.tag}</span>
                    <span>
                      {ago(m.at)} · {clock(m.at)}
                    </span>
                    {m.delivered_at !== undefined && m.to && (
                      <span title={m.delivered_at ? `Agent của ${m.to} đã nhận` : `Agent của ${m.to} chưa nhận`}>
                        {m.delivered_at ? (
                          <>
                            <Check size={12} /> {m.to} đã đọc
                          </>
                        ) : (
                          `${m.to} chưa đọc`
                        )}
                      </span>
                    )}
                  </div>
                  <div className="bub">
                    {m.text}
                    {m.more && (
                      <details>
                        <summary>Chi tiết</summary>
                        <p className="pre">{m.more}</p>
                      </details>
                    )}
                    {m.link && (
                      <>
                        <br />
                        <Link className="p-link" to={m.link.to}>
                          {m.link.label}
                          <ChevronRight />
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {manage && (
              <form
                className="composer"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await run(() => api.projects.message(id, recipient, text, cur.boardId ?? cur.id), `Đã gửi. Agent của ${recipient} sẽ đọc ở lượt kế tiếp`)
                  ) {
                    setText("");
                    void threads.reload();
                  }
                }}
              >
                <select value={recipient} onChange={(e) => setTo(e.target.value)} aria-label="Gửi tới">
                  {detail.members.map((m) => (
                    <option key={m.dev}>{m.dev}</option>
                  ))}
                </select>
                <input
                  className="p-input"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Nhắn vào agent của người này"
                  aria-label="Tin nhắn"
                />
                <button type="submit" className="p-btn primary" disabled={!text.trim() || !recipient}>
                  <Send />
                  Gửi
                </button>
              </form>
            )}
          </section>
        )}
      </div>
    </>
  );
}
