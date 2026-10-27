// Local, fast decisions for hooks, computed from the cached team state (never waits on the server).

import type { AgentCapabilities, Conflict, HookDecision, Message, TeamState } from "../shared/types.ts";
import { LEVEL_RANK } from "../shared/types.ts";
import { globMatch } from "../shared/util.ts";

export interface LocalSession {
  id: string; // gtv session id (assigned by the server)
  dev: string;
  agent: string;
  workspace_id: string;
  capabilities: AgentCapabilities;
  seen: Set<string>; // one-shot notices already shown to this session
}

function touchesPath(c: Conflict, path: string): boolean {
  if (c.subject === path || c.subject.startsWith(path + "#")) return true;
  const ev = c.evidence as { path?: string; a?: string[]; b?: string[]; callers?: { path: string }[] };
  if (ev.path === path) return true;
  if (ev.a?.includes(path) || ev.b?.includes(path)) return true;
  return !!ev.callers?.some((x) => x.path === path);
}

export function decidePreEdit(state: TeamState | undefined, s: LocalSession, paths: string[]): HookDecision {
  if (!state) return { decision: "allow" };
  const notes: string[] = [];
  let decision: HookDecision["decision"] = "allow";
  let reason: string | undefined;
  const policyAsk = state.features["policy.ask"] === "on";

  const mine = state.conflicts.filter((c) => c.status === "open" && (c.workspace_a === s.workspace_id || c.workspace_b === s.workspace_id));
  const hits = mine.filter((c) => paths.some((p) => touchesPath(c, p))).sort((x, y) => LEVEL_RANK[y.level] - LEVEL_RANK[x.level]);
  for (const c of hits) {
    const key = `cf:${c.id}`;
    const first = !s.seen.has(key);
    if (c.level === "critical" || (c.level === "high" && first)) {
      if (policyAsk && decision === "allow") {
        decision = s.capabilities.ask ? "ask" : "deny";
        reason =
          `gtv ${c.level.toUpperCase()} conflict ${c.id}: ${c.message}\n` +
          (decision === "deny"
            ? c.level === "critical"
              ? "Editing this critical area is blocked until the conflict is acknowledged. Coordinate (gtv_ask), then call gtv_ack."
              : "Stopped once so you can coordinate: check with the gtv_ask tool or your user. If you still want this edit, retry it."
            : "Approve only if you have coordinated with the teammate.");
      } else if (first) {
        notes.push(`[gtv ${c.level}] ${c.message} (${c.id})`);
      }
    } else if (first && c.level !== "info") {
      notes.push(`[gtv ${c.level}] ${c.message} (${c.id})`);
    }
    s.seen.add(key);
  }

  // Someone else is editing the same file right now and the server has not reported a conflict yet.
  for (const p of paths) {
    const others = state.footprints.filter((f) => f.path === p && f.workspace_id !== s.workspace_id);
    const key = `fp:${p}`;
    if (others.length && !s.seen.has(key) && !hits.length) {
      s.seen.add(key);
      notes.push(`[gtv] ${[...new Set(others.map((f) => f.dev))].join(", ")} is also editing ${p}. Consider asking with gtv_ask before changing shared parts.`);
    }
  }

  // Editing inside a teammate's registered scope: warn before the first edit, without waiting for the server.
  for (const p of paths) {
    const owners = state.tasks.filter((t) => t.workspace_id !== s.workspace_id && t.resources.some((r) => r.kind === "path" && globMatch(r.value, p)));
    const key = `scope:${p}`;
    if (owners.length && !s.seen.has(key)) {
      s.seen.add(key);
      notes.push(
        `[gtv] ${p} is inside the registered scope of ${owners.map((t) => `${t.dev} ("${t.title}")`).join(", ")}. Keep changes there minimal or coordinate with gtv_ask.`,
      );
    }
  }

  if (!state.tasks.some((t) => t.session_id === s.id) && !s.seen.has("nudge_register") && state.features["registration"] !== "off") {
    s.seen.add("nudge_register");
    notes.push(
      "[gtv] You have not registered a task yet. Call gtv_register_task (title, goal, paths/symbols you will touch) so teammates' agents know what you are doing.",
    );
  }

  return { decision, reason, context: notes.join("\n") || undefined };
}

/** Messages that should be injected into this agent session now. */
export function messagesFor(inbox: Message[], s: LocalSession): Message[] {
  return inbox.filter((m) => {
    if (m.kind === "human_request" || m.delivered_at) return false;
    if (m.to_session) return m.to_session === s.id;
    if (m.to_workspace) return m.to_workspace === s.workspace_id;
    return m.to_dev === s.dev;
  });
}

export function statusline(
  state: TeamState | undefined,
  s: { dev: string; workspace_id?: string } | undefined,
  inboxCount: number,
  connected: boolean,
): string {
  if (!connected || !state) return "gtv ○ offline";
  const teammates = new Set(state.sessions.filter((x) => x.dev !== s?.dev && x.status === "active").map((x) => x.dev));
  const mine = state.conflicts.filter(
    (c) => c.status === "open" && s?.workspace_id && (c.workspace_a === s.workspace_id || c.workspace_b === s.workspace_id) && c.level !== "info",
  );
  const worst = mine.reduce((m, c) => (LEVEL_RANK[c.level] > LEVEL_RANK[m] ? c.level : m), "info" as Conflict["level"]);
  const parts = [`gtv ● ${teammates.size} teammate${teammates.size === 1 ? "" : "s"} active`];
  if (mine.length) parts.push(`⚠ ${mine.length} conflict${mine.length > 1 ? "s" : ""} (${worst})`);
  if (inboxCount) parts.push(`✉ ${inboxCount}`);
  return parts.join(" · ");
}
