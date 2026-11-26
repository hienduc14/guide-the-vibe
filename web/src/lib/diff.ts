// Several people's diffs of one file, lined up against the base so they can be shown side by side.
// Pure functions, no imports: tested in test/web-diff.test.ts.

export interface DiffLine {
  type: "add" | "del" | "ctx";
  text: string;
  /** Line number in the base file: for "add" lines, the base line they are inserted before. */
  old: number;
}

export function parseDiff(diff: string): DiffLine[] {
  const out: DiffLine[] = [];
  let oldNo = 0;
  let inHunk = false;
  for (const line of diff.replace(/\n$/, "").split("\n")) {
    const h = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(line);
    if (h) {
      oldNo = Number(h[1]);
      // "-0,0" means an insertion at the top of the file
      if (oldNo === 0) oldNo = 1;
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith("\\")) continue;
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) out.push({ type: "add", text: line.slice(1), old: oldNo });
    else if (line.startsWith("-")) out.push({ type: "del", text: line.slice(1), old: oldNo++ });
    else if (line.startsWith(" ") || line === "") out.push({ type: "ctx", text: line.slice(1), old: oldNo++ });
  }
  return out;
}

/** One person's version of a span of base lines, as rows: kept, removed, written. */
export interface Change {
  rows: { t: "ctx" | "del" | "add"; text: string }[];
}

export type Segment =
  | { kind: "ctx"; start: number; lines: string[] }
  | { kind: "fold"; start: number; count: number }
  | { kind: "chg"; start: number; base: string[]; changes: Record<string, Change>; clash: boolean };

interface Edit {
  who: string;
  from: number; // first base line touched (for a pure insertion: the line it goes before)
  to: number; // last base line removed; from - 1 for a pure insertion
  del: string[];
  add: string[];
}

function editsOf(who: string, lines: DiffLine[]): Edit[] {
  const out: Edit[] = [];
  let cur: Edit | undefined;
  for (const l of lines) {
    if (l.type === "ctx") {
      if (cur) out.push(cur);
      cur = undefined;
      continue;
    }
    if (!cur) cur = { who, from: l.old, to: l.old - 1, del: [], add: [] };
    if (l.type === "del") {
      cur.del.push(l.text);
      cur.to = l.old;
    } else cur.add.push(l.text);
  }
  if (cur) out.push(cur);
  return out;
}

/** Changes closer than this many base lines are one place: git would clash on them too. */
const NEAR = 1;
/** Unchanged runs longer than this fold their middle away. */
const KEEP = 3;

/**
 * Line up several people's diffs of the same file (same base). `base` maps base line numbers to text, from
 * the context lines the diffs carry (ask the server for whole-file context to see everything).
 */
export function alignDiffs(diffs: Record<string, string>): Segment[] {
  const base = new Map<number, string>();
  const edits: Edit[] = [];
  for (const [who, diff] of Object.entries(diffs)) {
    const lines = parseDiff(diff);
    for (const l of lines) if (l.type !== "add") base.set(l.old, l.text);
    edits.push(...editsOf(who, lines));
  }
  if (!edits.length) return [];
  edits.sort((a, b) => a.from - b.from || a.to - b.to);
  // Group edits whose base ranges touch or come within NEAR lines.
  const groups: Edit[][] = [];
  let end = -Infinity;
  for (const e of edits) {
    const last = groups.at(-1);
    if (last && e.from <= end + NEAR) {
      last.push(e);
      end = Math.max(end, e.to, e.from - 1);
    } else {
      groups.push([e]);
      end = Math.max(e.to, e.from - 1);
    }
  }
  const lines = [...base.keys()].sort((a, b) => a - b);
  const first = lines[0] ?? 1;
  const lastLine = lines.at(-1) ?? 0;
  const out: Segment[] = [];
  let cursor = first;
  const pushCtx = (from: number, to: number, edges: { head: boolean; tail: boolean }) => {
    if (to < from) return;
    const run: number[] = [];
    for (let n = from; n <= to; n++) run.push(n);
    // Keep KEEP lines next to a change, fold the rest.
    const keepHead = edges.head ? KEEP : 0;
    const keepTail = edges.tail ? KEEP : 0;
    if (run.length > keepHead + keepTail + 1) {
      if (keepHead) out.push({ kind: "ctx", start: from, lines: run.slice(0, keepHead).map((n) => base.get(n) ?? "") });
      const foldFrom = from + keepHead;
      const foldCount = run.length - keepHead - keepTail;
      out.push({ kind: "fold", start: foldFrom, count: foldCount });
      if (keepTail) out.push({ kind: "ctx", start: to - keepTail + 1, lines: run.slice(-keepTail).map((n) => base.get(n) ?? "") });
    } else out.push({ kind: "ctx", start: from, lines: run.map((n) => base.get(n) ?? "") });
  };
  groups.forEach((g, gi) => {
    const from = Math.min(...g.map((e) => e.from));
    const to = Math.max(...g.map((e) => Math.max(e.to, e.from - 1)));
    pushCtx(cursor, from - 1, { head: gi > 0, tail: true });
    const baseLines: string[] = [];
    for (let n = from; n <= to; n++) baseLines.push(base.get(n) ?? "");
    const changes: Record<string, Change> = {};
    for (const who of new Set(g.map((e) => e.who)))
      changes[who] = versionOf(
        g.filter((e) => e.who === who),
        from,
        to,
        base,
      );
    out.push({ kind: "chg", start: from, base: baseLines, changes, clash: Object.keys(changes).length > 1 });
    cursor = to + 1;
  });
  pushCtx(cursor, lastLine, { head: true, tail: false });
  return out;
}

/** One person's rows for base lines from..to: the lines they kept, removed and wrote. */
function versionOf(mine: Edit[], from: number, to: number, base: Map<number, string>): Change {
  const rows: Change["rows"] = [];
  let n = from;
  for (const e of [...mine].sort((a, b) => a.from - b.from)) {
    for (; n < e.from; n++) rows.push({ t: "ctx", text: base.get(n) ?? "" });
    for (const d of e.del) rows.push({ t: "del", text: d });
    for (const x of e.add) rows.push({ t: "add", text: x });
    n = Math.max(n, e.to + 1);
  }
  for (; n <= to; n++) rows.push({ t: "ctx", text: base.get(n) ?? "" });
  return { rows };
}

export const counts = (diff: string) => {
  const l = parseDiff(diff);
  return { add: l.filter((x) => x.type === "add").length, del: l.filter((x) => x.type === "del").length };
};
