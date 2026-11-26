// The dashboard's side-by-side diff: several people's diffs of one file lined up against the base.

import { test } from "node:test";
import assert from "node:assert/strict";
import { alignDiffs, parseDiff } from "../web/src/lib/diff.ts";

const BASE = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
/** A whole-file unified diff of BASE → edited, as git diff -U100000 prints it. */
function diff(edit: (lines: string[]) => string[]): string {
  const after = edit([...BASE]);
  // naive LCS-free diff good enough for these cases: common prefix/suffix, the middle replaced
  let p = 0;
  while (p < BASE.length && p < after.length && BASE[p] === after[p]) p++;
  let s = 0;
  while (s < BASE.length - p && s < after.length - p && BASE[BASE.length - 1 - s] === after[after.length - 1 - s]) s++;
  const body = [
    ...BASE.slice(0, p).map((l) => ` ${l}`),
    ...BASE.slice(p, BASE.length - s).map((l) => `-${l}`),
    ...after.slice(p, after.length - s).map((l) => `+${l}`),
    ...BASE.slice(BASE.length - s).map((l) => ` ${l}`),
  ];
  return `--- a/f.ts\n+++ b/f.ts\n@@ -1,${BASE.length} +1,${after.length} @@\n${body.join("\n")}\n`;
}
const insertAfter =
  (n: number, ...lines: string[]) =>
  (b: string[]) => [...b.slice(0, n), ...lines, ...b.slice(n)];
const replace = (n: number, line: string) => (b: string[]) => b.map((l, i) => (i === n - 1 ? line : l));

test("parseDiff numbers lines in the base file", () => {
  const l = parseDiff(diff(replace(3, "three")));
  assert.deepEqual(
    l.filter((x) => x.type !== "ctx"),
    [
      { type: "del", text: "line 3", old: 3 },
      { type: "add", text: "three", old: 4 },
    ],
  );
});

test("two insertions at the same place are one clashing segment", () => {
  const segs = alignDiffs({ hien: diff(insertAfter(10, "validateImage()")), test: diff(insertAfter(10, "if (bio) {", "}")) });
  const chg = segs.filter((s) => s.kind === "chg");
  assert.equal(chg.length, 1);
  assert.equal(chg[0].kind === "chg" && chg[0].clash, true);
  if (chg[0].kind !== "chg") return;
  assert.deepEqual(chg[0].changes.hien.rows, [{ t: "add", text: "validateImage()" }]);
  assert.equal(chg[0].changes.test.rows.length, 2);
});

test("changes far apart stay separate and do not clash; long unchanged runs fold", () => {
  const segs = alignDiffs({ a: diff(replace(3, "three")), b: diff(replace(25, "twenty-five")) });
  const chg = segs.filter((s) => s.kind === "chg");
  assert.equal(chg.length, 2);
  assert.ok(chg.every((s) => s.kind === "chg" && !s.clash));
  assert.ok(segs.some((s) => s.kind === "fold"));
  // every base line is accounted for exactly once
  const covered = segs.reduce((n, s) => n + (s.kind === "ctx" ? s.lines.length : s.kind === "fold" ? s.count : s.base.length), 0);
  assert.equal(covered, BASE.length);
});

test("one person edits a line the other removes nearby: same place", () => {
  const segs = alignDiffs({ a: diff(replace(12, "twelve")), b: diff((b) => b.filter((_, i) => i !== 12)) });
  const chg = segs.filter((s) => s.kind === "chg");
  assert.equal(chg.length, 1);
  if (chg[0].kind !== "chg") return;
  assert.equal(chg[0].clash, true);
  assert.deepEqual(chg[0].base, ["line 12", "line 13"]);
  assert.deepEqual(chg[0].changes.a.rows, [
    { t: "del", text: "line 12" },
    { t: "add", text: "twelve" },
    { t: "ctx", text: "line 13" },
  ]);
});
