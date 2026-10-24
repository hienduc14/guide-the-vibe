// Keeps the code graph in sync with git: base layer = main, overlay = files of a snapshot that differ
// from main. Also computes what a workspace changed (symbol diff vs its merge base) for L2.

import { CodeGraph, BASE } from "./graph.ts";
import { indexFile, type SymbolDef } from "./extract.ts";
import { langForPath } from "./languages.ts";
import { diffSymbols, type SymbolChange } from "./diff.ts";
import type { Repo, DiffEntry } from "../server/project/repo.ts";

const SKIP_DIRS = /(^|\/)(node_modules|vendor|dist|build|out|target|\.git|\.venv|venv|__pycache__|\.next|coverage)\//;
const MAX_BYTES = 512 * 1024;

export function indexable(path: string): boolean {
  return !!langForPath(path) && !SKIP_DIRS.test(path) && !/\.min\.js$/.test(path) && !/\.d\.ts$/.test(path);
}

async function indexInto(graph: CodeGraph, repo: Repo, layer: string, sha: string, paths: string[], blobs: Map<string, string>): Promise<void> {
  const BATCH = 200;
  for (let i = 0; i < paths.length; i += BATCH) {
    const chunk = paths.slice(i, i + BATCH);
    const contents = await repo.readFiles(sha, chunk);
    for (const p of chunk) {
      const text = contents.get(p);
      if (text === undefined || text.length > MAX_BYTES) {
        graph.removeFile(layer, p);
        continue;
      }
      const idx = await indexFile(p, text);
      if (!idx) continue;
      idx.content_hash = blobs.get(p) ?? idx.content_hash;
      graph.replaceFile(layer, idx);
    }
  }
}

/** Re-index only files whose blob changed. Returns the number of (re)indexed files. */
export async function syncBase(graph: CodeGraph, repo: Repo, mainSha: string): Promise<number> {
  if (graph.meta(BASE)?.sha === mainSha) return 0;
  const blobs = new Map([...(await repo.listBlobs(mainSha))].filter(([p]) => indexable(p)));
  const known = graph.fileHashes(BASE);
  const changed = [...blobs].filter(([p, oid]) => known.get(p) !== oid).map(([p]) => p);
  for (const p of known.keys()) if (!blobs.has(p)) graph.removeFile(BASE, p);
  await indexInto(graph, repo, BASE, mainSha, changed, blobs);
  graph.setMeta(BASE, mainSha);
  return changed.length;
}

export async function syncOverlay(graph: CodeGraph, repo: Repo, layer: string, snapshotSha: string, mainSha: string): Promise<number> {
  const meta = graph.meta(layer);
  if (meta?.sha === snapshotSha && meta.base_sha === mainSha) return 0;
  const mainBlobs = await repo.listBlobs(mainSha);
  const snapBlobs = await repo.listBlobs(snapshotSha);
  const known = graph.fileHashes(layer);
  const wanted = new Map<string, string>();
  for (const [p, oid] of snapBlobs) if (indexable(p) && mainBlobs.get(p) !== oid) wanted.set(p, oid);
  const deleted = [...mainBlobs.keys()].filter((p) => indexable(p) && !snapBlobs.has(p));

  for (const p of graph.overlayPaths(layer)) {
    if (!wanted.has(p) && !deleted.includes(p)) graph.removeFile(layer, p);
  }
  for (const p of deleted) graph.tombstone(layer, p);
  const changed = [...wanted].filter(([p, oid]) => known.get(p) !== oid).map(([p]) => p);
  await indexInto(graph, repo, layer, snapshotSha, changed, wanted);
  graph.setMeta(layer, snapshotSha, mainSha);
  return changed.length;
}

async function symbolsAt(repo: Repo, sha: string, paths: string[]): Promise<SymbolDef[]> {
  const contents = await repo.readFiles(sha, paths);
  const out: SymbolDef[] = [];
  for (const p of paths) {
    const text = contents.get(p);
    if (text === undefined || text.length > MAX_BYTES) continue;
    const idx = await indexFile(p, text);
    if (idx) out.push(...idx.symbols);
  }
  return out;
}

export interface WorkspaceChanges {
  mergeBase: string;
  files: DiffEntry[];
  changes: SymbolChange[];
}

/** What the workspace changed relative to where it branched off main. */
export async function workspaceChanges(repo: Repo, snapshotSha: string, mainSha: string): Promise<WorkspaceChanges | undefined> {
  const mergeBase = await repo.mergeBase(snapshotSha, mainSha);
  if (!mergeBase) return undefined;
  const files = await repo.diffNames(mergeBase, snapshotSha);
  const paths = files.map((f) => f.path).filter(indexable);
  const before = await symbolsAt(repo, mergeBase, paths);
  const after = await symbolsAt(repo, snapshotSha, paths);
  return { mergeBase, files, changes: diffSymbols(before, after) };
}
