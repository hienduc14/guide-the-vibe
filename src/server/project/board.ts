// Task board: work items people plan (priority, due date, assignee) and agents pick up.
// Agents' registrations link to an item (tasks.board_id), so an item's status follows the real work:
//   picked / registered → in_progress, the agent finishes → review, its code lands on main → done.
// Registering without an item creates one (source "agent"), so the board shows all work, planned or not.

import type { Db } from "../../shared/db.ts";
import { parseJson } from "../../shared/db.ts";
import type { Store } from "./store.ts";
import {
  BOARD_STATUSES,
  LEVEL_RANK,
  PRIORITIES,
  PRIORITY_RANK,
  type BoardNote,
  type NoteTag,
  NOTE_TAGS,
  oneLine,
  type BoardStatus,
  type BoardTask,
  type Level,
  type Priority,
  type Session,
  type Task,
} from "../../shared/types.ts";
import { newId, nowIso, truncate } from "../../shared/util.ts";

export interface BoardInput {
  title?: string;
  description?: string;
  priority?: Priority;
  due_date?: string | null;
  estimate_h?: number | null;
  assignee?: string | null;
  status?: BoardStatus;
  labels?: string[];
}

/** A board item with what gtv knows about it right now. */
export interface BoardView extends BoardTask {
  work: { task_id: string; dev: string; title: string; session_status: string | null; agent: string | null; last_seen: string | null }[];
  conflicts: { id: string; level: Level; status: string; with: string; message: string }[];
  /** Questions this work's agents asked that wait for a person. */
  waiting: { id: string; to_dev: string | null }[];
  /** An open high/critical conflict touches this work, or its agent waits for a person's answer: someone must act before it can go on. */
  blocked: boolean;
  overdue: boolean;
  notes_count: number;
}

const OPEN: BoardStatus[] = ["todo", "in_progress", "blocked", "review"];
const today = () => new Date().toISOString().slice(0, 10);

export class Board {
  private readonly db: Db;
  private readonly store: Store;

  constructor(db: Db, store: Store) {
    this.db = db;
    this.store = store;
  }

  // ---- reads ---------------------------------------------------------------------

  get(id: string): BoardTask | undefined {
    const r = this.db.get<Record<string, unknown>>(`SELECT * FROM board_tasks WHERE id = ?`, id);
    return r ? rowToBoard(r) : undefined;
  }

  list(filter: { open?: boolean; assignee?: string } = {}): BoardView[] {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.open) (where.push(`status IN (${OPEN.map(() => "?").join(",")})`), params.push(...OPEN));
    if (filter.assignee) (where.push("assignee = ?"), params.push(filter.assignee));
    const rows = this.db.all<Record<string, unknown>>(`SELECT * FROM board_tasks ${where.length ? "WHERE " + where.join(" AND ") : ""}`, ...params);
    return rows.map((r) => this.view(rowToBoard(r))).sort(byUrgency);
  }

  view(t: BoardTask): BoardView {
    const regs = this.db.all<{ id: string; dev: string; title: string; workspace_id: string; session_id: string; status: string }>(
      `SELECT id, dev, title, workspace_id, session_id, status FROM tasks WHERE board_id = ? ORDER BY created_at DESC`,
      t.id,
    );
    const active = regs.filter((r) => ["registered", "active", "pr_open"].includes(r.status));
    const workspaces = new Set(active.map((r) => r.workspace_id));
    const conflicts = this.store
      .conflicts("open")
      .filter((c) => workspaces.has(c.workspace_a) || workspaces.has(c.workspace_b))
      .map((c) => ({ id: c.id, level: c.level, status: c.status, with: workspaces.has(c.workspace_a) ? c.dev_b : c.dev_a, message: c.message }))
      .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
    const open = OPEN.includes(t.status);
    const sessions = new Set(active.map((r) => r.session_id));
    const waiting = sessions.size
      ? this.store
          .tickets({ status: ["waiting_human"] })
          .filter((k) => sessions.has(k.from_session))
          .map((k) => ({ id: k.id, to_dev: k.to_dev ?? null }))
      : [];
    return {
      ...t,
      work: active.map((r) => {
        const s = this.store.session(r.session_id);
        return { task_id: r.id, dev: r.dev, title: r.title, session_status: s?.status ?? null, agent: s?.agent ?? null, last_seen: s?.last_seen ?? null };
      }),
      conflicts,
      waiting,
      blocked: open && (t.status === "blocked" || waiting.length > 0 || conflicts.some((c) => c.status !== "acked" && LEVEL_RANK[c.level] >= LEVEL_RANK.high)),
      overdue: open && !!t.due_date && t.due_date < today(),
      notes_count: this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM board_notes WHERE board_id = ?`, t.id)!.n,
    };
  }

  notes(id: string): BoardNote[] {
    return this.db.all<BoardNote>(`SELECT * FROM board_notes WHERE board_id = ? ORDER BY created_at, rowid`, id);
  }

  /** Registrations (past and present) that worked on an item. */
  registrations(id: string): Task[] {
    return this.db
      .all<Record<string, unknown>>(`SELECT * FROM tasks WHERE board_id = ? ORDER BY created_at`, id)
      .map((r) => ({ ...(r as unknown as Task), resources: parseJson(r.resources, []) }));
  }

  /** The board item behind a registration, if any. */
  forTask(taskId: string): BoardTask | undefined {
    const r = this.db.get<{ board_id: string | null }>(`SELECT board_id FROM tasks WHERE id = ?`, taskId);
    return r?.board_id ? this.get(r.board_id) : undefined;
  }

  // ---- writes ---------------------------------------------------------------------

  create(input: BoardInput, by: string, source: BoardTask["source"] = "board"): BoardTask {
    if (!input.title?.trim()) throw new Error("title is required");
    const now = nowIso();
    const t: BoardTask = {
      id: newId("bt"),
      title: input.title.trim().slice(0, 200),
      description: input.description?.trim() || undefined,
      priority: checkPriority(input.priority ?? "normal"),
      due_date: checkDate(input.due_date) ?? undefined,
      estimate_h: input.estimate_h ?? undefined,
      assignee: input.assignee?.trim() || undefined,
      status: checkStatus(input.status ?? "todo"),
      source,
      created_by: by,
      labels: cleanLabels(input.labels),
      created_at: now,
      updated_at: now,
      started_at: input.status === "in_progress" ? now : undefined,
    };
    if (source === "board") this.checkAssignee(t.assignee);
    this.save(t);
    this.note(t.id, by, "system", source === "agent" ? `${by}'s agent started this work without a board item; gtv added it.` : `${by} created the task.`);
    if (t.assignee && t.assignee !== by) this.tellAssignee(t, by);
    this.store.logEvent("board_create", by, { board_id: t.id, title: t.title, priority: t.priority, assignee: t.assignee });
    this.store.changed();
    return t;
  }

  update(id: string, patch: BoardInput, by: string): BoardTask {
    const prev = this.get(id);
    if (!prev) throw new Error(`unknown board task ${id}`);
    const next: BoardTask = { ...prev, updated_at: nowIso() };
    const changes: string[] = [];
    if (patch.title !== undefined && patch.title.trim() && patch.title.trim() !== prev.title) {
      next.title = patch.title.trim().slice(0, 200);
      changes.push(`renamed it to "${next.title}"`);
    }
    if (patch.description !== undefined) next.description = patch.description.trim() || undefined;
    if (patch.priority !== undefined && patch.priority !== prev.priority) {
      next.priority = checkPriority(patch.priority);
      changes.push(`set priority ${prev.priority} → ${next.priority}`);
    }
    if (patch.due_date !== undefined && (patch.due_date || undefined) !== prev.due_date) {
      next.due_date = checkDate(patch.due_date) ?? undefined;
      changes.push(next.due_date ? `set the due date to ${next.due_date}` : "removed the due date");
    }
    if (patch.estimate_h !== undefined) next.estimate_h = patch.estimate_h ?? undefined;
    if (patch.labels !== undefined) next.labels = cleanLabels(patch.labels);
    if (patch.assignee !== undefined && (patch.assignee?.trim() || undefined) !== prev.assignee) {
      next.assignee = patch.assignee?.trim() || undefined;
      changes.push(next.assignee ? `assigned it to ${next.assignee}` : "unassigned it");
    }
    if (patch.status !== undefined && patch.status !== prev.status) {
      this.setStatus(next, checkStatus(patch.status));
      changes.push(`moved it to ${next.status}`);
    }
    if (next.assignee !== prev.assignee) this.checkAssignee(next.assignee);
    this.save(next);
    if (changes.length) this.note(id, by, "system", `${by} ${changes.join(", ")}.`);
    if (next.assignee && next.assignee !== prev.assignee && next.assignee !== by) this.tellAssignee(next, by);
    if (changes.length) this.store.logEvent("board_update", by, { board_id: id, changes });
    this.store.changed();
    return next;
  }

  /** Work goes to members only: nobody joins a project by being given a task. */
  private checkAssignee(dev: string | undefined): void {
    if (dev && !this.store.member(dev)) throw new Error(`${dev} is not a member of this project`);
  }

  remove(id: string, by: string): void {
    this.db.run(`DELETE FROM board_tasks WHERE id = ?`, id);
    this.db.run(`DELETE FROM board_notes WHERE board_id = ?`, id);
    this.db.run(`UPDATE tasks SET board_id = NULL WHERE board_id = ?`, id);
    this.store.logEvent("board_delete", by, { board_id: id });
    this.store.changed();
  }

  note(boardId: string, author: string, kind: BoardNote["kind"], body: string, extra: { tag?: NoteTag; summary?: string } = {}): BoardNote {
    if (!body.trim()) throw new Error("note is empty");
    const text = body.trim().slice(0, 4000);
    const n: BoardNote = {
      id: newId("bn"),
      board_id: boardId,
      author,
      kind,
      body: text,
      created_at: nowIso(),
      tag: extra.tag && NOTE_TAGS.includes(extra.tag) ? extra.tag : kind === "note" ? "progress" : null,
      summary: kind === "note" ? oneLine(extra.summary?.trim() || text) : null,
    };
    this.db.upsert("board_notes", n as unknown as Record<string, unknown>);
    if (kind === "note") {
      this.db.run(`UPDATE board_tasks SET updated_at = ? WHERE id = ?`, n.created_at, boardId);
      this.store.logEvent("board_note", author, { board_id: boardId, body: truncate(n.body, 300), tag: n.tag, summary: n.summary });
      this.store.changed();
    }
    return n;
  }

  /** An agent takes an item: it is assigned to the agent's developer and goes in progress. */
  pick(id: string, session: Session): BoardTask {
    const t = this.get(id);
    if (!t) throw new Error(`unknown board task ${id}`);
    if (t.status === "done" || t.status === "cancelled") throw new Error(`task ${id} is already ${t.status}`);
    if (t.assignee && t.assignee !== session.dev) throw new Error(`task ${id} is assigned to ${t.assignee}; ask them or a manager before taking it`);
    const next: BoardTask = { ...t, assignee: session.dev, picked_session: session.id, updated_at: nowIso() };
    if (t.status === "todo") this.setStatus(next, "in_progress");
    this.save(next);
    this.note(id, session.dev, "system", `${session.dev}'s agent (${session.agent}) picked the task.`);
    this.store.logEvent("board_pick", session.dev, { board_id: id, session: session.id });
    this.store.changed();
    return next;
  }

  /**
   * Which item a new registration belongs to: the one named, else the one this session picked, else a new
   * item created for it. Returns its id.
   */
  resolveFor(session: Session, reg: { title: string; goal?: string; board_id?: string }): string {
    if (reg.board_id) {
      const t = this.get(reg.board_id);
      if (!t) throw new Error(`unknown board task ${reg.board_id}`);
      return t.id;
    }
    const picked = this.db.get<{ id: string }>(
      `SELECT id FROM board_tasks WHERE picked_session = ? AND status IN ('todo','in_progress','blocked','review') ORDER BY updated_at DESC LIMIT 1`,
      session.id,
    );
    if (picked) return picked.id;
    // A new agent session in the same checkout carries on the dev's unfinished work, as long as the session
    // that registered it is no longer active: same item, no duplicate on the board.
    const carried = this.db.get<{ id: string }>(
      `SELECT b.id FROM tasks t JOIN board_tasks b ON b.id = t.board_id LEFT JOIN sessions s ON s.id = t.session_id
       WHERE t.dev = ? AND t.workspace_id = ? AND t.session_id != ? AND t.status IN ('registered','active')
         AND b.status IN ('todo','in_progress','blocked') AND (s.id IS NULL OR s.status != 'active')
       ORDER BY t.updated_at DESC LIMIT 1`,
      session.dev,
      session.workspace_id,
      session.id,
    );
    if (carried) return carried.id;
    return this.create({ title: reg.title, description: reg.goal, assignee: session.dev, status: "in_progress" }, session.dev, "agent").id;
  }

  /**
   * One-off repair: registrations made before the board existed (board_id NULL) get an item of their own, so
   * the board, "who is working" and the member list count the same work. Registrations of one dev in one
   * workspace with the same title share an item. Returns how many items were created.
   */
  adoptOrphans(): number {
    const rows = this.db.all<{
      id: string;
      dev: string;
      workspace_id: string;
      title: string;
      goal: string | null;
      status: string;
      created_at: string;
      updated_at: string;
    }>(`SELECT id, dev, workspace_id, title, goal, status, created_at, updated_at FROM tasks WHERE board_id IS NULL ORDER BY created_at`);
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = `${r.dev}\u0000${r.workspace_id}\u0000${r.title.trim().toLowerCase()}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const RANK: Record<string, number> = { registered: 4, active: 4, pr_open: 3, done: 2, abandoned: 1 };
    const STATUS: Record<string, BoardStatus> = { registered: "in_progress", active: "in_progress", pr_open: "review", done: "done", abandoned: "cancelled" };
    for (const group of groups.values()) {
      const first = group[0]!;
      const last = group[group.length - 1]!;
      const best = group.reduce((a, b) => ((RANK[b.status] ?? 0) >= (RANK[a.status] ?? 0) ? b : a));
      const status = STATUS[best.status] ?? "todo";
      const t: BoardTask = {
        id: newId("bt"),
        title: first.title.trim().slice(0, 200),
        description: last.goal?.trim() || undefined,
        priority: "normal",
        assignee: first.dev,
        status,
        source: "agent",
        created_by: first.dev,
        labels: [],
        created_at: first.created_at,
        updated_at: last.updated_at,
        started_at: first.created_at,
        done_at: status === "done" ? last.updated_at : undefined,
      };
      this.save(t);
      this.db.run(`UPDATE tasks SET board_id = ? WHERE id IN (${group.map(() => "?").join(",")})`, t.id, ...group.map((r) => r.id));
      this.db.upsert("board_notes", {
        id: newId("bn"),
        board_id: t.id,
        author: "gtv",
        kind: "system",
        body: `Added from ${first.dev}'s earlier registration (made before the task board existed).`,
        created_at: first.created_at,
      });
    }
    if (groups.size) this.store.changed();
    return groups.size;
  }

  /** A registration now works on this item. */
  onRegistered(task: Task, session: Session): void {
    if (!task.board_id) return;
    const t = this.get(task.board_id);
    if (!t) return;
    const next: BoardTask = { ...t, assignee: t.assignee ?? session.dev, updated_at: nowIso() };
    if (t.status === "todo" || t.status === "review") this.setStatus(next, "in_progress");
    this.save(next);
    if (t.source === "board" || this.notes(t.id).length > 1)
      this.note(t.id, session.dev, "system", `${session.dev}'s agent registered "${task.title}" (${task.id}) for this task.`);
    this.store.changed();
  }

  /** The agent finished or abandoned its registration. */
  onRegistrationClosed(task: Task, status: "done" | "abandoned" | "pr_open"): void {
    const t = task.board_id ? this.get(task.board_id) : undefined;
    if (!t || t.status === "done" || t.status === "cancelled") return;
    const stillActive = this.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM tasks WHERE board_id = ? AND id != ? AND status IN ('registered','active')`,
      t.id,
      task.id,
    )!.n;
    if (stillActive) return;
    const next: BoardTask = { ...t, updated_at: nowIso() };
    if (status === "abandoned") {
      this.setStatus(next, "todo");
      this.note(t.id, task.dev, "system", `${task.dev}'s agent stopped working on it; back to To do.`);
    } else {
      this.setStatus(next, "review");
      this.note(
        t.id,
        task.dev,
        "system",
        `${task.dev}'s agent finished${status === "pr_open" ? " and opened a pull request" : ""}; waiting for the code to reach main.`,
      );
    }
    this.save(next);
    this.store.changed();
  }

  /** The work of these registrations reached main. */
  onMerged(tasks: Task[], commit: string): void {
    for (const id of new Set(tasks.map((t) => t.board_id).filter(Boolean) as string[])) {
      const t = this.get(id);
      if (!t || t.status === "done" || t.status === "cancelled") continue;
      const next: BoardTask = { ...t, updated_at: nowIso() };
      this.setStatus(next, "done");
      this.save(next);
      this.note(id, "gtv", "system", `The work reached main (${commit.slice(0, 8)}).`);
    }
    this.store.changed();
  }

  // ---- helpers ------------------------------------------------------------------------

  private setStatus(t: BoardTask, status: BoardStatus): void {
    t.status = status;
    if (status === "in_progress" && !t.started_at) t.started_at = nowIso();
    if (status === "done") t.done_at = nowIso();
    else t.done_at = undefined;
  }

  private save(t: BoardTask): void {
    this.db.upsert("board_tasks", { ...t, labels: t.labels } as unknown as Record<string, unknown>);
  }

  private tellAssignee(t: BoardTask, by: string): void {
    this.store.addMessage({
      to_dev: t.assignee!,
      kind: "info",
      ref_id: t.id,
      from_dev: by,
      body: `[gtv task ${t.id} assigned to you by ${by} · priority ${t.priority}${t.due_date ? ` · due ${t.due_date}` : ""}] ${t.title}${t.description ? `\n${truncate(t.description, 400)}` : ""}\nWhen you start it, pick it with gtv_pick_task (task_id "${t.id}").`,
    });
  }
}

/** Most urgent first: blocked/overdue work, then priority, then due date, then oldest. */
export function byUrgency(a: BoardView, b: BoardView): number {
  return (
    Number(b.blocked) - Number(a.blocked) ||
    Number(b.overdue) - Number(a.overdue) ||
    PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
    (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
    a.created_at.localeCompare(b.created_at)
  );
}

function rowToBoard(r: Record<string, unknown>): BoardTask {
  const out = { ...(r as unknown as BoardTask), labels: parseJson<string[]>(r.labels, []) };
  for (const k of Object.keys(out) as (keyof BoardTask)[]) if (out[k] === null) delete out[k];
  return out;
}

function checkPriority(p: string): Priority {
  if (!PRIORITIES.includes(p as Priority)) throw new Error(`priority must be one of ${PRIORITIES.join(", ")}`);
  return p as Priority;
}

function checkStatus(s: string): BoardStatus {
  if (!BOARD_STATUSES.includes(s as BoardStatus)) throw new Error(`status must be one of ${BOARD_STATUSES.join(", ")}`);
  return s as BoardStatus;
}

function checkDate(d: string | null | undefined): string | null {
  if (!d) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error("due_date: YYYY-MM-DD");
  return d;
}

function cleanLabels(labels: string[] | undefined): string[] {
  return [...new Set((labels ?? []).map((l) => String(l).trim().toLowerCase()).filter(Boolean))].slice(0, 10);
}
