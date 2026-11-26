import { useEffect, useRef, useState } from "react";
import type { ChatEntry, Member, Thread } from "../../api/types";
import { api } from "../../api/endpoints";
import { useAction } from "../../hooks/useToast";
import { useAuth } from "../../hooks/useAuth";
import { Avatar } from "../../components/Member";
import { LevelBadge, StatusBadge } from "../../components/Badge";
import { STATUS_INFO } from "../../components/Task";
import { ago } from "../../lib/format";
import { AiSummaryBox, NoteTagChip, conflictHeadline } from "../../components/Message";

export const KIND_LABEL: Record<Thread["kind"], string> = { question: "Câu hỏi", conflict: "Xung đột", task: "Việc", note: "Ghi chú" };

const ENTRY_LABEL: Record<string, string> = {
  question: "hỏi",
  forward: "Operator chuyển câu hỏi",
  answer: "trả lời",
  human: "cần người quyết",
  conflict: "cảnh báo",
  ack: "",
  note: "ghi chú",
  task: "giao việc",
  work: "",
};

/** The thread's headline: conflicts get one built from their facts, not gtv's sentence to the agents. */
export const threadTitle = (t: Thread) => (t.conflict ? conflictHeadline(t.conflict) : t.title);

/** A message as one line, with the full text behind "Chi tiết" when there is more to it. */
function EntryText({ e }: { e: ChatEntry }) {
  // What gtv told each side about a conflict is long and written for agents: keep it, folded.
  if (e.kind === "conflict")
    return (
      <details className="bubble-more">
        <summary>{e.to ? `gtv đã báo cho ${e.to}` : "gtv phát hiện"}</summary>
        <div className="bubble-text">{e.body}</div>
      </details>
    );
  const line = e.summary?.trim();
  const rest = line && e.body.trim() !== line && e.body.trim().length > line.length + 10;
  if (!line || !rest) return <div className="bubble-text">{e.body}</div>;
  return (
    <>
      <div className="bubble-text">{line}</div>
      <details className="bubble-more">
        <summary>Chi tiết</summary>
        <div className="bubble-text">{e.body}</div>
      </details>
    </>
  );
}

const isSystem = (from: string) => from === "gtv" || from === "operator";

function senderName(e: ChatEntry): string {
  if (e.from === "gtv") return "gtv";
  if (e.from === "operator") return "Operator";
  if (e.kind === "note" || e.kind === "task" || e.kind === "work") return e.from;
  return `${e.from} · agent`;
}

export function ThreadStatus({ t }: { t: Thread }) {
  if (t.kind === "task" && t.status in STATUS_INFO) return <span className="badge">{STATUS_INFO[t.status as keyof typeof STATUS_INFO].label}</span>;
  if (t.kind === "note") return null;
  return <StatusBadge status={t.status} />;
}

/** One thread as a chat: people's agents on the left/right by participant, gtv and the Operator in the middle. */
export function ChatView({ thread, projectId, members, onSent }: { thread: Thread; projectId: string; members: Member[]; onSent: () => void }) {
  const end = useRef<HTMLDivElement>(null);
  const { can } = useAuth();
  const run = useAction();
  // Messages go to developers' agents: thread participants who are members or were sent something.
  const recipients = thread.participants.filter((p) => !isSystem(p) && (members.some((m) => m.dev === p) || thread.entries.some((e) => e.to === p)));
  const [to, setTo] = useState(recipients[0] ?? "");
  const [text, setText] = useState("");
  const first = thread.participants.find((p) => !isSystem(p));
  const role = new Map(members.map((m) => [m.dev, m.role]));
  // Scroll the chat itself (not the page) to the newest message. scrollIntoView would move the page, and
  // returns a promise in recent Chrome, which React would take for a cleanup function.
  useEffect(() => {
    const body = end.current?.parentElement;
    if (body) body.scrollTop = body.scrollHeight;
  }, [thread.id, thread.entries.length]);
  useEffect(() => {
    setTo(recipients[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id]);

  return (
    <div className="chat">
      <header className="chat-head">
        <div className="stack tight" style={{ gap: 4, minWidth: 0 }}>
          <span className="row" style={{ gap: 6 }}>
            <span className="label-caps">{KIND_LABEL[thread.kind]}</span>
            {thread.level && <LevelBadge level={thread.level} />}
            <ThreadStatus t={thread} />
          </span>
          <b className="wrap-anywhere">{threadTitle(thread)}</b>
        </div>
        <span className="spacer" />
        <span className="row" style={{ gap: 2 }}>
          {thread.participants
            .filter((p) => !isSystem(p))
            .map((p) => (
              <span key={p} title={`${p}${role.get(p) ? ` — ${role.get(p)}` : ""}`}>
                <Avatar name={p} size={24} />
              </span>
            ))}
        </span>
      </header>
      <div className="chat-body">
        {thread.ai_summary && <AiSummaryBox s={thread.ai_summary} />}
        {thread.entries.map((e) => {
          if (e.kind === "ack")
            return (
              <div key={e.id} className="chat-event">
                <b>{e.from}</b> {e.body} · {ago(e.at)}
              </div>
            );
          const side = isSystem(e.from) ? "mid" : e.from === first ? "left" : "right";
          return (
            <div key={e.id} className={`bubble-row ${side}`}>
              {side !== "mid" && <Avatar name={e.from} size={28} />}
              <div className={`bubble ${side} k-${e.kind}`}>
                <div className="bubble-meta">
                  <b>{senderName(e)}</b>
                  {e.to && e.to !== e.from && <span>→ {e.to}</span>}
                  {e.kind === "work" ? <NoteTagChip tag={e.tag} /> : ENTRY_LABEL[e.kind] && <span className="faint">{ENTRY_LABEL[e.kind]}</span>}
                  <span className="faint" title={new Date(e.at).toLocaleString()}>
                    {ago(e.at)}
                  </span>
                </div>
                <EntryText e={e} />
                {e.kind === "question" && thread.options && (
                  <div className="option-chips" aria-label="Các lựa chọn">
                    {thread.options.map((o, i) => (
                      <span key={o} className="option-chip">
                        {i + 1}. {o}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {thread.options && thread.status === "waiting_human" && can("manager") && (
          <div className="chat-options">
            <span className="xs muted">Chọn một phương án để trả lời thẳng vào agent của {thread.participants.find((p) => !isSystem(p)) ?? "người hỏi"}:</span>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              {thread.options.map((o) => (
                <button
                  key={o}
                  type="button"
                  className="btn sm"
                  onClick={async () => {
                    if (await run(() => api.tickets.reply(projectId, thread.id, o), "Đã trả lời")) onSent();
                  }}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        )}
        <div ref={end} />
      </div>
      {can("manager") && (
        <form
          className="chat-compose"
          onSubmit={async (ev) => {
            ev.preventDefault();
            const ok = await run(
              () => api.projects.message(projectId, to, text.trim(), thread.id.startsWith("note:") ? undefined : thread.id),
              "Đã gửi — agent nhận ở lần gọi tool kế tiếp",
            );
            if (ok) {
              setText("");
              onSent();
            }
          }}
        >
          <select className="input sm" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Gửi tới">
            {[...new Set([...recipients, ...members.map((m) => m.dev)])].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <input
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Nhắn vào agent của người này (ví dụ: dừng phần này, đợi bob xong)"
          />
          <button className="btn primary" type="submit" disabled={!text.trim() || !to}>
            Gửi
          </button>
        </form>
      )}
    </div>
  );
}

/** A compact list row for a thread. */
export function ThreadRow({ t, active, onClick }: { t: Thread; active?: boolean; onClick: () => void }) {
  const last = t.entries.at(-1);
  return (
    <button type="button" className={`thread-row${active ? " active" : ""}`} onClick={onClick}>
      <span className="row" style={{ gap: 6 }}>
        <span className={`kind-dot k-${t.kind}${t.level ? ` lvl-${t.level}` : ""}`} />
        <span className="xs faint">{KIND_LABEL[t.kind]}</span>
        <span className="spacer" />
        <span className="xs faint">{ago(t.updated_at)}</span>
      </span>
      <span className="thread-title">{threadTitle(t)}</span>
      {t.ai_summary ? (
        <span className="xs muted truncate" title={t.ai_summary.text}>
          <b className="ai-mark">AI:</b> {t.ai_summary.text}
        </span>
      ) : (
        last && (
          <span className="xs muted truncate">
            <b>{last.from === "operator" ? "Operator" : last.from}:</b>{" "}
            {last.kind === "conflict" ? `gtv báo cho ${last.to ?? "hai bên"}` : (last.summary ?? last.body.split("\n")[0])}
          </span>
        )
      )}
    </button>
  );
}
