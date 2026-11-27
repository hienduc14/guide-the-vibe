// Shared domain types used by the Operator server, the local daemon and the adapters.

export type AgentKind = "claude" | "codex" | "cursor" | "grok" | "other";

export type Level = "info" | "warning" | "high" | "critical";
export const LEVEL_RANK: Record<Level, number> = { info: 0, warning: 1, high: 2, critical: 3 };

export type DetectLayer = "L0" | "L1" | "L2" | "L3";

export type ResourceKind = "path" | "module" | "symbol" | "contract";
export type ResourceOp = "read" | "modify" | "create" | "delete" | "rename" | "sig_change";

export interface TaskResource {
  kind: ResourceKind;
  value: string;
  op?: ResourceOp;
  certainty?: "committed" | "contingent";
  source?: "declared" | "plan" | "footprint";
}

export interface TaskRegistration {
  title: string;
  goal?: string;
  base_sha?: string;
  resources: TaskResource[];
  /** The board item this work is for (gtv_pick_task links it automatically). */
  board_id?: string;
}

export type TaskStatus = "registered" | "active" | "pr_open" | "done" | "abandoned";

export interface Task extends TaskRegistration {
  id: string;
  session_id: string;
  workspace_id: string;
  dev: string;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
  /** What the agent says it did, given when it finishes (gtv_finish_task). */
  summary?: string | null;
}

/** A dev's working copy (one worktree). WIP snapshots and L1/L2 work per workspace. */
export interface Workspace {
  id: string;
  dev: string;
  label: string;
  branch?: string;
  snapshot_sha?: string;
  snapshot_base?: string;
  updated_at: string;
}

export interface Session {
  id: string;
  dev: string;
  agent: AgentKind;
  workspace_id: string;
  agent_session_id?: string;
  cwd?: string;
  status: "active" | "idle" | "ended";
  capabilities: AgentCapabilities;
  last_seen: string;
  /** The computer the agent runs on (hub device id), from the key that registered the session. */
  device?: string | null;
}

export interface AgentCapabilities {
  ask: boolean; // PreToolUse can ask the human
  inject: boolean; // can add context mid-turn
  rewake: boolean; // can wake an idle agent
}

export const AGENT_CAPABILITIES: Record<AgentKind, AgentCapabilities> = {
  claude: { ask: true, inject: true, rewake: true },
  codex: { ask: false, inject: true, rewake: false },
  cursor: { ask: false, inject: true, rewake: false },
  grok: { ask: false, inject: false, rewake: false },
  other: { ask: false, inject: false, rewake: false },
};

export interface Footprint {
  workspace_id: string;
  session_id: string;
  dev: string;
  path: string;
  first_at: string;
  last_at: string;
  count: number;
}

export type ConflictStatus = "open" | "acked" | "resolved" | "dismissed";

export interface Conflict {
  id: string;
  key: string; // stable identity: layer + kind + pair + subject
  layer: DetectLayer;
  kind: string;
  level: Level;
  workspace_a: string;
  workspace_b: string;
  dev_a: string;
  dev_b: string;
  subject: string; // path or symbol the conflict is about
  evidence: Record<string, unknown>;
  message: string;
  status: ConflictStatus;
  created_at: string;
  updated_at: string;
}

export type TicketTier = 1 | 2 | 3;
export type TicketStatus = "answering" | "answered" | "forwarded" | "waiting_human" | "closed" | "expired";

export interface Source {
  type: "file" | "symbol" | "task" | "doc" | "ticket" | "conflict";
  ref: string;
  note?: string;
}

export interface Ticket {
  id: string;
  from_session: string;
  from_dev: string;
  question: string;
  context?: string;
  tier: TicketTier;
  status: TicketStatus;
  answer?: string;
  answered_by?: string;
  sources: Source[];
  confidence?: "high" | "medium" | "low";
  to_dev?: string;
  forwarded_question?: string;
  /** Choices the asker offers when someone has to decide; the dashboard shows them as buttons. */
  options?: string[];
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  /** Who it is from: a developer (their agent), "operator" (the brain), "gtv" (detectors), or a dashboard user. */
  from_dev?: string;
  to_dev: string;
  to_workspace?: string;
  to_session?: string;
  kind: "conflict" | "ticket_question" | "ticket_answer" | "human_request" | "info";
  ref_id?: string;
  body: string;
  created_at: string;
  delivered_at?: string;
}

/** Normalized event a daemon sends to the server. */
export type GtvEvent =
  | { type: "session_start"; session: SessionHello }
  | { type: "session_end"; session_id: string }
  /** The agent finished its turn (Stop hook): the session goes idle until the next prompt or edit. */
  | { type: "stop"; session_id: string }
  | { type: "prompt"; session_id: string; prompt: string }
  | { type: "plan"; session_id: string; plan: string }
  | { type: "edit"; session_id: string; paths: string[]; phase: "pre" | "post" }
  | { type: "snapshot"; workspace_id: string; sha: string; branch?: string };

export interface SessionHello {
  dev: string;
  agent: AgentKind;
  agent_session_id?: string;
  workspace_id: string;
  workspace_label: string;
  cwd?: string;
  branch?: string;
  /** Set by the server from the caller's key, never taken from the daemon. */
  device?: string | null;
}

/** What the server pushes to daemons over SSE so hooks can decide locally. */
export interface TeamState {
  version: number;
  workspaces: Workspace[];
  sessions: Session[];
  tasks: Task[];
  /** Tasks finished in the last two hours, so a card can say what an agent just did (not used for detection). */
  recent_done?: Task[];
  footprints: Footprint[];
  conflicts: Conflict[];
  features: Record<string, FeatureMode>;
  policy: Policy;
  charter?: Charter;
}

export type Priority = "urgent" | "high" | "normal" | "low";
export const PRIORITIES: Priority[] = ["urgent", "high", "normal", "low"];
export const PRIORITY_RANK: Record<Priority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

export type BoardStatus = "todo" | "in_progress" | "blocked" | "review" | "done" | "cancelled";
export const BOARD_STATUSES: BoardStatus[] = ["todo", "in_progress", "blocked", "review", "done", "cancelled"];

/** An item on the project's task board. */
export interface BoardTask {
  id: string;
  title: string;
  description?: string;
  priority: Priority;
  due_date?: string; // YYYY-MM-DD
  estimate_h?: number;
  assignee?: string;
  status: BoardStatus;
  source: "board" | "agent"; // created on the board, or from an agent's registration
  created_by: string;
  picked_session?: string;
  labels: string[];
  created_at: string;
  updated_at: string;
  started_at?: string;
  done_at?: string;
}

/** What an agent's note is about, so the dashboard can show it as an icon and one line. */
export type NoteTag = "progress" | "decision" | "blocker" | "question" | "done";
export const NOTE_TAGS: NoteTag[] = ["progress", "decision", "blocker", "question", "done"];

export interface BoardNote {
  id: string;
  board_id: string;
  author: string;
  kind: "note" | "system";
  body: string;
  created_at: string;
  tag?: NoteTag | null;
  /** One line (≤ 120 chars) for lists; body holds the detail. */
  summary?: string | null;
}

/** First line or sentence of a text, cut to `max` characters: the default one-liner for old clients. */
export function oneLine(text: string, max = 120): string {
  const first = text.trim().split(/\n|(?<=[.!?])\s/)[0] ?? "";
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

export type MemberLevel = "intern" | "junior" | "mid" | "senior" | "lead";
export const MEMBER_LEVELS: MemberLevel[] = ["intern", "junior", "mid", "senior", "lead"];
export const LEVEL_ORDER: Record<MemberLevel, number> = { intern: 0, junior: 1, mid: 2, senior: 3, lead: 4 };

/** A developer's place in one project. */
/** What a member may do in the project: manage it, work on it (their agents connect), or only look. */
export type MemberAccess = "manager" | "developer" | "viewer";
export const MEMBER_ACCESS: MemberAccess[] = ["manager", "developer", "viewer"];

export interface Member {
  dev: string;
  role: string; // free text: "backend", "frontend", "tech lead", "qa", …
  level: MemberLevel;
  access: MemberAccess;
  note?: string;
  created_at: string;
  updated_at: string;
}

/**
 * What the project is for and within which limits: agents read it (briefing, gtv_status, the Operator's prompts)
 * to pick technology and solutions that fit, e.g. "MVP in 2 months for 100 users" rules out a microservice mesh.
 */
export interface Charter {
  goal?: string;
  users?: string; // who uses it and how many
  deadline?: string; // YYYY-MM-DD
  milestones?: string;
  stack?: string[];
  constraints?: string;
  non_goals?: string;
  quality?: "prototype" | "mvp" | "production";
  notes?: string;
  /** Language agents write titles, notes, questions and summaries in (default Vietnamese). */
  language?: "vi" | "en";
}

export const LANGUAGE_NAME: Record<NonNullable<Charter["language"]>, string> = { vi: "Vietnamese", en: "English" };

const QUALITY_TEXT: Record<NonNullable<Charter["quality"]>, string> = {
  prototype: "prototype — speed over polish, throwaway code is fine",
  mvp: "MVP — working and simple; avoid over-engineering, but no known bugs in the main flows",
  production: "production — tests, error handling, security and maintainability matter",
};

/** The charter as a few lines for agents and the brain; empty when nothing is set. */
export function charterText(c: Charter | undefined): string {
  if (!c) return "";
  const lines: string[] = [];
  if (c.goal) lines.push(`Goal: ${c.goal}`);
  if (c.users) lines.push(`Users: ${c.users}`);
  if (c.deadline) lines.push(`Deadline: ${c.deadline}`);
  if (c.milestones) lines.push(`Milestones: ${c.milestones}`);
  if (c.quality) lines.push(`Quality bar: ${QUALITY_TEXT[c.quality]}`);
  if (c.stack?.length) lines.push(`Stack (use these; ask before adding new frameworks or services): ${c.stack.join(", ")}`);
  if (c.constraints) lines.push(`Constraints: ${c.constraints}`);
  if (c.non_goals) lines.push(`Out of scope: ${c.non_goals}`);
  if (c.notes) lines.push(`Notes: ${c.notes}`);
  return lines.join("\n");
}

export type FeatureMode = "off" | "shadow" | "on";

export interface Policy {
  critical_paths: string[];
  modules: Record<string, string[]>; // module name -> globs
}

/** Decision returned by the daemon to an adapter for one hook call. */
export interface HookDecision {
  decision: "allow" | "ask" | "deny";
  reason?: string;
  context?: string;
  statusline?: string;
}
