// Incidents ("vụ đụng nhau"): the dashboard's unit of a clash. Detectors write one conflict row per layer, kind and
// subject, so one real collision between two people shows up as 5-8 rows. An incident groups every row about the
// same pair of workspaces; the rows become its evidence, and acting on the incident acts on all of them.
// Also: what a lead sends the two agents to settle it, and the brain's drafts of that message.

import { createHash } from "node:crypto";
import type { Engine } from "./engine.ts";
import type { Conflict, Level } from "../../shared/types.ts";
import { LANGUAGE_NAME, LEVEL_RANK } from "../../shared/types.ts";
import { parseJson } from "../../shared/db.ts";
import { isActive } from "../../shared/features.ts";
import { nowIso, shortHash } from "../../shared/util.ts";

export type IncidentStatus = "open" | "guided" | "acked" | "closed";

export interface IncidentGuide {
  at: string;
  by: string;
  body: string;
  to: { dev: string; delivered_at: string | null }[];
}

export interface Incident {
  id: string;
  workspace_a: string;
  workspace_b: string;
  dev_a: string;
  dev_b: string;
  level: Level;
  status: IncidentStatus;
  /** Closed incidents: every row was dismissed (a lead said it was a false alarm) or the clash went away. */
  closed_reason?: "dismissed" | "resolved";
  /** The strongest piece of evidence: the dashboard writes the title from it. */
  headline: { layer: string; kind: string; subject: string };
  evidence: Pick<Conflict, "id" | "layer" | "kind" | "level" | "status" | "subject" | "message" | "evidence" | "updated_at">[];
  files: string[];
  board_ids: string[];
  guide?: IncidentGuide;
  created_at: string;
  updated_at: string;
}

const LIVE = new Set(["open", "acked"]);

export const incidentId = (a: string, b: string) => `inc_${shortHash([a, b].sort().join("|"), 10)}`;

/** The file a conflict row is about, when its subject names one ("path", "path#symbol", "a ~ b"). */
function fileOf(subject: string): string | undefined {
  const s = subject.split(" ~ ")[0].split("#")[0].trim();
  if (!s || /^(symbol|planned|module|contract):/.test(s) || s.includes("↔") || /[*?]/.test(s) || !/\.[a-z0-9]+$/i.test(s)) return undefined;
  return s;
}

function strongest<T extends { level: Level; layer: string }>(rows: T[]): T {
  // Ties go to the more concrete layer: a real merge clash (L1) says more than a registry overlap (L0).
  const layerRank = (l: string) => ({ L1: 3, L2: 2, L0: 1, L3: 0 })[l] ?? 0;
  return [...rows].sort((x, y) => LEVEL_RANK[y.level] - LEVEL_RANK[x.level] || layerRank(y.layer) - layerRank(x.layer))[0];
}

/** Every incident with live evidence ("active"), or also recently closed ones ("all"). Most serious first. */
export function incidents(engine: Engine, scope: "active" | "all" = "active"): Incident[] {
  const { store, db } = engine;
  const rows = store.conflicts("all").slice(0, scope === "all" ? 400 : 2000);
  const groups = new Map<string, Conflict[]>();
  for (const c of rows) {
    const id = incidentId(c.workspace_a, c.workspace_b);
    groups.set(id, [...(groups.get(id) ?? []), c]);
  }
  const guides = guidesById(engine);
  const lastReopen = new Map<string, string>();
  for (const e of db.all<{ ts: string; payload: string }>(`SELECT ts, payload FROM event_log WHERE type = 'incident_reopen' ORDER BY id DESC LIMIT 500`)) {
    const id = parseJson<{ id?: string }>(e.payload, {}).id;
    if (id && !lastReopen.has(id)) lastReopen.set(id, e.ts);
  }
  const state = store.teamState();
  const regs = db.all<{ workspace_id: string; board_id: string | null; resources: string }>(
    `SELECT workspace_id, board_id, resources FROM tasks WHERE status IN ('registered','active','pr_open')`,
  );
  const out: Incident[] = [];
  for (const [id, cs] of groups) {
    const live = cs.filter((c) => LIVE.has(c.status));
    if (scope === "active" && !live.length) continue;
    const basis = live.length ? live : cs;
    const top = strongest(basis);
    const level = top.level;
    const [wa, wb] = [cs[0].workspace_a, cs[0].workspace_b];
    const ws = new Set([wa, wb]);
    let files = [...new Set(basis.map((c) => fileOf(c.subject)).filter((f): f is string => !!f))];
    if (!files.length) {
      // L3 only (two tasks that clash in intent): the files both sides touch or registered.
      const touched = (w: string) =>
        new Set([
          ...state.footprints.filter((f) => f.workspace_id === w).map((f) => f.path),
          ...regs
            .filter((r) => r.workspace_id === w)
            .flatMap((r) =>
              parseJson<{ kind: string; value: string }[]>(r.resources, [])
                .filter((x) => x.kind === "path")
                .map((x) => x.value),
            ),
        ]);
      const b = touched(wb);
      files = [...touched(wa)].filter((p) => b.has(p) && fileOf(p));
    }
    const guide = guides.get(id);
    const reopened = lastReopen.get(id);
    const freshGuide = guide && (!reopened || guide.at >= reopened) ? guide : undefined;
    const status: IncidentStatus = !live.length ? "closed" : live.some((c) => c.status === "open") ? "open" : freshGuide ? "guided" : "acked";
    out.push({
      id,
      workspace_a: top.workspace_a,
      workspace_b: top.workspace_b,
      dev_a: top.dev_a,
      dev_b: top.dev_b,
      level,
      status,
      closed_reason: status === "closed" ? (cs.every((c) => c.status === "dismissed") ? "dismissed" : "resolved") : undefined,
      headline: { layer: top.layer, kind: top.kind, subject: top.subject },
      evidence: [...basis]
        .sort((x, y) => LEVEL_RANK[y.level] - LEVEL_RANK[x.level] || x.layer.localeCompare(y.layer))
        .map((c) => ({
          id: c.id,
          layer: c.layer,
          kind: c.kind,
          level: c.level,
          status: c.status,
          subject: c.subject,
          message: c.message,
          evidence: c.evidence,
          updated_at: c.updated_at,
        })),
      files,
      board_ids: [...new Set(regs.filter((r) => ws.has(r.workspace_id) && r.board_id).map((r) => r.board_id!))],
      guide: freshGuide,
      created_at: cs.reduce((m, c) => (c.created_at < m ? c.created_at : m), cs[0].created_at),
      updated_at: cs.reduce((m, c) => (c.updated_at > m ? c.updated_at : m), cs[0].updated_at),
    });
  }
  const statusRank: Record<IncidentStatus, number> = { open: 3, acked: 2, guided: 1, closed: 0 };
  return out.sort(
    (a, b) => statusRank[b.status] - statusRank[a.status] || LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || b.updated_at.localeCompare(a.updated_at),
  );
}

export function incident(engine: Engine, id: string): Incident | undefined {
  return incidents(engine, "all").find((i) => i.id === id);
}

function guidesById(engine: Engine): Map<string, IncidentGuide> {
  const out = new Map<string, IncidentGuide>();
  for (const e of engine.db.all<{ ts: string; actor: string | null; payload: string }>(
    `SELECT ts, actor, payload FROM event_log WHERE type = 'incident_guided' ORDER BY id DESC LIMIT 300`,
  )) {
    const p = parseJson<{ id?: string; body?: string; messages?: { dev: string; id: string }[] }>(e.payload, {});
    if (!p.id || out.has(p.id)) continue;
    const to = (p.messages ?? []).map((m) => ({
      dev: m.dev,
      delivered_at: engine.db.get<{ delivered_at: string | null }>(`SELECT delivered_at FROM messages WHERE id = ?`, m.id)?.delivered_at ?? null,
    }));
    out.set(p.id, { at: e.ts, by: e.actor ?? "?", body: p.body ?? "", to });
  }
  return out;
}

/** ack | dismiss | reopen on every live (or, to reopen, every closed) row of the incident. */
export function actOnIncident(engine: Engine, id: string, action: "ack" | "dismiss" | "reopen", by: string): Incident {
  const inc = incident(engine, id);
  if (!inc) throw new Error("unknown incident");
  const status = ({ ack: "acked", dismiss: "dismissed", reopen: "open" } as const)[action];
  const rows = action === "reopen" ? inc.evidence.filter((c) => c.status !== "resolved") : inc.evidence.filter((c) => LIVE.has(c.status));
  for (const c of rows) {
    engine.store.setConflictStatus(c.id, status);
    engine.store.logEvent(`conflict_${action}`, by, { id: c.id }); // conversations() shows these per conflict thread
  }
  engine.store.logEvent(`incident_${action}`, by, { id });
  return incident(engine, id)!;
}

/** Send the lead's guidance to the chosen agents, then mark the incident as handled. */
export function guideIncident(engine: Engine, id: string, input: { body?: string; to?: string[] }, by: string): Incident {
  const inc = incident(engine, id);
  if (!inc) throw new Error("unknown incident");
  const body = (input.body ?? "").trim();
  if (!body) throw new Error("body is required");
  const to = (input.to ?? []).filter((d) => d === inc.dev_a || d === inc.dev_b);
  if (!to.length) throw new Error("choose who receives it");
  const ref = inc.evidence[0]?.id;
  const lead = by === "admin" ? "the team lead" : `${by} (team lead)`;
  const messages = to.map((dev) => {
    const other = dev === inc.dev_a ? inc.dev_b : inc.dev_a;
    const m = engine.store.addMessage({
      to_dev: dev,
      kind: "info",
      from_dev: by,
      ref_id: ref,
      body: `[gtv guidance from ${lead} about your clash with ${other}] ${body}`,
    });
    return { dev, id: m.id };
  });
  for (const c of inc.evidence.filter((x) => x.status === "open")) engine.store.setConflictStatus(c.id, "acked");
  engine.store.logEvent("incident_guided", by, { id, body, to, messages });
  return incident(engine, id)!;
}

// ---- brain drafts --------------------------------------------------------------------------

export interface Plan {
  title: string;
  text: string;
}

const PLANS_SCHEMA = {
  type: "object",
  properties: {
    plans: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "3-6 words naming the approach, e.g. who goes first" },
          text: {
            type: "string",
            description: "The message to both agents: who does what, in which order, 1-3 sentences, concrete names of functions and files",
          },
        },
        required: ["title", "text"],
      },
    },
  },
  required: ["plans"],
};
const REWRITE_SCHEMA = { type: "object", properties: { text: { type: "string" } }, required: ["text"] };
const DAILY_CAP = 60;

function describe(engine: Engine, inc: Incident): string {
  const work = (ws: string) =>
    engine.store
      .teamState()
      .tasks.filter((t) => t.workspace_id === ws)
      .map((t) => `"${t.title}"${t.goal ? ` (goal: ${t.goal})` : ""}`)
      .join("; ") || "no registered task";
  return [
    `${inc.dev_a} is working on: ${work(inc.workspace_a)}`,
    `${inc.dev_b} is working on: ${work(inc.workspace_b)}`,
    `Files: ${inc.files.join(", ") || "-"}`,
    "What gtv detected:",
    ...inc.evidence.slice(0, 10).map((c) => `- [${c.layer} ${c.kind}, ${c.level}] ${c.message.slice(0, 600)}`),
  ].join("\n");
}

class Suggester {
  private readonly engine: Engine;
  private readonly inFlight = new Set<string>();
  private count = { day: "", n: 0 };

  constructor(engine: Engine) {
    this.engine = engine;
  }

  private enabled(): boolean {
    return isActive(this.engine.mode("brain.suggest"));
  }

  private lang(): string {
    return LANGUAGE_NAME[this.engine.store.charter?.language ?? "vi"];
  }

  private budget(): boolean {
    const day = new Date().toISOString().slice(0, 10);
    if (this.count.day !== day) this.count = { day, n: 0 };
    return this.count.n < DAILY_CAP;
  }

  /** Cached drafts for an incident; when missing or stale, starts writing them in the background and returns []. */
  plans(inc: Incident): Plan[] {
    const ref = `plan:${inc.id}`;
    const source = describe(this.engine, inc);
    const h = createHash("sha256").update(source).digest("hex").slice(0, 16);
    const row = this.engine.db.get<{ detail: string; source_hash: string }>(`SELECT detail, source_hash FROM summaries WHERE ref = ?`, ref);
    const cached = row ? parseJson<Plan[]>(row.detail, []) : [];
    if (row?.source_hash === h || !this.enabled() || this.inFlight.has(ref) || !this.budget()) return cached;
    this.inFlight.add(ref);
    void this.engine
      .guarded("brain.suggest", async () => {
        const res = await this.engine.brain.run<{ plans: Plan[] }>({
          kind: "suggest_resolution",
          schema: PLANS_SCHEMA,
          timeoutMs: 120_000,
          prompt: `Two developers' AI coding agents clash in a shared repository. Draft 2 or 3 different ways to settle it, in ${this.lang()}.
Each plan is a short message the team lead will send to both agents: who does what, in which order, naming the functions and files. Prefer plans that avoid both sides editing the same lines.
Only use the facts below; do not call tools.

${source.slice(0, 9000)}`,
        });
        this.count.n++;
        const plans = (res.output.plans ?? []).filter((p) => p.title && p.text).slice(0, 3);
        this.engine.db.upsert("summaries", {
          ref,
          kind: "plan",
          text: plans[0]?.text.slice(0, 240) ?? "",
          detail: plans,
          source_hash: h,
          created_at: nowIso(),
        });
        this.engine.store.changed();
      })
      .finally(() => this.inFlight.delete(ref));
    return cached;
  }

  /** The same instruction in other words; "" when the brain is off or fails. */
  async rewrite(inc: Incident, text: string): Promise<string> {
    if (!this.enabled() || !text.trim() || !this.budget()) return "";
    const out = await this.engine.guarded("brain.suggest", async () => {
      const res = await this.engine.brain.run<{ text: string }>({
        kind: "suggest_resolution",
        schema: REWRITE_SCHEMA,
        timeoutMs: 60_000,
        prompt: `Rewrite this instruction to two developers' coding agents in ${this.lang()}: keep exactly the same plan, names and order, change the wording, make it clear and short. Do not call tools.

Context:
${describe(this.engine, inc).slice(0, 4000)}

Instruction:
${text.slice(0, 2000)}`,
      });
      this.count.n++;
      return res.output.text ?? "";
    });
    return out ?? "";
  }
}

const instances = new WeakMap<Engine, Suggester>();
export function suggester(engine: Engine): Suggester {
  let s = instances.get(engine);
  if (!s) instances.set(engine, (s = new Suggester(engine)));
  return s;
}
