import { useState, type FormEvent } from "react";
import { api } from "../../api/endpoints";
import type { BoardInput, BoardStatus, BoardView, Priority } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { useAuth } from "../../hooks/useAuth";
import { useProject } from "./ProjectLayout";
import { Card } from "../../components/Card";
import { Field } from "../../components/Field";
import { Loading } from "../../components/Empty";
import { LevelBadge } from "../../components/Badge";
import { Avatar } from "../../components/Member";
import { DueChip, PRIORITIES, PRIORITY_INFO, PriorityBadge, STATUS_INFO } from "../../components/Task";
import { TaskDialog } from "./TaskDialog";

const COLUMNS: BoardStatus[] = ["todo", "in_progress", "blocked", "review", "done"];

/** The column a card shows in: a live high/critical conflict pulls in-progress work into "Bị chặn". */
export const columnOf = (t: BoardView): BoardStatus => (t.status === "in_progress" && t.blocked ? "blocked" : t.status);

export function TaskCard({ t, onOpen }: { t: BoardView; onOpen: () => void }) {
  const live = t.work.filter((w) => w.session_status === "active");
  const worst = t.conflicts[0];
  return (
    <button type="button" className={`tcard p-${t.priority}${t.blocked ? " blocked" : ""}`} onClick={onOpen}>
      <span className="tcard-top">
        <PriorityBadge priority={t.priority} />
        {t.source === "agent" && (
          <span className="xs faint" title="Agent tự đăng ký việc này, không có trên bảng trước">
            agent tự thêm
          </span>
        )}
        <span className="spacer" />
        <DueChip date={t.due_date} done={t.status === "done"} />
      </span>
      <span className="tcard-title">{t.title}</span>
      {worst && (
        <span className="row" style={{ gap: 6 }} title={worst.message}>
          <LevelBadge level={worst.level} />
          <span className="xs muted truncate">đụng {worst.with}</span>
        </span>
      )}
      <span className="tcard-foot">
        {t.assignee ? (
          <span className="row" style={{ gap: 6 }}>
            <Avatar name={t.assignee} size={20} />
            <span className="xs">{t.assignee}</span>
          </span>
        ) : (
          <span className="xs faint">chưa giao</span>
        )}
        <span className="spacer" />
        {live.length > 0 && <span className="dot on" title={`Agent đang chạy: ${live.map((w) => w.dev).join(", ")}`} />}
        {t.notes_count > 0 && <span className="xs faint">{t.notes_count} ghi chép</span>}
      </span>
    </button>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const { id, detail } = useProject();
  const run = useAction();
  const [f, setF] = useState<{ title: string; description: string; priority: Priority; due_date: string; assignee: string; estimate_h: string }>({
    title: "",
    description: "",
    priority: "normal",
    due_date: "",
    assignee: "",
    estimate_h: "",
  });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input: BoardInput = {
      title: f.title,
      description: f.description,
      priority: f.priority,
      due_date: f.due_date || null,
      assignee: f.assignee || null,
      estimate_h: f.estimate_h ? Number(f.estimate_h) : null,
    };
    const ok = await run(() => api.board.create(id, input), f.assignee ? `Đã giao cho ${f.assignee} — agent của họ được báo` : "Đã thêm việc");
    if (ok) {
      setF({ ...f, title: "", description: "", estimate_h: "" });
      onDone();
    }
  };
  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <Field label="Việc cần làm">
        <input
          className="input"
          required
          autoFocus
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
          placeholder="Thêm mã giảm giá vào giỏ hàng"
        />
      </Field>
      <Field label="Mô tả" hint="Agent đọc mô tả này khi nhận việc: ghi rõ kết quả mong muốn và tiêu chí xong.">
        <textarea className="textarea" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
      <div className="form-grid">
        <Field label="Độ ưu tiên">
          <select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority })}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_INFO[p].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Hạn">
          <input className="input" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
        </Field>
        <Field label="Giao cho">
          <select className="input" value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })}>
            <option value="">— ai rảnh thì nhận —</option>
            {detail.members.map((m) => (
              <option key={m.dev} value={m.dev}>
                {m.dev} ({m.role})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ước lượng (giờ)">
          <input className="input" type="number" min="0" step="0.5" value={f.estimate_h} onChange={(e) => setF({ ...f, estimate_h: e.target.value })} />
        </Field>
      </div>
      <div className="row">
        <button className="btn primary" type="submit">
          Thêm việc
        </button>
        <button className="btn ghost" type="button" onClick={onDone}>
          Đóng
        </button>
      </div>
    </form>
  );
}

export function BoardTab() {
  const { id, detail } = useProject();
  const { can } = useAuth();
  const { data, reload } = usePoll(() => api.board.list(id, "all"), [id], 5000);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string>();
  const [who, setWho] = useState("");
  if (!data) return <Loading />;

  const items = data.filter((t) => t.status !== "cancelled" && (!who || t.assignee === who || (who === "-" && !t.assignee)));
  const total = data.filter((t) => t.status !== "cancelled").length;
  const done = data.filter((t) => t.status === "done").length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const assignees = [...new Set(data.map((t) => t.assignee).filter(Boolean) as string[])].sort();

  return (
    <div className="stack">
      <div className="row between">
        <div className="progress-line" title={`${done}/${total} việc xong`}>
          <span className="progress">
            <i style={{ width: `${pct}%` }} />
          </span>
          <span className="small">
            <b>{pct}%</b> · {done}/{total} việc xong · {data.filter((t) => t.overdue).length} quá hạn · {data.filter((t) => t.blocked).length} bị chặn
          </span>
        </div>
        <div className="row">
          <select className="input sm" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Lọc theo người">
            <option value="">Mọi người</option>
            <option value="-">Chưa giao</option>
            {assignees.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          {can("manager") && (
            <button className="btn primary" type="button" onClick={() => setAdding((v) => !v)}>
              Thêm việc
            </button>
          )}
        </div>
      </div>

      {adding && (
        <Card title="Việc mới">
          <CreateForm
            onDone={() => {
              setAdding(false);
              void reload();
            }}
          />
        </Card>
      )}

      {total === 0 && !adding ? (
        <Card>
          <div className="empty">
            <b>Bảng việc trống</b>
            Manager thêm việc ở đây (ưu tiên, hạn, người nhận). Dev gõ <code>/gtv</code> trong Claude Code hoặc Codex để xem và nhận việc. Việc agent tự đăng ký
            cũng tự hiện ở đây.
          </div>
        </Card>
      ) : (
        <div className="kanban">
          {COLUMNS.map((col) => {
            const cards = items.filter((t) => columnOf(t) === col);
            const shown = col === "done" ? cards.sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? "")).slice(0, 15) : cards;
            return (
              <section key={col} className={`kcol k-${col}`}>
                <header title={STATUS_INFO[col].hint}>
                  <span>{STATUS_INFO[col].label}</span>
                  <span className="count">{cards.length}</span>
                </header>
                <div className="kcol-body">
                  {shown.map((t) => (
                    <TaskCard key={t.id} t={t} onOpen={() => setOpen(t.id)} />
                  ))}
                  {cards.length === 0 && (
                    <span className="xs faint" style={{ padding: 8 }}>
                      —
                    </span>
                  )}
                  {col === "done" && cards.length > shown.length && <span className="xs faint">+{cards.length - shown.length} việc cũ hơn</span>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {open && (
        <TaskDialog
          taskId={open}
          members={detail.members}
          onClose={() => {
            setOpen(undefined);
            void reload();
          }}
        />
      )}
    </div>
  );
}
