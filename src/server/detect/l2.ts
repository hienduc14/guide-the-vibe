// L2: symbol-level conflicts. A breaking change (signature change / rename / delete) in one workspace
// against code in another workspace that uses the symbol; and both workspaces changing the same symbol.

import type { Db } from "../../shared/db.ts";
import { CodeGraph, type SymbolRow } from "../../codeintel/graph.ts";
import { BREAKING, type SymbolChange } from "../../codeintel/diff.ts";
import type { Workspace } from "../../shared/types.ts";
import type { FoundConflict } from "./l0.ts";

export function saveSymbolChanges(db: Db, workspaceId: string, changes: SymbolChange[]): void {
  db.tx(() => {
    db.run(`DELETE FROM symbol_changes WHERE workspace_id = ?`, workspaceId);
    for (const c of changes) {
      if (c.change === "added") continue;
      db.upsert("symbol_changes", { workspace_id: workspaceId, symbol_id: c.symbol_id, name: c.name, kind: c.kind, change: c.change, old_sig: c.old_sig, new_sig: c.new_sig, new_id: c.new_id, exported: c.exported });
    }
  });
}

/** Remember which lines a workspace wrote, so L2 only blames code that workspace actually changed. */
export function saveChangedLines(db: Db, workspaceId: string, lines: Map<string, [number, number][]>): void {
  db.tx(() => {
    db.run(`DELETE FROM wip_lines WHERE workspace_id = ?`, workspaceId);
    for (const [path, ranges] of lines) db.upsert("wip_lines", { workspace_id: workspaceId, path, ranges });
  });
}

/** (path, line) → was it written by the workspace? Unknown files count as written (no line info yet). */
export function changedLineFilter(db: Db, workspaceId: string): (path: string, line: number) => boolean {
  const rows = db.all<{ path: string; ranges: string }>(`SELECT path, ranges FROM wip_lines WHERE workspace_id = ?`, workspaceId);
  if (rows.length === 0) return () => true;
  const map = new Map(rows.map((r) => [r.path, JSON.parse(r.ranges) as [number, number][]]));
  return (path, line) => !!map.get(path)?.some(([a, b]) => line >= a && line <= b);
}

export function loadSymbolChanges(db: Db, workspaceId: string): SymbolChange[] {
  return db
    .all<Omit<SymbolChange, "exported"> & { exported: number }>(`SELECT * FROM symbol_changes WHERE workspace_id = ?`, workspaceId)
    .map((c) => ({ ...c, exported: !!c.exported }));
}

function asTarget(c: SymbolChange): SymbolRow {
  const path = c.symbol_id.split("#")[0];
  return { layer: "base", id: c.symbol_id, path, name: c.name, qualname: c.symbol_id.split("#")[1] ?? c.name, kind: c.kind, start_line: 0, end_line: 0, sig: c.old_sig ?? "", sig_hash: "", body_hash: "", exported: c.exported ? 1 : 0 };
}

function verb(c: SymbolChange): string {
  if (c.change === "sig_changed") return `changes the signature of ${c.symbol_id.split("#")[1]} from \`${c.old_sig}\` to \`${c.new_sig}\``;
  if (c.change === "renamed") return `renames ${c.symbol_id.split("#")[1]} to ${c.new_id?.split("#")[1]}`;
  return `deletes ${c.symbol_id.split("#")[1]}`;
}

export function detectL2Pair(db: Db, graph: CodeGraph, a: Workspace, b: Workspace): FoundConflict[] {
  const out: FoundConflict[] = [];
  const [x, y] = a.id < b.id ? [a, b] : [b, a];
  const changes = new Map<string, SymbolChange[]>([
    [a.id, loadSymbolChanges(db, a.id)],
    [b.id, loadSymbolChanges(db, b.id)],
  ]);

  for (const [from, to] of [[a, b], [b, a]] as const) {
    for (const c of changes.get(from.id)!) {
      if (!BREAKING.has(c.change)) continue;
      // Usages written or modified by the other workspace (its overlay), judged in its own view.
      const written = changedLineFilter(db, to.id);
      const hits = graph.whoCalls(asTarget(c), to.id, { onlyLayer: to.id }).filter((h) => written(h.path, h.line));
      if (hits.length === 0) continue;
      const strong = hits.filter((h) => h.confidence !== "name");
      const level = strong.length ? "high" : "warning";
      const callers = hits.slice(0, 8).map((h) => ({ path: h.path, line: h.line, in: h.from_symbol?.split("#")[1], confidence: h.confidence }));
      out.push({
        key: `L2|${x.id}|${y.id}|usage|${from.id}|${c.symbol_id}`,
        layer: "L2",
        kind: "breaking_change_used",
        level,
        workspace_a: x.id,
        workspace_b: y.id,
        dev_a: x.dev,
        dev_b: y.dev,
        subject: c.symbol_id,
        evidence: { changed_by: from.dev, change: c.change, old_sig: c.old_sig, new_sig: c.new_sig, new_id: c.new_id, used_by: to.dev, callers },
        message:
          `${from.dev} (${from.label}) ${verb(c)}, but ${to.dev} (${to.label}) is writing code that uses it: ` +
          callers.map((h) => `${h.path}:${h.line}${h.confidence === "name" ? " (name match only)" : ""}`).join(", ") +
          `. Git will merge cleanly but the result can break. Keep the old signature, or agree on the new one.`,
      });
    }
  }

  const bChanges = new Map(changes.get(b.id)!.map((c) => [c.symbol_id, c]));
  for (const c of changes.get(a.id)!) {
    const other = bChanges.get(c.symbol_id);
    if (!other) continue;
    const breaking = BREAKING.has(c.change) || BREAKING.has(other.change);
    out.push({
      key: `L2|${x.id}|${y.id}|same|${c.symbol_id}`,
      layer: "L2",
      kind: "same_symbol_changed",
      level: breaking ? "high" : "warning",
      workspace_a: x.id,
      workspace_b: y.id,
      dev_a: x.dev,
      dev_b: y.dev,
      subject: c.symbol_id,
      evidence: { [a.dev]: c.change, [b.dev]: other.change },
      message: `${a.dev} (${c.change}) and ${b.dev} (${other.change}) are both changing ${c.symbol_id.split("#")[1]} in ${c.symbol_id.split("#")[0]}.`,
    });
  }
  return out;
}
