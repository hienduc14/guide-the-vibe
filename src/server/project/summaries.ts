// Brain summaries for the dashboard: one line (plus a few points) per finished conversation, and a digest of the day.
// They sit on top of the structured data and never replace it: computed in the background, cached in the
// summaries table, recomputed only when what they summarise changed, capped per day, and skipped when the
// brain or the "brain.summary" feature is off (the dashboard then shows the structured fields alone).

import { createHash } from "node:crypto";
import type { Db } from "../../shared/db.ts";
import { parseJson } from "../../shared/db.ts";
import { LANGUAGE_NAME, oneLine } from "../../shared/types.ts";
import { isActive } from "../../shared/features.ts";
import { nowIso } from "../../shared/util.ts";
import type { Engine } from "./engine.ts";
import type { AiSummary, Thread } from "./conversations.ts";

const DAILY_CAP = 80;
const MAX_NEW_PER_CALL = 2;
const DAY_REFRESH_MS = 20 * 60_000;
/** Thread states after which a summary is worth writing (the conversation reached an outcome). */
const SETTLED = new Set(["answered", "closed", "expired", "acked", "resolved", "dismissed", "done"]);

interface Row {
  ref: string;
  kind: string;
  text: string;
  detail: string;
  source_hash: string;
  created_at: string;
}

const toSummary = (r: Row): AiSummary => ({ text: r.text, detail: parseJson<string[]>(r.detail, []), at: r.created_at });

export function cachedSummaries(db: Db, refs: string[]): Map<string, AiSummary> {
  const out = new Map<string, AiSummary>();
  if (!refs.length) return out;
  for (const r of db.all<Row>(`SELECT * FROM summaries WHERE ref IN (${refs.map(() => "?").join(",")})`, ...refs)) out.set(r.ref, toSummary(r));
  return out;
}

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One sentence, at most 200 characters: the outcome, who decided or agreed what" },
    points: { type: "array", items: { type: "string" }, maxItems: 5, description: "At most 5 short facts a lead needs (each under 120 characters)" },
  },
  required: ["summary", "points"],
};

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const today = () => new Date().toISOString().slice(0, 10);

class Summarizer {
  private readonly engine: Engine;
  private readonly inFlight = new Set<string>();
  private count = { day: "", n: 0 };

  constructor(engine: Engine) {
    this.engine = engine;
  }

  private get db(): Db {
    return this.engine.db;
  }

  private lang(): string {
    return LANGUAGE_NAME[this.engine.store.charter?.language ?? "vi"];
  }

  private enabled(): boolean {
    return isActive(this.engine.mode("brain.summary"));
  }

  private budget(): boolean {
    if (this.count.day !== today()) this.count = { day: today(), n: 0 };
    if (this.count.n >= DAILY_CAP) return false;
    this.count.n++;
    return true;
  }

  private cached(ref: string): Row | undefined {
    return this.db.get<Row>(`SELECT * FROM summaries WHERE ref = ?`, ref);
  }

  private save(ref: string, kind: string, out: { summary: string; points: string[] }, sourceHash: string): void {
    this.db.upsert("summaries", {
      ref,
      kind,
      text: oneLine(out.summary, 240),
      detail: (out.points ?? []).slice(0, 5).map((p) => oneLine(p, 160)),
      source_hash: sourceHash,
      created_at: nowIso(),
    });
    this.engine.store.changed();
  }

  /** Runs one summary job in the background; errors only count against the feature's circuit breaker. */
  private spawn(ref: string, kind: string, prompt: string, sourceHash: string): void {
    if (this.inFlight.has(ref) || !this.budget()) return;
    this.inFlight.add(ref);
    void this.engine
      .guarded("brain.summary", async () => {
        const res = await this.engine.brain.run<{ summary: string; points: string[] }>({
          kind: kind === "day" ? "summarize_day" : "summarize_thread",
          prompt,
          schema: SCHEMA,
          timeoutMs: 120_000,
        });
        this.save(ref, kind, res.output, sourceHash);
        this.engine.store.logEvent("summary", "operator", { ref, kind, ms: res.ms });
      })
      .finally(() => this.inFlight.delete(ref));
  }

  /** Queue summaries for settled threads whose content changed since their last summary. */
  threads(threads: Thread[]): void {
    if (!this.enabled()) return;
    let started = 0;
    for (const t of threads) {
      if (started >= MAX_NEW_PER_CALL) break;
      const settled = SETTLED.has(t.status) || (t.kind === "task" && t.entries.some((e) => e.tag === "done"));
      if (!settled || t.entries.length < 2) continue;
      const source = t.entries.map((e) => `${e.from}→${e.to ?? ""} [${e.tag ?? e.kind}] ${e.body.slice(0, 600)}`).join("\n");
      const h = hash(source);
      if (this.cached(t.id)?.source_hash === h || this.inFlight.has(t.id)) continue;
      started++;
      this.spawn(
        t.id,
        "thread",
        `Summarise this conversation from a software team's coordination tool for the team lead, in ${this.lang()}.
Say the outcome: what was asked or clashed, who answered or agreed, what was decided, what is still open. Use the people's names. Do not invent anything that is not in the messages; do not call tools.

Thread: ${t.kind} · "${t.title}" · status ${t.status}
Messages (oldest first; "gtv" and "operator" are the tool itself):
${source.slice(0, 8000)}`,
        h,
      );
    }
  }

  /** Today's digest: the cached one, refreshed in the background when the day moved on and the last one is old. */
  day(): AiSummary | undefined {
    const ref = `day:${today()}`;
    const row = this.cached(ref);
    if (!this.enabled()) return row ? toSummary(row) : undefined;
    const since = `${today()}T00:00:00`;
    const tasks = this.db.all<{ dev: string; title: string; status: string; summary: string | null; updated_at: string }>(
      `SELECT dev, title, status, summary, updated_at FROM tasks WHERE updated_at >= ? ORDER BY updated_at`,
      since,
    );
    const notes = this.db.all<{ author: string; tag: string | null; summary: string | null; body: string; board_id: string }>(
      `SELECT author, tag, summary, body, board_id FROM board_notes WHERE kind = 'note' AND created_at >= ? ORDER BY created_at`,
      since,
    );
    const conflicts = this.db.all<{ dev_a: string; dev_b: string; kind: string; level: string; subject: string; status: string }>(
      `SELECT dev_a, dev_b, kind, level, subject, status FROM conflicts WHERE updated_at >= ? AND level != 'info' ORDER BY updated_at`,
      since,
    );
    const tickets = this.db.all<{ from_dev: string; to_dev: string | null; question: string; status: string; answer: string | null }>(
      `SELECT from_dev, to_dev, question, status, answer FROM tickets WHERE updated_at >= ? ORDER BY updated_at`,
      since,
    );
    if (!tasks.length && !notes.length && !conflicts.length && !tickets.length) return row ? toSummary(row) : undefined;
    const source = [
      "Tasks:",
      ...tasks.map((t) => `- ${t.dev}: "${t.title}" (${t.status})${t.summary ? ` — ${oneLine(t.summary, 200)}` : ""}`),
      "Work notes:",
      ...notes.map((n) => `- ${n.author} [${n.tag ?? "note"}] ${n.summary ?? oneLine(n.body, 200)}`),
      "Conflicts:",
      ...conflicts.map((c) => `- ${c.dev_a} ↔ ${c.dev_b}: ${c.kind} on ${c.subject} (${c.level}, ${c.status})`),
      "Questions:",
      ...tickets.map(
        (t) => `- ${t.from_dev} → ${t.to_dev ?? "Operator"}: ${oneLine(t.question, 160)} (${t.status})${t.answer ? ` — ${oneLine(t.answer, 160)}` : ""}`,
      ),
    ].join("\n");
    const h = hash(source);
    const stale = !row || (row.source_hash !== h && Date.now() - Date.parse(row.created_at) > DAY_REFRESH_MS);
    if (stale)
      this.spawn(
        ref,
        "day",
        `Write today's digest of a small software team's work for their lead, in ${this.lang()}.
summary: one sentence on the day. points: who finished what, where people clashed and whether it is settled, what is blocked or waiting for a person.
Use the people's names. Only use the facts below; do not call tools.

${source.slice(0, 10000)}`,
        h,
      );
    return row ? toSummary(row) : undefined;
  }
}

const instances = new WeakMap<Engine, Summarizer>();
export function summarizer(engine: Engine): Summarizer {
  let s = instances.get(engine);
  if (!s) instances.set(engine, (s = new Summarizer(engine)));
  return s;
}
