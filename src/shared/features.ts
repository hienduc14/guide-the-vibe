// Feature flags: every layer can be off / shadow (run + log, never notify) / on.
// A circuit breaker downgrades a feature to "off" after repeated failures.

import type { FeatureMode } from "./types.ts";

export interface FeatureDef {
  default: FeatureMode;
  requires?: string[];
  description: string;
}

export const FEATURES = {
  registration: { default: "on", description: "Task registration and overlap feedback" },
  "registration.auto_from_plan": { default: "shadow", requires: ["brain"], description: "Draft a registration from an agent plan" },
  drift_check: { default: "on", description: "Warn when edits leave the registered scope" },
  "detect.l0_path": { default: "on", description: "Path / module overlap" },
  "detect.l1_merge": { default: "on", description: "Speculative merge of WIP snapshots (git merge-tree)" },
  "detect.l2_symbol": { default: "on", requires: ["knowledge.code_graph"], description: "tree-sitter symbol changes vs usages" },
  "detect.l3_semantic": { default: "shadow", requires: ["brain"], description: "LLM judgement over registrations + evidence" },
  "knowledge.code_graph": { default: "on", description: "tree-sitter code graph (base + per-workspace overlay)" },
  "knowledge.doc_kb": { default: "on", description: "Business docs / ADR / Q&A full-text search" },
  "qa.tier1_answer": { default: "on", requires: ["brain"], description: "Operator answers questions itself" },
  "qa.tier2_relay": { default: "on", description: "Forward questions to another dev's agent" },
  "qa.tier3_human": { default: "on", description: "Escalate to the human when agents cannot decide" },
  "policy.ask": { default: "on", description: "Ask/deny on high and critical conflicts" },
  "coord.priority": {
    default: "on",
    description: "Conflict notices and forwarded questions carry each side's task, priority and due date, and advise the lower-priority side to give way",
  },
  "notify.desktop": { default: "on", description: "Desktop notifications on the dev machine" },
  "brain.summary": {
    default: "on",
    requires: ["brain"],
    description: "One-line brain summary of each settled conversation and a digest of the day on the dashboard (cached, capped per day)",
  },
  "brain.suggest": {
    default: "on",
    requires: ["brain"],
    description: "Brain drafts 2-3 ways to settle a clash, and rewrites a lead's message to the agents on request",
  },
  brain: { default: "on", description: "LLM brain (Pi / null)" },
} satisfies Record<string, FeatureDef>;

export type FeatureKey = keyof typeof FEATURES;

export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

/** Resolve effective modes: explicit overrides, then dependencies (a feature whose requirement is off is off). */
export function resolveFeatures(overrides: Partial<Record<string, FeatureMode>>): Record<FeatureKey, FeatureMode> {
  const out = {} as Record<FeatureKey, FeatureMode>;
  for (const key of FEATURE_KEYS) out[key] = overrides[key] ?? FEATURES[key].default;
  // Dependencies can chain, so iterate until stable.
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of FEATURE_KEYS) {
      const def: FeatureDef = FEATURES[key];
      if (out[key] !== "off" && def.requires?.some((r) => out[r as FeatureKey] === "off")) {
        out[key] = "off";
        changed = true;
      }
    }
  }
  return out;
}

export function isActive(mode: FeatureMode | undefined): boolean {
  return mode === "on" || mode === "shadow";
}

/** Counts failures per feature and trips after `limit` failures inside `windowMs`. */
export class CircuitBreaker {
  private failures = new Map<string, number[]>();
  private tripped = new Map<string, string>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit = 5, windowMs = 10 * 60_000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  fail(feature: string, reason: string, now = Date.now()): boolean {
    const list = (this.failures.get(feature) ?? []).filter((t) => now - t < this.windowMs);
    list.push(now);
    this.failures.set(feature, list);
    if (list.length >= this.limit && !this.tripped.has(feature)) {
      this.tripped.set(feature, reason);
      return true;
    }
    return false;
  }

  isTripped(feature: string): string | undefined {
    return this.tripped.get(feature);
  }

  reset(feature: string): void {
    this.tripped.delete(feature);
    this.failures.delete(feature);
  }

  all(): Record<string, string> {
    return Object.fromEntries(this.tripped);
  }
}
