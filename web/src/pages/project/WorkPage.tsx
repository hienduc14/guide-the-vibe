// Việc: the board (five columns, blocked work says why) and its progress. A card opens in place to change its status,
// person, priority and due date; right-click gives Diễn biến (a popup), Xem trao đổi and Xoá việc.

import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowUp,
  Ban,
  CalendarDays,
  Check,
  Circle,
  CircleHelp,
  Flame,
  GitMerge,
  History,
  Inbox,
  MessagesSquare,
  PlayCircle,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import { api } from "../../api/endpoints";
import type { BoardDetail, BoardInput, BoardStatus, BoardView, Priority } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { useProject } from "./ProjectLayout";
import { useAuth } from "../../hooks/useAuth";
import { Av, Seg, State } from "../../components/pj";
import { Loading } from "../../components/Empty";
import { PRIORITIES, PRIORITY_INFO, STATUS_INFO } from "../../components/Task";
import { NOTE_TAG } from "../../components/Message";
import { Modal } from "../../components/ui";
import { ago } from "../../lib/format";
import { daysUntil } from "../../lib/charter";
import { ProgressView } from "./Progress";

const COLS: { key: BoardStatus; label: string; icon: JSX.Element }[] = [
  { key: "todo", label: "Cần làm", icon: <Circle /> },
  { key: "in_progress", label: "Đang làm", icon: <PlayCircle /> },
  { key: "blocked", label: "Bị chặn", icon: <Ban /> },
  { key: "review", label: "Chờ merge", icon: <GitMerge /> },
  { key: "done", label: "Xong", icon: <Check /> },
];
const STATUSES: BoardStatus[] = ["todo", "in_progress", "blocked", "review", "done", "cancelled"];

/** In-progress work that something blocks sits in "Bị chặn" and says why. */
export const columnOf = (t: BoardView): BoardStatus => (t.status === "in_progress" && t.blocked ? "blocked" : t.status);

function reasons(t: BoardView): { text: string; q: boolean }[] {
  const out: { text: string; q: boolean }[] = [];
  for (const w of t.waiting) out.push({ text: `Chờ ${w.to_dev ?? "một người"} trả lời`, q: true });
  const hot = [...new Set(t.conflicts.filter((c) => c.status !== "acked" && (c.level === "high" || c.level === "critical")).map((c) => c.with))];
  if (hot.length) out.push({ text: `Đụng ${hot.join(", ")}`, q: false });
  return out;
}

const shortDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function Card({
  t,
  open,
  onToggle,
  onMenu,
  onChanged,
}: {
  t: BoardView;
  open: boolean;
  onToggle: () => void;
  onMenu: (x: number, y: number) => void;
  onChanged: () => void;
}) {
  const live = t.work.find((w) => w.dev === t.assignee && w.session_status && w.session_status !== "ended");
  const why = columnOf(t) === "blocked" ? reasons(t) : [];
  return (
    <div
      className={`p-card${open ? " sel" : ""}`}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          onMenu(r.left + 16, r.top + 24);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
    >
      {why.map((w) => (
        <span key={w.text} className={`why${w.q ? " q" : ""}`}>
          {w.q ? <CircleHelp /> : <Zap />}
          {w.text}
        </span>
      ))}
      <span className="ct">{t.title}</span>
      <span className="cf">
        {t.assignee ? (
          <>
            <Av who={t.assignee} agent={live?.agent} size="sm" />
            <span>{t.assignee}</span>
            {live && <State status={live.session_status} />}
          </>
        ) : (
          <span className="p-chip warn">chưa ai nhận</span>
        )}
        <span className="sp">
          {(t.priority === "high" || t.priority === "urgent") && (
            <span className={`pri ${t.priority}`}>
              {t.priority === "urgent" ? <Flame /> : <ArrowUp />}
              {PRIORITY_INFO[t.priority].label}
            </span>
          )}
          {t.due_date && (
            <span className={`pri${t.overdue ? " urgent" : ""}`} title={t.overdue ? "Quá hạn" : undefined}>
              <CalendarDays />
              {shortDate(t.due_date)}
            </span>
          )}
        </span>
      </span>
      {open && <QuickEdit t={t} onChanged={onChanged} />}
    </div>
  );
}

/** The four things people change most, right inside the card; the rest is under right-click › Diễn biến. */
function QuickEdit({ t, onChanged }: { t: BoardView; onChanged: () => void }) {
  const { id, detail, manage, access } = useProject();
  const { me } = useAuth();
  const run = useAction();
  const update = async (patch: BoardInput, msg = "Đã lưu") => {
    if ((await run(() => api.board.update(id, t.id, patch), msg)) !== undefined) onChanged();
  };
  const why = columnOf(t) === "blocked" ? reasons(t) : [];
  // A developer updates the tasks assigned to them (status); the rest needs a manager.
  const own = manage || (access === "developer" && !!me && t.assignee === me.name);
  return (
    // clicks and keys inside the editor must not fold the card
    <div className="cx" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <dl className="p-kv">
        <dt>Trạng thái</dt>
        <dd>
          {own ? (
            <select className="p-input sm" value={t.status} onChange={(e) => void update({ status: e.target.value as BoardStatus })} aria-label="Trạng thái">
              {STATUSES.map((st) => (
                <option key={st} value={st}>
                  {STATUS_INFO[st].label}
                </option>
              ))}
            </select>
          ) : (
            STATUS_INFO[columnOf(t)].label
          )}
          {why.length > 0 && <span className="faint"> · {why.map((w) => w.text.toLowerCase()).join(", ")}</span>}
        </dd>
        <dt>Người làm</dt>
        <dd>
          {manage ? (
            <select
              className="p-input sm"
              value={t.assignee ?? ""}
              onChange={(e) => void update({ assignee: e.target.value || null }, "Đã giao việc")}
              aria-label="Người làm"
            >
              <option value="">chưa giao</option>
              {detail.members.map((m) => (
                <option key={m.dev} value={m.dev}>
                  {m.dev}
                </option>
              ))}
              {t.assignee && !detail.members.some((m) => m.dev === t.assignee) && <option value={t.assignee}>{t.assignee}</option>}
            </select>
          ) : (
            (t.assignee ?? "chưa giao")
          )}
        </dd>
        <dt>Ưu tiên</dt>
        <dd>
          {manage ? (
            <select className="p-input sm" value={t.priority} onChange={(e) => void update({ priority: e.target.value as Priority })} aria-label="Ưu tiên">
              {PRIORITIES.map((pr) => (
                <option key={pr} value={pr}>
                  {PRIORITY_INFO[pr].label}
                </option>
              ))}
            </select>
          ) : (
            PRIORITY_INFO[t.priority].label
          )}
        </dd>
        <dt>Hạn</dt>
        <dd>
          {manage ? (
            <input
              className="p-input sm"
              type="date"
              value={t.due_date ?? ""}
              onChange={(e) => void update({ due_date: e.target.value || null })}
              aria-label="Hạn"
            />
          ) : (
            (t.due_date ?? "chưa đặt")
          )}
        </dd>
      </dl>
    </div>
  );
}

/** Right-click on a card: Diễn biến, Xem trao đổi, Xoá việc. */
function CardMenu({
  x,
  y,
  t,
  onClose,
  onLog,
  onDelete,
}: {
  x: number;
  y: number;
  t: BoardView;
  onClose: () => void;
  onLog: () => void;
  onDelete?: () => void;
}) {
  const { id } = useProject();
  useEffect(() => {
    const down = (e: MouseEvent) => !(e.target as HTMLElement).closest(".ctx-menu") && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  // keep the menu on screen near the edges
  const left = Math.min(x, window.innerWidth - 220);
  const top = Math.min(y, window.innerHeight - (onDelete ? 150 : 110));
  return (
    <div className="ctx-menu" role="menu" aria-label={t.title} style={{ left, top }}>
      <button type="button" role="menuitem" autoFocus onClick={onLog}>
        <History />
        Diễn biến
      </button>
      <Link role="menuitem" to={`/p/${id}/talk?t=${t.id}`} onClick={onClose}>
        <MessagesSquare />
        Xem trao đổi
      </Link>
      {onDelete && (
        <button type="button" role="menuitem" className="danger" onClick={onDelete}>
          <Trash2 />
          Xoá việc
        </button>
      )}
    </div>
  );
}

function AddTask({ onDone }: { onDone: () => void }) {
  const { id, detail } = useProject();
  const run = useAction();
  const [f, setF] = useState({ title: "", description: "", priority: "normal" as Priority, due_date: "", assignee: "", estimate_h: "" });
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
    if (await run(() => api.board.create(id, input), f.assignee ? `Đã giao cho ${f.assignee}. Agent của ${f.assignee} được báo` : "Đã thêm việc")) onDone();
  };
  return (
    <form className="panel addtask" onSubmit={(e) => void submit(e)}>
      <div className="formgrid">
        <label className="wide">
          Việc cần làm
          <input
            className="p-input"
            required
            autoFocus
            value={f.title}
            onChange={(e) => setF({ ...f, title: e.target.value })}
            placeholder="Viết test e2e cho luồng đăng ký"
          />
        </label>
        <label className="wide">
          Mô tả <small>Kết quả mong muốn và thế nào là xong. Agent đọc phần này khi nhận việc.</small>
          <textarea className="p-textarea" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </label>
        <label>
          Ưu tiên
          <select className="p-input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority })}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_INFO[p].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Hạn
          <input className="p-input" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
        </label>
        <label>
          Giao cho
          <select className="p-input" value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })}>
            <option value="">Ai rảnh thì nhận</option>
            {detail.members.map((m) => (
              <option key={m.dev} value={m.dev}>
                {m.dev}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ước lượng (giờ)
          <input className="p-input" type="number" min="0" step="0.5" value={f.estimate_h} onChange={(e) => setF({ ...f, estimate_h: e.target.value })} />
        </label>
      </div>
      <div className="acts">
        <button type="submit" className="p-btn primary">
          <Plus />
          Thêm việc
        </button>
        <button type="button" className="p-btn quiet" onClick={onDone}>
          Đóng
        </button>
      </div>
    </form>
  );
}

const TAG_CHIP: Record<string, string> = { blocker: "clash", question: "warn", done: "ok" };

/** Diễn biến: what the task is for, what the agent registered, its notes, and where it came from. */
function TaskLog({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { id, manage, access } = useProject();
  const { me } = useAuth();
  const run = useAction();
  const { data: t, reload } = usePoll<BoardDetail>(() => api.board.get(id, taskId), [id, taskId], 5000);
  const [note, setNote] = useState("");
  const [desc, setDesc] = useState<string>();
  if (!t)
    return (
      <Modal title="Diễn biến" onClose={onClose}>
        <Loading />
      </Modal>
    );
  const update = async (patch: BoardInput, msg = "Đã lưu") => {
    await run(() => api.board.update(id, taskId, patch), msg);
    void reload();
  };
  const why = columnOf(t) === "blocked" ? reasons(t) : [];
  // A developer updates the tasks assigned to them (status, goal, notes); the rest needs a manager.
  const own = manage || (access === "developer" && !!me && t.assignee === me.name);
  return (
    <Modal title={t.title} onClose={onClose}>
      {why.length > 0 && (
        <div className="acts">
          <Link className="p-btn primary" to={`/p/${id}/inbox`}>
            <Inbox />
            Gỡ chặn ở Cần xử lý
          </Link>
        </div>
      )}
      <div className="block">
        <span className="sect">Mục tiêu</span>
        {own && desc !== undefined ? (
          <>
            <textarea className="p-textarea" value={desc} onChange={(e) => setDesc(e.target.value)} />
            <div className="acts" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="p-btn primary sm"
                onClick={async () => {
                  await update({ description: desc });
                  setDesc(undefined);
                }}
              >
                Lưu
              </button>
              <button type="button" className="p-btn quiet sm" onClick={() => setDesc(undefined)}>
                Huỷ
              </button>
            </div>
          </>
        ) : (
          <p className="pre">
            {t.description || <span className="faint">Chưa có mô tả.</span>}{" "}
            {own && (
              <button type="button" className="linkbtn" onClick={() => setDesc(t.description ?? "")}>
                Sửa
              </button>
            )}
          </p>
        )}
      </div>
      {t.registrations.filter((r) => ["registered", "active", "pr_open"].includes(r.status)).length > 0 && (
        <div className="block">
          <span className="sect">Phạm vi agent đã đăng ký</span>
          <div className="scope">
            {[
              ...new Set(
                t.registrations
                  .filter((r) => ["registered", "active", "pr_open"].includes(r.status))
                  .flatMap((r) => r.resources.map((x) => (x.kind === "contract" ? `API: ${x.value}` : x.value))),
              ),
            ].map((v) => (
              <span key={v} className="p-chip">
                {v}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="block">
        <span className="sect">Diễn biến</span>
        {t.notes.length ? (
          <ul className="tl">
            {t.notes.map((n) => (
              <li key={n.id}>
                <Av who={n.kind === "system" ? "gtv" : n.author} size="sm" />
                <div className="h">
                  <b>{n.kind === "system" ? "gtv" : n.author}</b>
                  {n.kind === "note" && <span className={`p-chip ${TAG_CHIP[n.tag ?? ""] ?? ""}`}>{NOTE_TAG[n.tag ?? "progress"]?.label ?? "ghi chú"}</span>}
                  {ago(n.created_at)}
                </div>
                <p className="pre">{n.kind === "note" && n.summary ? n.summary : n.body}</p>
                {n.kind === "note" && n.summary && n.body.trim().length > n.summary.length + 10 && (
                  <details style={{ gridColumn: 2 }}>
                    <summary>Chi tiết</summary>
                    <p className="pre">{n.body}</p>
                  </details>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Chưa có ghi chú. Agent ghi lại tiến độ và quyết định ở đây khi bắt đầu làm.</p>
        )}
        {own && (
          <form
            className="acts"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => api.board.note(id, taskId, note))) {
                setNote("");
                void reload();
              }
            }}
          >
            <input
              className="p-input"
              style={{ flex: 1 }}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ghi chú cho việc này (agent đọc khi nhận việc)"
              aria-label="Ghi chú"
            />
            <button type="submit" className="p-btn" disabled={!note.trim()}>
              Ghi
            </button>
          </form>
        )}
      </div>
      <p className="faint" style={{ marginTop: 14 }}>
        {t.source === "agent" ? "Agent tự đăng ký khi bắt đầu làm" : `${t.created_by} thêm trên bảng`} · tạo {ago(t.created_at)}
        {t.started_at ? ` · bắt đầu ${ago(t.started_at)}` : ""}
        {t.done_at ? ` · xong ${ago(t.done_at)}` : ""}
        {t.estimate_h ? ` · ước lượng ${t.estimate_h} giờ` : ""}
      </p>
    </Modal>
  );
}

export function WorkPage() {
  const { id, detail } = useProject();
  const { manage, access } = useProject();
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; t: BoardView }>();
  const [log, setLog] = useState<string>();
  const [removing, setRemoving] = useState<BoardView>();
  const run = useAction();
  // "Mine" is where a developer starts; it follows the logged-in person.
  const [who, setWho] = useState(access === "developer" ? "@me" : "");
  const board = usePoll(() => api.board.list(id, "all"), [id], 5000);
  const view = params.get("view") === "progress" ? "progress" : "board";
  const task = params.get("task");
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v === null) next.delete(k);
    else next.set(k, v);
    setParams(next);
  };
  const all = (board.data ?? []).filter((t) => t.status !== "cancelled");
  const mine = me?.kind === "user" ? me.name : undefined;
  const filter = who === "@me" ? (mine ?? "") : who;
  const shown = all.filter((t) => !filter || (filter === "-" ? !t.assignee : t.assignee === filter));
  const done = all.filter((t) => t.status === "done").length;
  const blocked = all.filter((t) => columnOf(t) === "blocked").length;
  const deadline = detail.charter.deadline;
  const left = deadline ? daysUntil(deadline) : undefined;
  const people = [...new Set([...detail.members.map((m) => m.dev), ...all.map((t) => t.assignee).filter((x): x is string => !!x)])];

  return (
    <>
      <div className="head">
        <div>
          <h1>Việc</h1>
          <p className="lead">
            <b>
              {done}/{all.length}
            </b>{" "}
            xong{blocked ? `, ${blocked} bị chặn` : ""}.
            {deadline &&
              left !== undefined &&
              ` Hạn project ${shortDate(deadline)}/${deadline.slice(0, 4)}, ${left >= 0 ? `còn ${left} ngày` : `trễ ${-left} ngày`}.`}
          </p>
        </div>
        <div className="tools">
          {view === "board" && (
            <select className="p-input" style={{ width: "auto" }} value={who} onChange={(e) => setWho(e.target.value)} aria-label="Lọc theo người">
              <option value="">Mọi người</option>
              {mine && <option value="@me">Của tôi</option>}
              <option value="-">Chưa giao</option>
              {people.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
          <Seg
            label="Cách xem"
            value={view}
            onChange={(v) => set("view", v === "board" ? null : v)}
            options={[
              ["board", "Bảng"],
              ["progress", "Tiến độ"],
            ]}
          />
          {manage && (
            <button type="button" className="p-btn primary" onClick={() => setAdding(true)}>
              <Plus />
              Thêm việc
            </button>
          )}
        </div>
      </div>
      {adding && <AddTask onDone={() => (setAdding(false), void board.reload())} />}
      {view === "progress" ? (
        <ProgressView />
      ) : !board.data ? (
        <Loading />
      ) : (
        <>
          <div className="board">
            {COLS.map((c) => {
              const list = shown.filter((t) => columnOf(t) === c.key).slice(0, c.key === "done" ? 15 : undefined);
              return (
                <section key={c.key} className={`col ${c.key}`}>
                  <h3>
                    {c.icon}
                    {c.label}
                    <span className="n">{shown.filter((t) => columnOf(t) === c.key).length}</span>
                  </h3>
                  {list.length ? (
                    list.map((t) => (
                      <Card
                        key={t.id}
                        t={t}
                        open={task === t.id}
                        onToggle={() => set("task", task === t.id ? null : t.id)}
                        onMenu={(x, y) => setMenu({ x, y, t })}
                        onChanged={() => void board.reload()}
                      />
                    ))
                  ) : (
                    <p className="p-hint">Trống</p>
                  )}
                </section>
              );
            })}
          </div>
          {menu && (
            <CardMenu
              {...menu}
              onClose={() => setMenu(undefined)}
              onLog={() => (setLog(menu.t.id), setMenu(undefined))}
              onDelete={manage ? () => (setRemoving(menu.t), setMenu(undefined)) : undefined}
            />
          )}
          {log && <TaskLog taskId={log} onClose={() => setLog(undefined)} />}
          {removing && (
            <Modal
              title="Xoá việc?"
              onClose={() => setRemoving(undefined)}
              foot={
                <>
                  <button type="button" className="p-btn quiet" onClick={() => setRemoving(undefined)}>
                    Huỷ
                  </button>
                  <button
                    type="button"
                    className="p-btn danger"
                    onClick={async () => {
                      if ((await run(() => api.board.remove(id, removing.id), "Đã xoá việc")) !== undefined) {
                        if (task === removing.id) set("task", null);
                        void board.reload();
                      }
                      setRemoving(undefined);
                    }}
                  >
                    <Trash2 size={15} />
                    Xoá việc
                  </button>
                </>
              }
            >
              <p>
                <b>{removing.title}</b> sẽ biến khỏi bảng. Ghi chú và diễn biến của việc này cũng mất.
              </p>
            </Modal>
          )}
        </>
      )}
    </>
  );
}
