import { useState } from "react";
import { api } from "../../api/endpoints";
import type { BoardStatus, Member, Priority } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { useAuth } from "../../hooks/useAuth";
import { useProject } from "./ProjectLayout";
import { Field } from "../../components/Field";
import { Loading } from "../../components/Empty";
import { AgentBadge, LevelBadge, StatusBadge } from "../../components/Badge";
import { ConfirmButton } from "../../components/ConfirmButton";
import { Avatar } from "../../components/Member";
import { DueChip, PRIORITIES, PRIORITY_INFO, PriorityBadge, STATUS_INFO } from "../../components/Task";
import { ago } from "../../lib/format";

const STATUSES: BoardStatus[] = ["todo", "in_progress", "blocked", "review", "done", "cancelled"];

/** One board item: edit it (managers), see the agents on it, its conflicts and its work log. */
export function TaskDialog({ taskId, members, onClose }: { taskId: string; members: Member[]; onClose: () => void }) {
  const { id } = useProject();
  const { can } = useAuth();
  const run = useAction();
  const { data: t, reload } = usePoll(() => api.board.get(id, taskId), [id, taskId], 5000);
  const [note, setNote] = useState("");
  const [desc, setDesc] = useState<string>();
  const manage = can("manager");

  const update = async (patch: Parameters<typeof api.board.update>[2], msg = "Đã lưu") => {
    await run(() => api.board.update(id, taskId, patch), msg);
    void reload();
  };

  return (
    <div className="dialog-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-label={t?.title ?? "Việc"}>
        <div className="dialog-head">
          <div className="stack tight" style={{ minWidth: 0, gap: 4 }}>
            <span className="xs faint mono">{taskId}</span>
            <h3 className="wrap-anywhere">{t?.title ?? "…"}</h3>
          </div>
          <span className="spacer" />
          <button className="btn sm ghost" type="button" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>
        {!t ? (
          <Loading />
        ) : (
          <div className="dialog-body">
            <div className="task-facts">
              <Field label="Trạng thái">
                {manage ? (
                  <select className="input sm" value={t.status} onChange={(e) => void update({ status: e.target.value as BoardStatus })}>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_INFO[s].label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span>{STATUS_INFO[t.status].label}</span>
                )}
              </Field>
              <Field label="Ưu tiên">
                {manage ? (
                  <select className="input sm" value={t.priority} onChange={(e) => void update({ priority: e.target.value as Priority })}>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_INFO[p].label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <PriorityBadge priority={t.priority} />
                )}
              </Field>
              <Field label="Giao cho">
                {manage ? (
                  <select className="input sm" value={t.assignee ?? ""} onChange={(e) => void update({ assignee: e.target.value || null }, "Đã giao việc")}>
                    <option value="">— chưa giao —</option>
                    {members.map((m) => (
                      <option key={m.dev} value={m.dev}>
                        {m.dev}
                      </option>
                    ))}
                    {t.assignee && !members.some((m) => m.dev === t.assignee) && <option value={t.assignee}>{t.assignee}</option>}
                  </select>
                ) : (
                  <span>{t.assignee ?? "chưa giao"}</span>
                )}
              </Field>
              <Field label="Hạn">
                {manage ? (
                  <input className="input sm" type="date" value={t.due_date ?? ""} onChange={(e) => void update({ due_date: e.target.value || null })} />
                ) : (
                  <DueChip date={t.due_date} done={t.status === "done"} />
                )}
              </Field>
            </div>
            {t.blocked && (
              <div className="notice warn small">
                Việc này đang đụng việc khác ở mức high/critical. Xem conflict bên dưới; người quyết rồi bấm “đã biết” ở tab Conflicts.
              </div>
            )}

            <section className="stack tight">
              <span className="label-caps">Mô tả</span>
              {manage && desc !== undefined ? (
                <>
                  <textarea className="textarea" rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} />
                  <div className="row">
                    <button
                      className="btn sm primary"
                      type="button"
                      onClick={async () => {
                        await update({ description: desc });
                        setDesc(undefined);
                      }}
                    >
                      Lưu
                    </button>
                    <button className="btn sm ghost" type="button" onClick={() => setDesc(undefined)}>
                      Huỷ
                    </button>
                  </div>
                </>
              ) : (
                <p className="small pre-wrap" onDoubleClick={() => manage && setDesc(t.description ?? "")}>
                  {t.description || <span className="faint">Chưa có mô tả.</span>}{" "}
                  {manage && (
                    <button className="btn sm ghost" type="button" onClick={() => setDesc(t.description ?? "")}>
                      Sửa
                    </button>
                  )}
                </p>
              )}
            </section>

            {(t.work.length > 0 || t.conflicts.length > 0) && (
              <section className="stack tight">
                <span className="label-caps">Đang diễn ra</span>
                {t.work.map((w) => (
                  <div key={w.task_id} className="row" style={{ gap: 8 }}>
                    <Avatar name={w.dev} size={22} />
                    <b className="small">{w.dev}</b>
                    {w.agent && <AgentBadge agent={w.agent} />}
                    {w.session_status && <StatusBadge status={w.session_status} />}
                    <span className="small muted truncate">{w.title}</span>
                  </div>
                ))}
                {t.conflicts.map((c) => (
                  <div key={c.id} className="row top" style={{ gap: 8 }}>
                    <LevelBadge level={c.level} />
                    <span className="small">{c.message}</span>
                  </div>
                ))}
              </section>
            )}

            <section className="stack tight">
              <span className="label-caps">Nhật ký</span>
              <ol className="timeline">
                {t.notes.map((n) => (
                  <li key={n.id} className={n.kind}>
                    <span className="xs faint">
                      {n.kind === "note" ? <b className="fg">{n.author}</b> : "gtv"} · {ago(n.created_at)}
                    </span>
                    <span className="small pre-wrap">{n.body}</span>
                  </li>
                ))}
              </ol>
              {manage && (
                <form
                  className="row"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const ok = await run(() => api.board.note(id, taskId, note));
                    if (ok) {
                      setNote("");
                      void reload();
                    }
                  }}
                >
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Ghi chú cho việc này (agent đọc khi nhận việc)"
                  />
                  <button className="btn" type="submit" disabled={!note.trim()}>
                    Ghi
                  </button>
                </form>
              )}
            </section>

            <div className="row between">
              <span className="xs faint">
                Tạo {ago(t.created_at)} bởi {t.created_by}
                {t.started_at ? ` · bắt đầu ${ago(t.started_at)}` : ""}
                {t.done_at ? ` · xong ${ago(t.done_at)}` : ""}
                {t.estimate_h ? ` · ước lượng ${t.estimate_h} giờ` : ""}
              </span>
              {manage && (
                <ConfirmButton
                  onConfirm={async () => {
                    await run(() => api.board.remove(id, taskId), "Đã xoá việc");
                    onClose();
                  }}
                >
                  Xoá việc
                </ConfirmButton>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
