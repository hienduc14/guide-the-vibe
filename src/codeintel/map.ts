// Graphs for the dashboard's code map, built from the code graph tables:
//   structure  modules (folders) or files as nodes, imports between them as edges
//   calls      one symbol, the symbols that call it and the symbols it calls
// Import resolution is by path, like importPointsTo: relative imports, Python/Java dotted names, Go package paths.
// Packages from outside the repository are left out.

import { posix } from "node:path";
import { BASE, inView, type CodeGraph, type Confidence, type SymbolRow } from "./graph.ts";

export interface MapNode {
  id: string;
  label: string;
  kind: "dir" | "file";
  files: number;
  symbols: number;
  lang?: string;
}

export interface MapEdge {
  source: string;
  target: string;
  weight: number;
}

export interface StructureMap {
  level: "dir" | "file";
  depth: number;
  nodes: MapNode[];
  edges: MapEdge[];
  truncated: boolean;
}

const CODE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|go|java)$/;
const stem = (p: string) => p.replace(CODE_EXT, "").replace(/\/(index|__init__)$/, "");

/** Resolves import sources to repository files. */
class Resolver {
  private byStem = new Map<string, string>();
  private bySuffix = new Map<string, string>();
  private byDir = new Map<string, string>();

  constructor(files: string[]) {
    for (const f of files) {
      const s = stem(f);
      this.byStem.set(s, f);
      const parts = s.split("/");
      for (let i = 0; i < parts.length; i++) {
        const suffix = parts.slice(i).join("/");
        if (!this.bySuffix.has(suffix)) this.bySuffix.set(suffix, f);
      }
      const dirParts = posix.dirname(f).split("/");
      for (let i = 0; i < dirParts.length; i++) {
        const suffix = dirParts.slice(i).join("/");
        if (suffix && suffix !== "." && !this.byDir.has(suffix)) this.byDir.set(suffix, f);
      }
    }
  }

  resolve(from: string, source: string): string | undefined {
    if (source.startsWith(".")) {
      if (from.endsWith(".py")) {
        const dots = /^\.+/.exec(source)![0].length;
        let dir = posix.dirname(from);
        for (let i = 1; i < dots; i++) dir = posix.dirname(dir);
        const rest = source.slice(dots).replace(/\./g, "/");
        return this.byStem.get(posix.normalize(rest ? `${dir}/${rest}` : dir));
      }
      return this.byStem.get(stem(posix.normalize(posix.join(posix.dirname(from), source))));
    }
    // "@/lib/x" and "~/x" style aliases usually point at src/.
    const cleaned = source.replace(/^[@~]\//, "");
    const asPath = cleaned.includes("/") ? cleaned : cleaned.replace(/\./g, "/");
    return this.bySuffix.get(stem(asPath)) ?? (from.endsWith(".go") ? this.byDir.get(asPath.split("/").slice(-2).join("/")) : undefined);
  }
}

const groupOf = (path: string, depth: number) => {
  const dir = posix.dirname(path);
  return dir === "." ? "(root)" : dir.split("/").slice(0, depth).join("/");
};

/**
 * Modules (folders cut at `depth`) or files, with import edges. Without a depth, picks the deepest folder level
 * that stays readable (at most ~40 modules). File level keeps the `maxNodes` most connected files, or the files
 * under `focus` and their direct neighbours.
 */
export function structureMap(
  graph: CodeGraph,
  view = BASE,
  opts: { level?: "dir" | "file"; depth?: number; focus?: string; maxNodes?: number } = {},
): StructureMap {
  const vf = inView("f", view);
  const files = graph.db.all<{ path: string; lang: string }>(`SELECT path, lang FROM g_files f WHERE ${vf.sql}`, ...vf.params);
  const langOf = new Map(files.map((f) => [f.path, f.lang]));
  const vs = inView("s", view);
  const symbolCount = new Map(
    graph.db
      .all<{ path: string; n: number }>(`SELECT path, COUNT(*) AS n FROM g_symbols s WHERE ${vs.sql} GROUP BY path`, ...vs.params)
      .map((r) => [r.path, r.n]),
  );
  const vi = inView("i", view);
  const imports = graph.db.all<{ path: string; source: string }>(`SELECT path, source FROM g_imports i WHERE ${vi.sql}`, ...vi.params);
  const resolver = new Resolver(files.map((f) => f.path));
  const fileEdges = new Map<string, number>();
  for (const i of imports) {
    const target = resolver.resolve(i.path, i.source);
    if (!target || target === i.path) continue;
    const k = `${i.path}\0${target}`;
    fileEdges.set(k, (fileEdges.get(k) ?? 0) + 1);
  }

  const level = opts.level ?? "dir";
  if (level === "file") {
    const degree = new Map<string, number>();
    for (const k of fileEdges.keys()) for (const p of k.split("\0")) degree.set(p, (degree.get(p) ?? 0) + 1);
    let keep: Set<string>;
    if (opts.focus) {
      const inFocus = (p: string) => p === opts.focus || p.startsWith(`${opts.focus!.replace(/\/$/, "")}/`);
      keep = new Set(files.map((f) => f.path).filter(inFocus));
      for (const k of fileEdges.keys()) {
        const [a, b] = k.split("\0");
        if (inFocus(a)) keep.add(b);
        if (inFocus(b)) keep.add(a);
      }
    } else {
      keep = new Set(
        files
          .map((f) => f.path)
          .sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b))
          .slice(0, opts.maxNodes ?? 150),
      );
    }
    const max = opts.maxNodes ?? 150;
    const truncated = keep.size > max || (!opts.focus && files.length > max);
    const kept = [...keep].slice(0, max);
    const set = new Set(kept);
    return {
      level,
      depth: 0,
      truncated,
      nodes: kept.map((p) => ({ id: p, label: posix.basename(p), kind: "file", files: 1, symbols: symbolCount.get(p) ?? 0, lang: langOf.get(p) })),
      edges: [...fileEdges]
        .map(([k, weight]) => {
          const [source, target] = k.split("\0");
          return { source, target, weight };
        })
        .filter((e) => set.has(e.source) && set.has(e.target)),
    };
  }

  let depth = opts.depth ?? 0;
  if (!depth) {
    depth = 1;
    for (let d = 1; d <= 6; d++) {
      const groups = new Set(files.map((f) => groupOf(f.path, d))).size;
      if (groups > 40) break;
      depth = d;
      if (groups === new Set(files.map((f) => groupOf(f.path, d + 1))).size) break; // nothing deeper to show
    }
  }
  const nodes = new Map<string, MapNode>();
  for (const f of files) {
    const g = groupOf(f.path, depth);
    const n = nodes.get(g) ?? { id: g, label: g, kind: "dir" as const, files: 0, symbols: 0 };
    n.files++;
    n.symbols += symbolCount.get(f.path) ?? 0;
    nodes.set(g, n);
  }
  const edges = new Map<string, number>();
  for (const [k, w] of fileEdges) {
    const [a, b] = k.split("\0");
    const ga = groupOf(a, depth);
    const gb = groupOf(b, depth);
    if (ga === gb) continue;
    edges.set(`${ga}\0${gb}`, (edges.get(`${ga}\0${gb}`) ?? 0) + w);
  }
  return {
    level: "dir",
    depth,
    truncated: false,
    nodes: [...nodes.values()],
    edges: [...edges].map(([k, weight]) => {
      const [source, target] = k.split("\0");
      return { source, target, weight };
    }),
  };
}

export interface CallNode {
  id: string;
  label: string;
  kind: string;
  path: string;
  line: number;
  role: "center" | "caller" | "callee";
  sig?: string;
}

export interface CallMap {
  center?: CallNode;
  nodes: CallNode[];
  edges: { source: string; target: string; confidence: Confidence }[];
}

const callNode = (s: SymbolRow, role: CallNode["role"]): CallNode => ({
  id: s.id,
  label: s.qualname,
  kind: s.kind,
  path: s.path,
  line: s.start_line,
  role,
  sig: s.sig,
});

/** One symbol with who calls it and what it calls (one step each way). */
export function callMap(graph: CodeGraph, query: string, view = BASE, limit = 40): CallMap {
  const center = graph.findSymbols(query, view, 1)[0];
  if (!center) return { nodes: [], edges: [] };
  const nodes = new Map<string, CallNode>([[center.id, callNode(center, "center")]]);
  const edges: CallMap["edges"] = [];

  for (const hit of graph.whoCalls(center, view, { limit })) {
    const caller = hit.from_symbol ? graph.findSymbols(hit.from_symbol, view, 1)[0] : undefined;
    const id = caller?.id ?? `${hit.path}#<module>`;
    if (!nodes.has(id))
      nodes.set(
        id,
        caller
          ? callNode(caller, "caller")
          : { id, label: `${posix.basename(hit.path)} (top level)`, kind: "module", path: hit.path, line: hit.line, role: "caller" },
      );
    if (!edges.some((e) => e.source === id && e.target === center.id)) edges.push({ source: id, target: center.id, confidence: hit.confidence });
  }

  const vr = inView("r", view);
  const refs = graph.db.all<{
    name: string;
    path: string;
    line: number;
    kind: "call" | "type";
    recv: string | null;
    from_symbol: string | null;
    layer: string;
  }>(`SELECT * FROM g_refs r WHERE r.from_symbol = ? AND ${vr.sql} LIMIT 200`, center.id, ...vr.params);
  for (const r of refs) {
    if (r.name === center.name) continue;
    // Prefer a definition in the same file, then one this file imports, then any with that name.
    const candidates = graph.symbolsByName(r.name, view, 10);
    const ranked = candidates
      .map((s) => ({ s, c: graph.confidenceOf(r, s, view) }))
      .sort((a, b) => ["local", "import", "name"].indexOf(a.c) - ["local", "import", "name"].indexOf(b.c));
    const best = ranked[0];
    if (!best || (best.c === "name" && candidates.length > 3)) continue; // too ambiguous to draw
    if (!nodes.has(best.s.id)) nodes.set(best.s.id, callNode(best.s, "callee"));
    if (!edges.some((e) => e.source === center.id && e.target === best.s.id)) edges.push({ source: center.id, target: best.s.id, confidence: best.c });
    if (nodes.size > limit * 2) break;
  }
  return { center: nodes.get(center.id), nodes: [...nodes.values()], edges };
}
