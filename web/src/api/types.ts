// Types mirroring the Operator's JSON (src/server/http/admin-routes.ts, agent-routes.ts, shared/types.ts).

export type Level = "info" | "warning" | "high" | "critical";
export type FeatureMode = "off" | "shadow" | "on";
export type SessionStatus = "active" | "idle" | "ended";

export interface BrainJob {
  id: number;
  ts: string;
  project: string;
  kind: string;
  backend: string;
  model: string | null;
  ms: number;
  ok: number;
  error: string | null;
}

export interface BrainStats {
  totals: { jobs: number; failed: number; avg_ms: number | null; p50_ms: number | null; p95_ms: number | null };
  byKind: { kind: string; jobs: number; failed: number }[];
  byProject: { project: string; jobs: number }[];
  byDay: { day: string; jobs: number; failed: number }[];
  recent: BrainJob[];
}

export interface Person {
  dev: string;
  role: string | null;
  level: MemberLevel | null;
  status: SessionStatus;
  agents: string[];
  workspaces: string[];
  last_seen: string;
  tasks: string[];
  editing: number;
  conflicts: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description?: string;
  repo_url: string;
  main_branch: string;
  main_sha: string | null;
  last_sync: { at: string; ok: boolean; error?: string } | null;
  counts: {
    people_active: number;
    sessions_active: number;
    tasks_active: number;
    conflicts_open: number;
    conflicts_by_level: Record<Level, number>;
    tickets_waiting: number;
    kb_unverified: number;
  };
  charter: Charter;
  attention: number;
  board: { total: number; done: number; open: number; in_progress: number; overdue: number; blocked: number };
  members: Member[];
  people: Person[];
  error?: undefined;
}

export interface ProjectStub {
  id: string;
  name: string;
  repo_url?: string;
  error: string;
}

export type ProjectEntry = ProjectSummary | ProjectStub;

export const isLoaded = (p: ProjectEntry): p is ProjectSummary => !("error" in p && p.error);

export interface Dev {
  name: string;
  created_at: string;
  last_seen: string | null;
}

export interface Overview {
  open_mode: boolean;
  commit: string | null;
  brain: { backend: string; model: string | null; ok: boolean; detail?: string };
  brain_stats: BrainStats;
  projects: ProjectEntry[];
  devs: Dev[];
}

export interface Policy {
  critical_paths: string[];
  modules: Record<string, string[]>;
}

export interface ProjectRecord {
  id: string;
  name: string;
  repo_url: string;
  main_branch: string;
  aliases: string[];
  policy: Policy;
  description?: string;
  charter: Charter;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectDetail extends ProjectSummary {
  record: ProjectRecord;
  graph: { files: number; symbols: number; refs: number };
}

export interface TaskResource {
  kind: "path" | "module" | "symbol" | "contract";
  value: string;
  op?: string;
  certainty?: string;
  source?: string;
}

export interface Task {
  id: string;
  session_id: string;
  workspace_id: string;
  dev: string;
  title: string;
  goal?: string;
  resources: TaskResource[];
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  dev: string;
  label: string;
  branch?: string | null;
  snapshot_sha?: string | null;
  snapshot_base?: string | null;
  updated_at: string;
}

export interface Session {
  id: string;
  dev: string;
  agent: string;
  workspace_id: string;
  status: SessionStatus;
  last_seen: string;
}

export interface Footprint {
  workspace_id: string;
  session_id: string;
  dev: string;
  path: string;
  first_at: string;
  last_at: string;
  count: number;
}

export interface Conflict {
  id: string;
  key: string;
  layer: string;
  kind: string;
  level: Level;
  workspace_a: string;
  workspace_b: string;
  dev_a: string;
  dev_b: string;
  subject: string;
  evidence: Record<string, unknown>;
  message: string;
  status: "open" | "acked" | "resolved" | "dismissed";
  created_at: string;
  updated_at: string;
}

export interface TeamState {
  version: number;
  workspaces: Workspace[];
  sessions: Session[];
  tasks: Task[];
  footprints: Footprint[];
  conflicts: Conflict[];
  features: Record<string, FeatureMode>;
  policy: Policy;
}

export interface Source {
  type: string;
  ref: string;
  note?: string;
}

export interface Ticket {
  id: string;
  from_session: string;
  from_dev: string;
  question: string;
  context?: string | null;
  tier: 1 | 2 | 3;
  status: "answering" | "answered" | "forwarded" | "waiting_human" | "closed" | "expired";
  answer?: string | null;
  answered_by?: string | null;
  sources: Source[];
  confidence?: string | null;
  to_dev?: string | null;
  forwarded_question?: string | null;
  created_at: string;
  updated_at: string;
}

export type DocStatus = "active" | "unverified" | "superseded";

export interface KbListItem {
  id: string;
  type: string;
  title: string;
  status: DocStatus;
  source: string;
  path?: string | null;
  ticket_id?: string | null;
  supersedes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface KbDoc extends KbListItem {
  body: string;
}

export interface KbHit {
  id: string;
  type: string;
  status: DocStatus;
  title: string;
  section: string;
  snippet: string;
  path?: string;
}

export interface Layer {
  key: string;
  layer: string | null;
  description: string;
  default: FeatureMode;
  requires: string[];
  mode: FeatureMode;
  /** Mode set by hand (dashboard/CLI); null = configuration default. */
  override: FeatureMode | null;
  /** Why the feature is effectively off (dependencies, BRAIN_BACKEND=null, circuit breaker). */
  blocked_by: string[];
  tripped: string | null;
  errors: number;
  metrics: Record<string, number | string | null>;
}

export interface KN {
  k: string;
  n: number;
}

export interface ProjectStats {
  days: number;
  brain: BrainStats;
  conflicts: { byLayer: KN[]; byLevel: KN[]; byStatus: KN[]; byDay: KN[] };
  tickets: { byTier: KN[]; byStatus: KN[] };
  events: { byType: KN[]; byDay: KN[] };
  kb: KN[];
}

export interface ActivityEvent {
  id: number;
  ts: string;
  type: string;
  actor: string | null;
  payload: string;
}

export interface SymbolRow {
  layer: string;
  id: string;
  path: string;
  name: string;
  qualname: string;
  kind: string;
  start_line: number;
  end_line: number;
  sig: string;
  exported: number;
}

export interface CallerHit {
  layer: string;
  path: string;
  name: string;
  line: number;
  kind: string;
  recv: string | null;
  from_symbol: string | null;
  confidence: "local" | "import" | "name";
}

export interface BrainProvider {
  id: string;
  name: string;
  kind: "endpoint" | "builtin";
  configured: boolean;
  source?: string;
  key_hint?: string;
  base_url?: string;
  api?: string;
  env?: boolean;
  auth_type?: "api_key" | "oauth";
  api_key?: boolean;
  oauth?: "device" | "redirect";
  models?: number;
}

/** One "log in with your account" attempt; never carries a token. */
export interface OAuthSession {
  id: string;
  provider: string;
  status: "pending" | "waiting_input" | "done" | "error";
  url?: string;
  instructions?: string;
  user_code?: string;
  verification_uri?: string;
  prompt?: { message: string; placeholder?: string };
  progress?: string;
  error?: string;
  expires_at: string;
}

export interface BrainInfo {
  backend: string;
  model: string | null;
  thinking: string | null;
  health: { ok: boolean; detail?: string };
  models: string[];
  stats: BrainStats;
}

// ---- dashboard accounts -----------------------------------------------------------------

export type Role = "admin" | "manager" | "viewer";

export interface Me {
  name: string;
  role: Role;
  kind: "admin_token" | "user" | "share" | "open";
  project: string | null;
  open_mode: boolean;
  has_users: boolean;
}

export interface User {
  name: string;
  role: Role;
  created_at: string;
  last_login: string | null;
}

export interface ShareLink {
  id: string;
  project: string;
  label: string | null;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
  last_used: string | null;
  code?: string;
}

// ---- project members --------------------------------------------------------------------

export type MemberLevel = "intern" | "junior" | "mid" | "senior" | "lead";

export interface Member {
  dev: string;
  role: string;
  level: MemberLevel;
  note?: string | null;
  created_at: string;
  updated_at: string;
}

// ---- project charter --------------------------------------------------------------------

export interface Charter {
  goal?: string;
  users?: string;
  deadline?: string;
  milestones?: string;
  stack?: string[];
  constraints?: string;
  non_goals?: string;
  quality?: "prototype" | "mvp" | "production";
  notes?: string;
}

// ---- task board -----------------------------------------------------------------------------

export type Priority = "urgent" | "high" | "normal" | "low";
export type BoardStatus = "todo" | "in_progress" | "blocked" | "review" | "done" | "cancelled";

export interface BoardTask {
  id: string;
  title: string;
  description?: string;
  priority: Priority;
  due_date?: string;
  estimate_h?: number;
  assignee?: string;
  status: BoardStatus;
  source: "board" | "agent";
  created_by: string;
  labels: string[];
  created_at: string;
  updated_at: string;
  started_at?: string;
  done_at?: string;
}

export interface BoardView extends BoardTask {
  work: { task_id: string; dev: string; title: string; session_status: string | null; agent: string | null }[];
  conflicts: { id: string; level: Level; status: string; with: string; message: string }[];
  blocked: boolean;
  overdue: boolean;
  notes_count: number;
}

export interface BoardNote {
  id: string;
  board_id: string;
  author: string;
  kind: "note" | "system";
  body: string;
  created_at: string;
}

export interface BoardDetail extends BoardView {
  notes: BoardNote[];
  registrations: Task[];
}

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

// ---- conversations & attention --------------------------------------------------------------

export interface ChatEntry {
  id: string;
  from: string;
  to: string | null;
  at: string;
  kind: string;
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

export interface AttentionItem {
  kind: "conflict" | "question" | "overdue" | "blocked" | "unassigned" | "stale";
  level: Level;
  title: string;
  detail: string;
  ref: string;
  at: string;
}
