// Knowledge base: business docs and ADRs from the repo (main), plus Q&A history.
// Full-text search with SQLite FTS5 (BM25). Q&A starts "unverified" until a human confirms it.

import { parse as parseYaml } from "yaml";
import type { Db } from "../../shared/db.ts";
import type { Repo } from "../project/repo.ts";
import type { Ticket } from "../../shared/types.ts";
import { globMatch, nowIso, truncate } from "../../shared/util.ts";

export type DocStatus = "active" | "unverified" | "superseded";

export interface KbDoc {
  id: string;
  type: string; // doc | req | business | adr | guide | glossary | qa
  title: string;
  body: string;
  status: DocStatus;
  /** Core document: the Operator reads it in every answer and registration judgement, and agents see its title. */
  pinned?: number;
  source: string; // repo | ticket | manual
  path?: string;
  ticket_id?: string;
  supersedes?: string;
  created_at: string;
  updated_at: string;
}

export interface KbHit {
  id: string;
  type: string;
  status: DocStatus;
  title: string;
  section: string;
  snippet: string;
  path?: string;
}

export const DEFAULT_DOC_GLOBS = ["docs/**/*.md", "*.md", ".gtv/knowledge/**/*.md", "adr/**/*.md"];

function splitFrontMatter(text: string): { meta: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  try {
    return { meta: (parseYaml(m[1]) as Record<string, unknown>) ?? {}, body: text.slice(m[0].length) };
  } catch {
    return { meta: {}, body: text };
  }
}

/** Split markdown by headings into sections (heading path, text). */
export function sections(title: string, body: string): { section: string; text: string }[] {
  const out: { section: string; text: string }[] = [];
  const stack: string[] = [];
  let current: string[] = [];
  let currentTitle = title;
  const flush = () => {
    const text = current.join("\n").trim();
    if (text) out.push({ section: currentTitle, text });
    current = [];
  };
  for (const line of body.split(/\r?\n/)) {
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      stack.length = h[1].length - 1;
      stack[h[1].length - 1] = h[2].trim();
      currentTitle = [title, ...stack.filter(Boolean)].join(" > ");
    } else {
      current.push(line);
    }
  }
  flush();
  return out.length ? out : [{ section: title, text: body.trim() }];
}

/** First markdown heading as plain text (images dropped, links reduced to their text); undefined if none. */
export function headingTitle(body: string): string | undefined {
  for (const m of body.matchAll(/^#{1,3}\s+(.+)$/gm)) {
    const text = m[1]
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]/g, "")
      .trim();
    if (text) return text;
  }
  return undefined;
}

function ftsQuery(q: string): string {
  const tokens = q.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? [];
  return [...new Set(tokens)]
    .slice(0, 16)
    .map((t) => `"${t.replace(/"/g, "")}"`)
    .join(" OR ");
}

export class KnowledgeBase {
  readonly db: Db;
  globs: string[] = DEFAULT_DOC_GLOBS;
  private lastSha?: string;

  constructor(db: Db) {
    this.db = db;
    db.ensureColumn("kb_docs", "pinned", "INTEGER NOT NULL DEFAULT 0");
  }

  upsert(doc: Omit<KbDoc, "created_at" | "updated_at"> & { created_at?: string }): KbDoc {
    const prev = this.get(doc.id);
    // Re-indexing a repo file must not drop the "core" mark someone set on the dashboard.
    const full: KbDoc = { ...doc, pinned: doc.pinned ?? prev?.pinned ?? 0, created_at: prev?.created_at ?? doc.created_at ?? nowIso(), updated_at: nowIso() };
    this.db.tx(() => {
      this.db.upsert("kb_docs", full as unknown as Record<string, unknown>);
      this.db.run(`DELETE FROM kb_fts WHERE doc_id = ?`, full.id);
      for (const s of sections(full.title, full.body)) {
        this.db.run(`INSERT INTO kb_fts (doc_id, title, body) VALUES (?,?,?)`, full.id, s.section, s.text);
      }
      if (full.supersedes) this.db.run(`UPDATE kb_docs SET status = 'superseded', updated_at = ? WHERE id = ?`, nowIso(), full.supersedes);
    });
    return full;
  }

  get(id: string): KbDoc | undefined {
    return this.db.get<KbDoc>(`SELECT * FROM kb_docs WHERE id = ?`, id);
  }

  remove(id: string): void {
    this.db.run(`DELETE FROM kb_docs WHERE id = ?`, id);
    this.db.run(`DELETE FROM kb_fts WHERE doc_id = ?`, id);
  }

  list(filter: { type?: string; status?: DocStatus } = {}): Omit<KbDoc, "body">[] {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.type) {
      where.push("type = ?");
      params.push(filter.type);
    }
    if (filter.status) {
      where.push("status = ?");
      params.push(filter.status);
    }
    return this.db.all(
      `SELECT id, type, title, status, source, path, ticket_id, supersedes, pinned, created_at, updated_at, length(body) AS size FROM kb_docs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY pinned DESC, updated_at DESC LIMIT 500`,
      ...params,
    );
  }

  /** Change a document. Repo documents only take type and the core mark: their text comes from git. */
  edit(id: string, patch: { title?: string; body?: string; type?: string; pinned?: boolean }): KbDoc | undefined {
    const doc = this.get(id);
    if (!doc) return undefined;
    const fromRepo = doc.source === "repo";
    return this.upsert({
      ...doc,
      title: !fromRepo && patch.title?.trim() ? patch.title.trim() : doc.title,
      body: !fromRepo && patch.body?.trim() ? patch.body : doc.body,
      type: patch.type?.trim() || doc.type,
      pinned: patch.pinned === undefined ? doc.pinned : patch.pinned ? 1 : 0,
    });
  }

  /** Core documents, active only. */
  core(): KbDoc[] {
    return this.db.all<KbDoc>(`SELECT * FROM kb_docs WHERE pinned = 1 AND status = 'active' ORDER BY updated_at DESC`);
  }

  /**
   * Core documents as prompt text, within a budget: whole documents while they fit, then the start of the rest.
   * The Operator can still read any document in full with kb_get.
   */
  coreText(maxChars = 8000): string {
    const out: string[] = [];
    let left = maxChars;
    for (const d of this.core()) {
      if (left < 300) {
        out.push(`- ${d.title} (${d.id}): not included here, read it with kb_get`);
        continue;
      }
      const body = d.body.length > left - 100 ? `${d.body.slice(0, left - 100)}\n… (truncated: read the rest with kb_get "${d.id}")` : d.body;
      out.push(`### ${d.title} [${d.type}, ${d.id}]\n${body.trim()}`);
      left -= body.length + d.title.length + 40;
    }
    return out.join("\n\n");
  }

  setStatus(id: string, status: DocStatus): KbDoc | undefined {
    const doc = this.get(id);
    if (!doc) return undefined;
    this.db.run(`UPDATE kb_docs SET status = ?, updated_at = ? WHERE id = ?`, status, nowIso(), id);
    return { ...doc, status };
  }

  search(query: string, opts: { limit?: number; types?: string[]; includeUnverified?: boolean } = {}): KbHit[] {
    const q = ftsQuery(query);
    if (!q) return [];
    const rows = this.db.all<{ doc_id: string; section: string; snippet: string; type: string; status: DocStatus; title: string; path: string | null }>(
      `SELECT f.doc_id, f.title AS section, snippet(kb_fts, 2, '[', ']', ' … ', 24) AS snippet, d.type, d.status, d.title, d.path
       FROM kb_fts f JOIN kb_docs d ON d.id = f.doc_id
       WHERE kb_fts MATCH ? AND d.status != 'superseded' ${opts.includeUnverified === false ? "AND d.status = 'active'" : ""}
       ORDER BY bm25(kb_fts, 0.0, 2.0, 1.0) LIMIT ?`,
      q,
      (opts.limit ?? 8) * 3,
    );
    const seen = new Set<string>();
    const out: KbHit[] = [];
    for (const r of rows) {
      if (opts.types && !opts.types.includes(r.type)) continue;
      const k = `${r.doc_id}|${r.section}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ id: r.doc_id, type: r.type, status: r.status, title: r.title, section: r.section, snippet: r.snippet, path: r.path ?? undefined });
      if (out.length >= (opts.limit ?? 8)) break;
    }
    return out;
  }

  /** Index markdown docs from main. Re-reads only when main moved. */
  async syncFromRepo(repo: Repo, mainSha: string): Promise<number> {
    if (this.lastSha === mainSha) return 0;
    const files = (await repo.listFiles(mainSha)).filter((p) => this.globs.some((g) => globMatch(g, p)));
    const contents = await repo.readFiles(mainSha, files);
    const present = new Set<string>();
    const superseded: string[] = [];
    for (const p of files) {
      const text = contents.get(p);
      if (text === undefined) continue;
      const { meta, body } = splitFrontMatter(text);
      const id = `repo:${p}`;
      present.add(id);
      const title = String(meta.title ?? headingTitle(body) ?? p);
      const type = String(meta.type ?? (/(^|\/)adr\//i.test(p) ? "adr" : "doc"));
      const status = (["active", "superseded"].includes(String(meta.status)) ? meta.status : "active") as DocStatus;
      if (meta.supersedes) superseded.push(`repo:${meta.supersedes}`);
      const prev = this.get(id);
      if (prev && prev.body === body && prev.title === title && prev.status === status) continue;
      this.upsert({ id, type, title, body, status, source: "repo", path: p, supersedes: meta.supersedes ? `repo:${meta.supersedes}` : undefined });
    }
    for (const d of this.list()) if (d.source === "repo" && !present.has(d.id)) this.remove(d.id);
    for (const s of superseded) this.db.run(`UPDATE kb_docs SET status = 'superseded' WHERE id = ?`, s);
    this.lastSha = mainSha;
    return files.length;
  }

  /** Record a closed ticket as Q&A knowledge (unverified until confirmed). */
  addQa(t: Ticket): KbDoc | undefined {
    if (!t.answer) return undefined;
    const sources = t.sources.map((s) => `${s.type}:${s.ref}`).join(", ");
    return this.upsert({
      id: `qa:${t.id}`,
      type: "qa",
      title: truncate(t.question.replace(/\s+/g, " "), 120),
      body: `Q (${t.from_dev}): ${t.question}\n\nA (${t.answered_by ?? "operator"}): ${t.answer}${sources ? `\n\nSources: ${sources}` : ""}`,
      status: "unverified",
      source: "ticket",
      ticket_id: t.id,
    });
  }
}
