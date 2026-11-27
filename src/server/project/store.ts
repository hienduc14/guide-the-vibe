// Registry of workspaces, sessions, tasks, footprints, conflicts, tickets and messages.
// Emits "change" whenever team state changes and "message" for each new inbox message.

import { EventEmitter } from "node:events";
import { Db, parseJson } from "../../shared/db.ts";
import type {
  AgentCapabilities,
  Charter,
  Conflict,
  FeatureMode,
  Footprint,
  Member,
  MemberLevel,
  Message,
  Policy,
  Session,
  SessionHello,
  Task,
  TaskRegistration,
  TeamState,
  Ticket,
  Workspace,
} from "../../shared/types.ts";
import { AGENT_CAPABILITIES, LEVEL_RANK, MEMBER_LEVELS, type MemberAccess } from "../../shared/types.ts";
import { newId, nowIso, normPath } from "../../shared/util.ts";

const SESSION_IDLE_MS = 5 * 60_000;
const SESSION_END_MS = 2 * 60 * 60_000;

/** Who is in a project and their access: the hub's project_members. */
export type Team = () => { user: string; access: MemberAccess; joined_at: string }[];

export class Store extends EventEmitter {
  readonly db: Db;
  private version = 0;
  policy: Policy = { critical_paths: [], modules: {} };
  charter: Charter = {};
  features: () => Record<string, FeatureMode> = () => ({});
  /** Set by the hub; without one (an engine on its own, in tests) everyone with a profile is a developer. */
  team?: Team;

  constructor(db: Db) {
    super();
    this.db = db;
  }

  changed(): void {
    this.version++;
    this.emit("change");
  }

  logEvent(type: string, actor: string | undefined, payload: unknown): void {
    this.db.run(`INSERT INTO event_log (ts, type, actor, payload) VALUES (?,?,?,?)`, nowIso(), type, actor ?? null, JSON.stringify(payload));
  }

  // ---- workspaces / sessions -------------------------------------------------

  upsertSession(hello: SessionHello): Session {
    const now = nowIso();
    const ws = this.db.get<Workspace>(`SELECT * FROM workspaces WHERE id = ?`, hello.workspace_id);
    this.db.upsert("workspaces", {
      id: hello.workspace_id,
      dev: hello.dev,
      label: hello.workspace_label,
      branch: hello.branch ?? ws?.branch ?? null,
      snapshot_sha: ws?.snapshot_sha ?? null,
      snapshot_base: ws?.snapshot_base ?? null,
      updated_at: now,
    });
    const existing = hello.agent_session_id
      ? this.db.get<Record<string, unknown>>(`SELECT id FROM sessions WHERE agent_session_id = ? AND dev = ?`, hello.agent_session_id, hello.dev)
      : undefined;
    const session: Session = {
      id: (existing?.id as string) ?? newId("ses"),
      dev: hello.dev,
      agent: hello.agent,
      workspace_id: hello.workspace_id,
      agent_session_id: hello.agent_session_id,
      cwd: hello.cwd,
      status: "active",
      capabilities: AGENT_CAPABILITIES[hello.agent] ?? AGENT_CAPABILITIES.other,
      last_seen: now,
      device: hello.device ?? null,
    };
    this.db.upsert("sessions", { ...session, capabilities: session.capabilities });
    this.changed();
    return session;
  }

  touchSession(id: string): void {
    this.db.run(`UPDATE sessions SET last_seen = ?, status = 'active' WHERE id = ?`, nowIso(), id);
  }

  /** The agent finished its turn: idle until it does something again (touchSession). */
  idleSession(id: string): void {
    this.db.run(`UPDATE sessions SET status = 'idle' WHERE id = ? AND status = 'active'`, id);
    this.changed();
  }

  endSession(id: string): void {
    this.db.run(`UPDATE sessions SET status = 'ended' WHERE id = ?`, id);
    this.changed();
  }

  /**
   * Mark sessions idle/ended by heartbeat age. Only ever moves a session down (active → idle → ended): activity
   * (touchSession) is what makes it active again, so an agent that stopped (Stop hook) stays idle. Returns true when
   * something changed.
   */
  expireSessions(now = Date.now()): boolean {
    let changed = false;
    for (const s of this.sessions()) {
      const age = now - Date.parse(s.last_seen);
      const next = age > SESSION_END_MS ? "ended" : age > SESSION_IDLE_MS && s.status === "active" ? "idle" : s.status;
      if (next !== s.status) {
        this.db.run(`UPDATE sessions SET status = ? WHERE id = ?`, next, s.id);
        changed = true;
      }
    }
    if (changed) this.changed();
    return changed;
  }

  session(id: string): Session | undefined {
    const r = this.db.get<Record<string, unknown>>(`SELECT * FROM sessions WHERE id = ?`, id);
    return r ? rowToSession(r) : undefined;
  }

  sessions(includeEnded = false): Session[] {
    return this.db
      .all<Record<string, unknown>>(`SELECT * FROM sessions ${includeEnded ? "" : "WHERE status != 'ended'"} ORDER BY last_seen DESC`)
      .map(rowToSession);
  }

  workspace(id: string): Workspace | undefined {
    return this.db.get<Workspace>(`SELECT * FROM workspaces WHERE id = ?`, id);
  }

  workspaces(): Workspace[] {
    return this.db.all<Workspace>(`SELECT * FROM workspaces ORDER BY updated_at DESC`);
  }

  /**
   * Workspaces with at least one non-ended session, a task still in flight, or a snapshot from the last
   * two days: closing the agent leaves the uncommitted work on disk, and it can still clash.
   */
  activeWorkspaces(): Workspace[] {
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
    return this.db.all<Workspace>(
      `SELECT * FROM workspaces w WHERE EXISTS (SELECT 1 FROM sessions s WHERE s.workspace_id = w.id AND s.status != 'ended')
       OR EXISTS (SELECT 1 FROM tasks t WHERE t.workspace_id = w.id AND t.status IN ('registered','active','pr_open'))
       OR (w.snapshot_sha IS NOT NULL AND w.updated_at > ?)`,
      recent,
    );
  }

  setSnapshot(workspaceId: string, sha: string, base: string | undefined, branch?: string): void {
    this.db.run(
      `UPDATE workspaces SET snapshot_sha = ?, snapshot_base = ?, branch = COALESCE(?, branch), updated_at = ? WHERE id = ?`,
      sha,
      base ?? null,
      branch ?? null,
      nowIso(),
      workspaceId,
    );
  }

  // ---- tasks --------------------------------------------------------------------

  registerTask(session: Session, reg: TaskRegistration): Task {
    const now = nowIso();
    const task: Task = {
      id: newId("task"),
      session_id: session.id,
      workspace_id: session.workspace_id,
      dev: session.dev,
      title: reg.title,
      goal: reg.goal,
      base_sha: reg.base_sha,
      resources: (reg.resources ?? []).map((r) => ({ ...r, value: r.kind === "path" ? normPath(r.value) : r.value, source: r.source ?? "declared" })),
      board_id: reg.board_id,
      status: "active",
      created_at: now,
      updated_at: now,
    };
    // One active task per session: registering a new one supersedes the previous.
    this.db.run(`UPDATE tasks SET status = 'abandoned', updated_at = ? WHERE session_id = ? AND status IN ('registered','active')`, now, session.id);
    this.db.upsert("tasks", { ...task, resources: task.resources });
    this.changed();
    return task;
  }

  updateTask(id: string, patch: Partial<Pick<Task, "title" | "goal" | "resources" | "status">>): Task | undefined {
    const t = this.task(id);
    if (!t) return undefined;
    // Fields left out (undefined) keep their value: PATCH {status} must not wipe title or resources.
    const given = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined && v !== null));
    const next = { ...t, ...given, updated_at: nowIso() };
    this.db.upsert("tasks", { ...next, resources: next.resources });
    this.changed();
    return next;
  }

  task(id: string): Task | undefined {
    const r = this.db.get<Record<string, unknown>>(`SELECT * FROM tasks WHERE id = ?`, id);
    return r ? rowToTask(r) : undefined;
  }

  activeTasks(): Task[] {
    return this.db.all<Record<string, unknown>>(`SELECT * FROM tasks WHERE status IN ('registered','active','pr_open') ORDER BY created_at`).map(rowToTask);
  }

  sessionTask(sessionId: string): Task | undefined {
    const r = this.db.get<Record<string, unknown>>(
      `SELECT * FROM tasks WHERE session_id = ? AND status IN ('registered','active','pr_open') ORDER BY created_at DESC LIMIT 1`,
      sessionId,
    );
    return r ? rowToTask(r) : undefined;
  }

  // ---- footprints ---------------------------------------------------------------

  addFootprints(session: Session, paths: string[]): string[] {
    const now = nowIso();
    const fresh: string[] = [];
    for (const raw of paths) {
      const path = normPath(raw);
      const prev = this.db.get<{ count: number }>(`SELECT count FROM footprints WHERE workspace_id = ? AND path = ?`, session.workspace_id, path);
      if (prev) {
        this.db.run(
          `UPDATE footprints SET last_at = ?, count = count + 1, session_id = ? WHERE workspace_id = ? AND path = ?`,
          now,
          session.id,
          session.workspace_id,
          path,
        );
      } else {
        this.db.upsert("footprints", {
          workspace_id: session.workspace_id,
          session_id: session.id,
          dev: session.dev,
          path,
          first_at: now,
          last_at: now,
          count: 1,
        });
        fresh.push(path);
      }
    }
    if (fresh.length) this.changed();
    return fresh;
  }

  footprints(): Footprint[] {
    return this.db.all<Footprint>(`SELECT * FROM footprints ORDER BY last_at DESC`);
  }

  clearFootprints(workspaceId: string): void {
    this.db.run(`DELETE FROM footprints WHERE workspace_id = ?`, workspaceId);
    this.changed();
  }

  // ---- conflicts ----------------------------------------------------------------

  conflicts(status: "open" | "all" = "open"): Conflict[] {
    const rows = this.db.all<Record<string, unknown>>(
      status === "open"
        ? `SELECT * FROM conflicts WHERE status IN ('open','acked') ORDER BY updated_at DESC`
        : `SELECT * FROM conflicts ORDER BY updated_at DESC`,
    );
    return rows.map(rowToConflict);
  }

  conflict(id: string): Conflict | undefined {
    const r = this.db.get<Record<string, unknown>>(`SELECT * FROM conflicts WHERE id = ? OR key = ?`, id, id);
    return r ? rowToConflict(r) : undefined;
  }

  /**
   * Replace all conflicts of `layer` within `scope` (a predicate over existing rows) by `found`.
   * Returns conflicts that are new or whose level increased (these deserve a notification).
   */
  syncConflicts(layer: string, found: Omit<Conflict, "id" | "status" | "created_at" | "updated_at">[], inScope: (c: Conflict) => boolean): Conflict[] {
    const now = nowIso();
    const existing = new Map(
      this.conflicts("all")
        .filter((c) => c.layer === layer && inScope(c))
        .map((c) => [c.key, c]),
    );
    const notify: Conflict[] = [];
    for (const f of found) {
      const prev = existing.get(f.key);
      existing.delete(f.key);
      if (prev && prev.status === "dismissed" && JSON.stringify(prev.evidence) === JSON.stringify(f.evidence)) continue;
      const reopened = prev && (prev.status === "resolved" || prev.status === "dismissed");
      const escalated = prev && LEVEL_RANK[f.level] > LEVEL_RANK[prev.level];
      const row: Conflict = {
        ...f,
        id: prev?.id ?? newId("cf"),
        status: !prev || reopened ? "open" : prev.status === "acked" && !escalated ? "acked" : "open",
        created_at: prev?.created_at ?? now,
        updated_at: now,
      };
      this.db.upsert("conflicts", { ...row, evidence: row.evidence });
      if (!prev || reopened || escalated) notify.push(row);
    }
    for (const stale of existing.values()) {
      if (stale.status === "open" || stale.status === "acked") {
        this.db.run(`UPDATE conflicts SET status = 'resolved', updated_at = ? WHERE id = ?`, now, stale.id);
      }
    }
    if (notify.length || existing.size) this.changed();
    return notify;
  }

  setConflictStatus(id: string, status: Conflict["status"]): Conflict | undefined {
    const c = this.conflict(id);
    if (!c) return undefined;
    this.db.run(`UPDATE conflicts SET status = ?, updated_at = ? WHERE id = ?`, status, nowIso(), c.id);
    this.changed();
    return { ...c, status };
  }

  // ---- members -------------------------------------------------------------------

  /** The team (from the hub, with access) joined with each member's profile here; a member without one gets the defaults. */
  members(): Member[] {
    const profiles = new Map(this.db.all<Member>(`SELECT dev, role, level, note, created_at, updated_at FROM members`).map((m) => [m.dev, m]));
    const team = this.team?.() ?? [...profiles.keys()].map((user) => ({ user, access: "developer" as const, joined_at: "" }));
    return team.map(({ user, access, joined_at }) => ({
      ...(profiles.get(user) ?? { dev: user, role: "developer", level: "mid" as MemberLevel, created_at: joined_at, updated_at: joined_at }),
      note: profiles.get(user)?.note ?? undefined,
      access,
    }));
  }

  member(dev: string): Member | undefined {
    return this.members().find((m) => m.dev === dev);
  }

  /** A member's profile in this project: their role in the team, level and a note for the Operator. */
  saveMember(dev: string, input: { role?: string; level?: MemberLevel; note?: string }): Member {
    if (!/^[a-zA-Z0-9._-]{1,40}$/.test(dev)) throw new Error("dev name: letters, digits, . _ -");
    if (input.level && !MEMBER_LEVELS.includes(input.level)) throw new Error(`level must be one of ${MEMBER_LEVELS.join(", ")}`);
    const prev = this.db.get<Member>(`SELECT dev, role, level, note, created_at, updated_at FROM members WHERE dev = ?`, dev);
    const now = nowIso();
    const profile = {
      dev,
      role: (input.role ?? prev?.role ?? "developer").trim() || "developer",
      level: input.level ?? prev?.level ?? "mid",
      note: input.note ?? prev?.note ?? null,
      created_at: prev?.created_at ?? now,
      updated_at: now,
    };
    this.db.upsert("members", profile);
    this.changed();
    return this.member(dev) ?? { ...profile, note: profile.note ?? undefined, access: "developer" };
  }

  // ---- messages -----------------------------------------------------------------

  addMessage(m: Omit<Message, "id" | "created_at">): Message {
    const msg: Message = { ...m, from_dev: m.from_dev ?? "gtv", id: newId("msg"), created_at: nowIso() };
    this.db.upsert("messages", msg as unknown as Record<string, unknown>);
    this.emit("message", msg);
    return msg;
  }

  pendingMessages(dev: string): Message[] {
    return this.db.all<Message>(`SELECT * FROM messages WHERE to_dev = ? AND delivered_at IS NULL ORDER BY created_at`, dev);
  }

  markDelivered(ids: string[]): void {
    const now = nowIso();
    for (const id of ids) this.db.run(`UPDATE messages SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL`, now, id);
  }

  // ---- tickets ------------------------------------------------------------------

  saveTicket(t: Ticket): void {
    this.db.upsert("tickets", { ...t, sources: t.sources });
  }

  ticket(id: string): Ticket | undefined {
    const r = this.db.get<Record<string, unknown>>(`SELECT * FROM tickets WHERE id = ?`, id);
    return r ? rowToTicket(r) : undefined;
  }

  tickets(filter: { status?: string[]; to_dev?: string; from_dev?: string } = {}): Ticket[] {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.status?.length) {
      where.push(`status IN (${filter.status.map(() => "?").join(",")})`);
      params.push(...filter.status);
    }
    if (filter.to_dev) {
      where.push("to_dev = ?");
      params.push(filter.to_dev);
    }
    if (filter.from_dev) {
      where.push("from_dev = ?");
      params.push(filter.from_dev);
    }
    return this.db
      .all<Record<string, unknown>>(`SELECT * FROM tickets ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT 200`, ...params)
      .map(rowToTicket);
  }

  // ---- snapshot of everything daemons need ---------------------------------------

  teamState(): TeamState {
    return {
      version: this.version,
      workspaces: this.workspaces(),
      sessions: this.sessions(),
      tasks: this.activeTasks(),
      recent_done: this.db
        .all<Record<string, unknown>>(
          `SELECT * FROM tasks WHERE status = 'done' AND updated_at > ? ORDER BY updated_at`,
          new Date(Date.now() - 2 * 3600_000).toISOString(),
        )
        .map(rowToTask),
      footprints: this.footprints(),
      conflicts: this.conflicts("open"),
      features: this.features(),
      policy: this.policy,
      charter: this.charter,
    };
  }
}

function rowToSession(r: Record<string, unknown>): Session {
  return { ...(r as unknown as Session), capabilities: parseJson<AgentCapabilities>(r.capabilities, AGENT_CAPABILITIES.other) };
}

function rowToTask(r: Record<string, unknown>): Task {
  return { ...(r as unknown as Task), resources: parseJson(r.resources, []) };
}

function rowToConflict(r: Record<string, unknown>): Conflict {
  return { ...(r as unknown as Conflict), evidence: parseJson(r.evidence, {}) };
}

function rowToTicket(r: Record<string, unknown>): Ticket {
  return { ...(r as unknown as Ticket), sources: parseJson(r.sources, []), options: r.options ? parseJson<string[]>(r.options, []) : undefined };
}
