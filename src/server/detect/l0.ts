// L0: path / module / declared-resource overlap between workspaces. Pure and cheap: runs on every event.

import type { Conflict, Footprint, Level, Policy, Task, Workspace } from "../../shared/types.ts";
import { LEVEL_RANK } from "../../shared/types.ts";
import { globMatch, patternsOverlap } from "../../shared/util.ts";

export type FoundConflict = Omit<Conflict, "id" | "status" | "created_at" | "updated_at">;

export interface L0Input {
  workspaces: Workspace[];
  tasks: Task[];
  footprints: Footprint[];
  policy: Policy;
  /** Code-graph lookup: places in `workspaceId`'s own WIP that use `symbol`. */
  usageOf?: (symbol: string, workspaceId: string) => { path: string; line: number; confidence: string }[];
}

/** Module of a path: an explicit policy module, else its first two directories. */
export function moduleOf(path: string, policy: Policy): string {
  for (const [name, globs] of Object.entries(policy.modules)) {
    if (globs.some((g) => globMatch(g, path))) return name;
  }
  const parts = path.split("/");
  return parts.length > 2 ? parts.slice(0, 2).join("/") : parts.length === 2 ? parts[0] : "(root)";
}

export function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

interface Side {
  ws: Workspace;
  edited: Set<string>;
  scopes: string[]; // registered path globs
  symbols: { value: string; op?: string; task: string }[];
  contracts: { value: string; op?: string; task: string }[];
  modules: Set<string>;
  taskTitles: string[];
}

function sideOf(ws: Workspace, input: L0Input): Side {
  const tasks = input.tasks.filter((t) => t.workspace_id === ws.id);
  const edited = new Set(input.footprints.filter((f) => f.workspace_id === ws.id).map((f) => f.path));
  const scopes: string[] = [];
  const symbols: Side["symbols"] = [];
  const contracts: Side["contracts"] = [];
  const modules = new Set<string>();
  for (const t of tasks) {
    for (const r of t.resources) {
      if (r.kind === "path") scopes.push(r.value);
      else if (r.kind === "symbol") symbols.push({ value: r.value, op: r.op, task: t.title });
      else if (r.kind === "contract") contracts.push({ value: r.value, op: r.op, task: t.title });
      else if (r.kind === "module") modules.add(r.value);
    }
  }
  for (const p of edited) modules.add(moduleOf(p, input.policy));
  for (const s of scopes) modules.add(moduleOf(s.replace(/\/?\*.*$/, "") || s, input.policy));
  return { ws, edited, scopes, symbols, contracts, modules, taskTitles: tasks.map((t) => t.title) };
}

const BREAKING_OPS = new Set(["sig_change", "rename", "delete"]);

export function detectL0(input: L0Input): FoundConflict[] {
  const sides = input.workspaces.map((w) => sideOf(w, input)).filter((s) => s.edited.size || s.scopes.length || s.symbols.length || s.contracts.length);
  const out = new Map<string, FoundConflict>();
  const add = (a: Side, b: Side, kind: string, level: Level, subject: string, message: string, evidence: Record<string, unknown>) => {
    const [x, y] = a.ws.id < b.ws.id ? [a, b] : [b, a];
    const key = `L0|${x.ws.id}|${y.ws.id}|${subject}`;
    const prev = out.get(key);
    if (prev && LEVEL_RANK[prev.level] >= LEVEL_RANK[level]) return;
    out.set(key, { key, layer: "L0", kind, level, workspace_a: x.ws.id, workspace_b: y.ws.id, dev_a: x.ws.dev, dev_b: y.ws.dev, subject, evidence, message });
  };
  const who = (s: Side) => `${s.ws.dev} (${s.ws.label}${s.taskTitles.length ? `, task "${s.taskTitles[0]}"` : ""})`;

  for (let i = 0; i < sides.length; i++) {
    for (let j = i + 1; j < sides.length; j++) {
      const a = sides[i];
      const b = sides[j];
      let strong = false;

      for (const p of a.edited) {
        if (b.edited.has(p)) {
          add(a, b, "same_file", "warning", p, `${who(a)} and ${who(b)} are both editing ${p}.`, { path: p });
          strong = true;
        }
      }
      for (const [x, y] of [[a, b], [b, a]] as const) {
        for (const p of x.edited) {
          const scope = y.scopes.find((g) => globMatch(g, p));
          if (scope && !y.edited.has(p)) {
            add(x, y, "edit_in_scope", "warning", p, `${who(x)} is editing ${p}, which is inside the registered scope "${scope}" of ${who(y)}.`, { path: p, scope });
            strong = true;
          }
        }
      }
      for (const ga of a.scopes) {
        for (const gb of b.scopes) {
          if (patternsOverlap(ga, gb)) add(a, b, "scope_overlap", "info", `${ga} ~ ${gb}`, `Registered scopes overlap: ${who(a)} "${ga}" and ${who(b)} "${gb}".`, { a: ga, b: gb });
        }
      }
      for (const [x, y] of [[a, b], [b, a]] as const) {
        for (const s of x.symbols) {
          const other = y.symbols.find((o) => o.value === s.value || o.value.split(".").pop() === s.value.split(".").pop());
          if (!other) continue;
          const breaking = BREAKING_OPS.has(s.op ?? "") || BREAKING_OPS.has(other.op ?? "");
          add(x, y, "same_symbol_declared", breaking ? "high" : "warning", `symbol:${s.value}`,
            `${who(x)} and ${who(y)} both declared work on ${s.value}${breaking ? " and at least one plans a breaking change (signature/rename/delete)" : ""}.`,
            { symbol: s.value, ops: [s.op, other.op] });
          strong = true;
        }
        // A planned breaking change against code the other side is writing right now.
        for (const s of x.symbols) {
          if (!BREAKING_OPS.has(s.op ?? "") || !input.usageOf) continue;
          const hits = input.usageOf(s.value, y.ws.id);
          if (hits.length === 0) continue;
          add(x, y, "planned_breaking_change", hits.some((h) => h.confidence !== "name") ? "high" : "warning", `planned:${s.value}`,
            `${who(x)} plans to ${s.op?.replace("_", " ")} ${s.value}, which ${who(y)} is using in ${hits.slice(0, 3).map((h) => `${h.path}:${h.line}`).join(", ")}.`,
            { symbol: s.value, op: s.op, usages: hits.slice(0, 8) });
          strong = true;
        }
        for (const c of x.contracts) {
          const other = y.contracts.find((o) => o.value === c.value);
          if (!other) continue;
          const modifies = [c.op, other.op].some((op) => op && op !== "read");
          add(x, y, "same_contract", modifies ? "high" : "info", `contract:${c.value}`, `${who(x)} and ${who(y)} both touch contract ${c.value}.`, { contract: c.value, ops: [c.op, other.op] });
          strong = true;
        }
      }
      for (const g of input.policy.critical_paths) {
        const ta = [...a.edited, ...a.scopes].filter((p) => patternsOverlap(g, p));
        const tb = [...b.edited, ...b.scopes].filter((p) => patternsOverlap(g, p));
        if (ta.length && tb.length) {
          add(a, b, "critical_path", "critical", `critical:${g}`, `Both ${who(a)} and ${who(b)} touch the critical area "${g}" (${ta[0]} / ${tb[0]}). Coordinate before continuing.`, { glob: g, a: ta, b: tb });
          strong = true;
        }
      }
      if (!strong) {
        for (const m of a.modules) {
          if (b.modules.has(m)) add(a, b, "same_module", "info", `module:${m}`, `${who(a)} and ${who(b)} work in the same module "${m}".`, { module: m });
        }
      }
    }
  }
  return [...out.values()];
}

/** Drift: paths a session edits outside its registered task scope. */
export function outOfScope(task: Task | undefined, path: string): boolean {
  if (!task) return false;
  const scopes = task.resources.filter((r) => r.kind === "path").map((r) => r.value);
  if (scopes.length === 0) return false;
  return !scopes.some((g) => globMatch(g, path));
}

export { pairKey as sortedPair };
