// Adapters: translate each agent's native hook payload into one normalized shape, and our decision back
// into that agent's native output format.

import { isAbsolute, relative } from "node:path";
import type { AgentKind, HookDecision } from "../shared/types.ts";
import { normPath } from "../shared/util.ts";

export type HookKind = "session_start" | "prompt" | "pre_edit" | "post_tool" | "plan" | "stop" | "session_end" | "other";

export interface NormalizedHook {
  agent: AgentKind;
  kind: HookKind;
  event: string; // native event name, needed to format the answer
  agentSessionId: string;
  cwd: string;
  toolName?: string;
  paths: string[]; // as given (absolute or relative to cwd)
  prompt?: string;
  plan?: string;
}

const CLAUDE_EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const CODEX_EDIT_TOOLS = new Set(["apply_patch", "Edit", "Write"]);

/** File paths touched by a Codex apply_patch payload. */
export function pathsFromPatch(patch: string): string[] {
  const out = new Set<string>();
  for (const m of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm)) out.add((m[1] ?? m[2]).trim());
  return [...out];
}

type Raw = Record<string, any>;

export function normalize(agent: AgentKind, raw: Raw): NormalizedHook {
  const event = String(raw.hook_event_name ?? raw.event ?? "");
  const base = {
    agent,
    event,
    agentSessionId: String(raw.session_id ?? raw.sessionId ?? "unknown"),
    cwd: String(raw.cwd ?? process.cwd()),
    paths: [] as string[],
  };
  const tool = raw.tool_name as string | undefined;
  const input = (raw.tool_input ?? {}) as Raw;
  switch (event) {
    case "SessionStart":
      return { ...base, kind: "session_start" };
    case "UserPromptSubmit":
      return { ...base, kind: "prompt", prompt: String(raw.prompt ?? "") };
    case "Stop":
      return { ...base, kind: "stop" };
    case "SessionEnd":
      return { ...base, kind: "session_end" };
    case "PreToolUse":
    case "PostToolUse": {
      const pre = event === "PreToolUse";
      let paths: string[] = Array.isArray(raw.paths) ? raw.paths : [];
      let isEdit = paths.length > 0;
      if (agent === "claude" || agent === "grok" || agent === "other") {
        if (tool && CLAUDE_EDIT_TOOLS.has(tool)) {
          paths = [input.file_path ?? input.notebook_path].filter(Boolean);
          isEdit = true;
        }
        if (pre && tool === "ExitPlanMode") return { ...base, kind: "plan", toolName: tool, plan: String(input.plan ?? "") };
      } else if (agent === "codex") {
        if (tool && CODEX_EDIT_TOOLS.has(tool)) {
          paths = typeof input.command === "string" ? pathsFromPatch(input.command) : [input.file_path].filter(Boolean);
          isEdit = true;
        }
        if (pre && tool === "update_plan") {
          const steps = Array.isArray(input.plan) ? input.plan.map((s: Raw) => `- ${s.step}`).join("\n") : "";
          return { ...base, kind: "plan", toolName: tool, plan: [input.explanation, steps].filter(Boolean).join("\n") };
        }
      }
      if (pre) return { ...base, kind: isEdit ? "pre_edit" : "other", toolName: tool, paths };
      return { ...base, kind: "post_tool", toolName: tool, paths: isEdit ? paths : [] };
    }
  }
  return { ...base, kind: "other" };
}

/** Repo-relative, forward-slash paths; drops paths outside the repo. */
export function toRepoPaths(paths: string[], cwd: string, top: string): string[] {
  const out: string[] = [];
  for (const p of paths) {
    const abs = isAbsolute(p) ? p : `${cwd}/${p}`;
    const rel = normPath(relative(top, abs));
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) continue;
    out.push(rel);
  }
  return out;
}

/** Native output for Claude Code / Codex / Grok (same JSON shape). `undefined` = print nothing. */
export function formatOutput(h: NormalizedHook, d: HookDecision): Record<string, unknown> | undefined {
  if (h.agent === "omp") return { ...d };
  const ctx = d.context?.trim() || undefined;
  switch (h.kind) {
    case "pre_edit":
    case "plan": {
      if (d.decision === "allow" && !ctx) return undefined;
      const out: Record<string, unknown> = { hookEventName: "PreToolUse" };
      // Only override the agent's own permission flow when we have to stop it.
      if (d.decision !== "allow") {
        out.permissionDecision = d.decision;
        out.permissionDecisionReason = d.reason ?? ctx;
      }
      if (ctx) out.additionalContext = ctx;
      return { hookSpecificOutput: out };
    }
    case "post_tool":
      return ctx ? { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: ctx } } : undefined;
    case "prompt":
      return ctx ? { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: ctx } } : undefined;
    case "session_start":
      return ctx ? { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: ctx } } : undefined;
    default:
      return undefined;
  }
}
