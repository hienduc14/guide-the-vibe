// Code graph store: a 'base' layer (main) plus one overlay layer per workspace holding only the
// files that differ from main. A "view" of a workspace = its overlay + the base files it does not shadow.

import type { SQLInputValue } from "node:sqlite";
import { posix } from "node:path";
import type { Db } from "../shared/db.ts";
import type { FileIndex } from "./extract.ts";
import { parseJson } from "../shared/db.ts";
import { nowIso } from "../shared/util.ts";

export const BASE = "base";

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
  sig_hash: string;
  body_hash: string;
  exported: number;
}

export interface RefRow {
  layer: string;
  path: string;
  name: string;
  line: number;
  kind: "call" | "type";
  recv: string | null;
  from_symbol: string | null;
}

export type Confidence = "local" | "import" | "name";

export interface CallerHit extends RefRow {
  confidence: Confidence;
}

const CALLABLE = new Set(["function", "method", "constructor", "class"]);
const TYPELIKE = new Set(["class", "interface", "type", "struct", "enum"]);

/** SQL fragment restricting `alias` rows to a view, plus its params. */
export function inView(alias: string, view: string): { sql: string; params: SQLInputValue[] } {
  if (view === BASE) return { sql: `${alias}.layer = 'base'`, params: [] };
  return {
    sql: `(${alias}.layer = ? OR (${alias}.layer = 'base' AND ${alias}.path NOT IN (SELECT path FROM g_files WHERE layer = ? UNION SELECT path FROM g_tombstones WHERE layer = ?)))`,
    params: [view, view, view],
  };
}

// Only strip real code extensions: "./profile.utils" is a module name, not "profile" + ".utils".
const stem = (p: string) => p.replace(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|go|java)$/, "").replace(/\/index$/, "");

/** Does an import `source` written in `fromPath` plausibly point at `targetPath`? */
export function importPointsTo(fromPath: string, source: string, targetPath: string): boolean {
  const target = stem(targetPath);
  if (source.startsWith(".")) {
    if (/\.(py)$/.test(fromPath)) {
      // Python relative import: ".mod" / "..pkg.mod"
      const dots = /^\.+/.exec(source)![0].length;
      let dir = posix.dirname(fromPath);
      for (let i = 1; i < dots; i++) dir = posix.dirname(dir);
      const rest = source.slice(dots).replace(/\./g, "/");
      return target === posix.normalize(rest ? `${dir}/${rest}` : dir);
    }
    return stem(posix.normalize(posix.join(posix.dirname(fromPath), source))) === target;
  }
  const asPath = source.includes("/") ? source : source.replace(/\./g, "/");
  return target === asPath || target.endsWith("/" + asPath) || posix.dirname(target).endsWith(asPath.split("/").slice(-1)[0] ?? "\0");
}

export class CodeGraph {
  readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  // ---- writes ---------------------------------------------------------------

  removeFile(layer: string, path: string): void {
    for (const t of ["g_files", "g_symbols", "g_refs", "g_imports", "g_tombstones"]) {
      this.db.run(`DELETE FROM ${t} WHERE layer = ? AND path = ?`, layer, path);
    }
  }

  replaceFile(layer: string, idx: FileIndex): void {
    this.db.tx(() => {
      this.removeFile(layer, idx.path);
      this.db.run(`INSERT INTO g_files (layer, path, lang, content_hash, has_errors) VALUES (?,?,?,?,?)`, layer, idx.path, idx.lang, idx.content_hash, idx.has_errors ? 1 : 0);
      const sym = this.db.raw.prepare(
        `INSERT OR REPLACE INTO g_symbols (layer,id,path,name,qualname,kind,start_line,end_line,sig,sig_hash,body_hash,exported) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      for (const s of idx.symbols) sym.run(layer, s.id, s.file, s.name, s.qualname, s.kind, s.start_line, s.end_line, s.sig, s.sig_hash, s.body_hash, s.exported ? 1 : 0);
      const ref = this.db.raw.prepare(`INSERT INTO g_refs (layer,path,name,line,kind,recv,from_symbol) VALUES (?,?,?,?,?,?,?)`);
      for (const r of idx.refs) ref.run(layer, r.file, r.name, r.line, r.kind, r.recv ?? null, r.from_symbol ?? null);
      const imp = this.db.raw.prepare(`INSERT INTO g_imports (layer,path,source,names) VALUES (?,?,?,?)`);
      for (const i of idx.imports) imp.run(layer, i.file, i.source, JSON.stringify(i.names));
    });
  }

  tombstone(layer: string, path: string): void {
    this.removeFile(layer, path);
    this.db.run(`INSERT OR REPLACE INTO g_tombstones (layer, path) VALUES (?, ?)`, layer, path);
  }

  clearLayer(layer: string): void {
    for (const t of ["g_files", "g_symbols", "g_refs", "g_imports", "g_tombstones", "g_meta"]) {
      this.db.run(`DELETE FROM ${t} WHERE layer = ?`, layer);
    }
  }

  setMeta(layer: string, sha: string, baseSha?: string): void {
    this.db.run(`INSERT OR REPLACE INTO g_meta (layer, sha, base_sha, updated_at) VALUES (?,?,?,?)`, layer, sha, baseSha ?? null, nowIso());
  }

  meta(layer: string): { sha: string; base_sha: string | null } | undefined {
    return this.db.get(`SELECT sha, base_sha FROM g_meta WHERE layer = ?`, layer);
  }

  fileHashes(layer: string): Map<string, string> {
    return new Map(this.db.all<{ path: string; content_hash: string }>(`SELECT path, content_hash FROM g_files WHERE layer = ?`, layer).map((r) => [r.path, r.content_hash]));
  }

  // ---- reads ----------------------------------------------------------------

  overlayPaths(layer: string): string[] {
    return this.db.all<{ path: string }>(`SELECT path FROM g_files WHERE layer = ? UNION SELECT path FROM g_tombstones WHERE layer = ?`, layer, layer).map((r) => r.path);
  }

  symbolsByName(name: string, view: string, limit = 20): SymbolRow[] {
    const v = inView("s", view);
    return this.db.all<SymbolRow>(`SELECT * FROM g_symbols s WHERE s.name = ? AND ${v.sql} LIMIT ?`, name, ...v.params, limit);
  }

  /** Look up by exact id, qualified name, or bare name. */
  findSymbols(query: string, view: string, limit = 20): SymbolRow[] {
    const v = inView("s", view);
    if (query.includes("#")) return this.db.all<SymbolRow>(`SELECT * FROM g_symbols s WHERE s.id = ? AND ${v.sql}`, query, ...v.params);
    const byQual = this.db.all<SymbolRow>(`SELECT * FROM g_symbols s WHERE s.qualname = ? AND ${v.sql} LIMIT ?`, query, ...v.params, limit);
    if (byQual.length) return byQual;
    const name = query.split(".").pop()!;
    return this.symbolsByName(name, view, limit);
  }

  fileSymbols(path: string, view: string): SymbolRow[] {
    const v = inView("s", view);
    return this.db.all<SymbolRow>(`SELECT * FROM g_symbols s WHERE s.path = ? AND ${v.sql} ORDER BY start_line`, path, ...v.params);
  }

  private importsOf(path: string, view: string): { source: string; names: string[] }[] {
    const v = inView("i", view);
    return this.db
      .all<{ source: string; names: string }>(`SELECT source, names FROM g_imports i WHERE i.path = ? AND ${v.sql}`, path, ...v.params)
      .map((r) => ({ source: r.source, names: parseJson<string[]>(r.names, []) }));
  }

  confidenceOf(ref: RefRow, target: { path: string; name: string }, view: string): Confidence {
    if (ref.path === target.path) return "local";
    const imports = this.importsOf(ref.path, view);
    if (imports.some((i) => importPointsTo(ref.path, i.source, target.path))) return "import";
    // Java/Go reference types and packages without explicit per-symbol imports; name match is the best we have.
    return "name";
  }

  /** References to a symbol inside a view (or restricted to one layer, e.g. a workspace overlay). */
  whoCalls(target: SymbolRow, view: string, opts: { onlyLayer?: string; limit?: number } = {}): CallerHit[] {
    const kinds = [CALLABLE.has(target.kind) ? "call" : null, TYPELIKE.has(target.kind) ? "type" : null].filter(Boolean) as string[];
    if (kinds.length === 0) return [];
    const v = opts.onlyLayer ? { sql: "r.layer = ?", params: [opts.onlyLayer] as SQLInputValue[] } : inView("r", view);
    const rows = this.db.all<RefRow>(
      `SELECT * FROM g_refs r WHERE r.name = ? AND r.kind IN (${kinds.map(() => "?").join(",")}) AND ${v.sql} LIMIT ?`,
      target.name,
      ...kinds,
      ...v.params,
      opts.limit ?? 200,
    );
    return rows
      .filter((r) => r.from_symbol !== target.id) // recursion is not a caller
      .map((r) => ({ ...r, confidence: this.confidenceOf(r, target, view) }));
  }

  /** Transitive callers up to `depth`. */
  impact(target: SymbolRow, view: string, depth = 2): { symbol: string; depth: number; via: string; confidence: Confidence }[] {
    const out: { symbol: string; depth: number; via: string; confidence: Confidence }[] = [];
    const seen = new Set([target.id]);
    let frontier = [target];
    for (let d = 1; d <= depth && frontier.length; d++) {
      const next: SymbolRow[] = [];
      for (const t of frontier) {
        for (const hit of this.whoCalls(t, view)) {
          const caller = hit.from_symbol ?? `${hit.path}#<module>`;
          if (seen.has(caller)) continue;
          seen.add(caller);
          out.push({ symbol: caller, depth: d, via: t.id, confidence: hit.confidence });
          if (hit.from_symbol) next.push(...this.findSymbols(hit.from_symbol, view, 1));
        }
      }
      frontier = next;
    }
    return out;
  }

  /** Most-referenced symbols: a cheap stand-in for a repo map. */
  overview(view: string, limit = 30): { id: string; kind: string; sig: string; refs: number }[] {
    const vs = inView("s", view);
    const vr = inView("r", view);
    return this.db.all(
      `SELECT s.id, s.kind, s.sig, (SELECT COUNT(*) FROM g_refs r WHERE r.name = s.name AND ${vr.sql}) AS refs
       FROM g_symbols s WHERE ${vs.sql} AND s.kind != 'constructor' ORDER BY refs DESC LIMIT ?`,
      ...vr.params,
      ...vs.params,
      limit,
    );
  }

  stats(layer: string): { files: number; symbols: number; refs: number } {
    const c = (t: string) => (this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE layer = ?`, layer)?.n ?? 0);
    return { files: c("g_files"), symbols: c("g_symbols"), refs: c("g_refs") };
  }
}
