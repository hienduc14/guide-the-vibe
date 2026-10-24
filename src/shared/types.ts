// Shared domain types used by the Operator server, the local daemon and the adapters.

export type AgentKind = "claude" | "codex" | "omp" | "cursor" | "grok" | "other";

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
}

export interface AgentCapabilities {
  ask: boolean; // PreToolUse can ask the human
  inject: boolean; // can add context mid-turn
  rewake: boolean; // can wake an idle agent
}

export const AGENT_CAPABILITIES: Record<AgentKind, AgentCapabilities> = {
  claude: { ask: true, inject: true, rewake: true },
  codex: { ask: false, inject: true, rewake: false },
  omp: { ask: false, inject: true, rewake: true },
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
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
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
}

/** What the server pushes to daemons over SSE so hooks can decide locally. */
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
