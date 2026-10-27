// Symbol-level diff between two versions of a set of files (L2 core).

import type { SymbolDef } from "./extract.ts";

export type SymbolChangeKind = "added" | "deleted" | "renamed" | "sig_changed" | "body_changed";

export interface SymbolChange {
  symbol_id: string;
  name: string;
  kind: string;
  change: SymbolChangeKind;
  old_sig?: string;
  new_sig?: string;
  new_id?: string;
  exported: boolean;
}

const CONTAINERS = new Set(["class", "interface", "struct", "enum"]);

/** Contract-breaking changes: callers written against the old version may break. */
export const BREAKING: ReadonlySet<SymbolChangeKind> = new Set(["deleted", "renamed", "sig_changed"]);

export function diffSymbols(before: SymbolDef[], after: SymbolDef[]): SymbolChange[] {
  const b = new Map(before.map((s) => [s.id, s]));
  const a = new Map(after.map((s) => [s.id, s]));
  const out: SymbolChange[] = [];
  const addedUnused = new Map([...a].filter(([id]) => !b.has(id)));

  for (const [id, old] of b) {
    const now = a.get(id);
    if (now) {
      if (now.sig_hash !== old.sig_hash) {
        out.push({
          symbol_id: id,
          name: old.name,
          kind: old.kind,
          change: "sig_changed",
          old_sig: old.sig,
          new_sig: now.sig,
          exported: old.exported || now.exported,
        });
      } else if (now.body_hash !== old.body_hash && !CONTAINERS.has(old.kind)) {
        out.push({ symbol_id: id, name: old.name, kind: old.kind, change: "body_changed", old_sig: old.sig, new_sig: now.sig, exported: old.exported });
      }
      continue;
    }
    // Gone: a rename/move keeps the body; anything else is a delete.
    // Any newly appearing id with the same kind and body is the same code under a new name or file.
    const twin = [...addedUnused.values()].find((n) => n.kind === old.kind && n.body_hash === old.body_hash);
    if (twin && !CONTAINERS.has(old.kind)) {
      addedUnused.delete(twin.id);
      out.push({
        symbol_id: id,
        name: old.name,
        kind: old.kind,
        change: "renamed",
        old_sig: old.sig,
        new_sig: twin.sig,
        new_id: twin.id,
        exported: old.exported,
      });
    } else {
      out.push({ symbol_id: id, name: old.name, kind: old.kind, change: "deleted", old_sig: old.sig, exported: old.exported });
    }
  }
  for (const n of addedUnused.values()) {
    out.push({ symbol_id: n.id, name: n.name, kind: n.kind, change: "added", new_sig: n.sig, exported: n.exported });
  }
  return out;
}
