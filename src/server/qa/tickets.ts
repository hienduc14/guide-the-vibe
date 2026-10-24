// Q&A with three tiers:
//  1. the Operator brain answers from code graph / KB / WIP;
//  2. questions needing a teammate's decision are forwarded into that teammate's agent;
//  3. if that agent cannot decide (or nobody answers in time), the human is asked.
// gtv_ask never blocks for long: it returns an answer or a ticket id; late answers are pushed to the asker.

import type { Engine } from "../project/engine.ts";
import type { Session, Ticket } from "../../shared/types.ts";
import { ANSWER_SCHEMA, answerPrompt, type AnswerOutput } from "../brain/prompts.ts";
import { isActive } from "../../shared/features.ts";
import { newId, nowIso, truncate } from "../../shared/util.ts";

export interface TicketConfig {
  askWaitMs: number;
  tier2TimeoutMs: number;
  tier3TimeoutMs: number;
}

export interface AskInput {
  session: Session;
  question: string;
  context?: string;
  to_dev?: string;
}

export class TicketService {
  private readonly engine: Engine;
  private readonly cfg: TicketConfig;
  /** Tickets whose asker already got a synchronous reply; later updates must be pushed as messages. */
  private detached = new Set<string>();

  constructor(engine: Engine, cfg: TicketConfig) {
    this.engine = engine;
    this.cfg = cfg;
  }

  private get store() {
    return this.engine.store;
  }

  private save(t: Ticket): Ticket {
    t.updated_at = nowIso();
    this.store.saveTicket(t);
    this.store.changed();
    return t;
  }

  private devs(): string[] {
    return [...new Set(this.store.workspaces().map((w) => w.dev))];
  }

  async ask(input: AskInput): Promise<Ticket> {
    const now = nowIso();
    const t: Ticket = {
      id: newId("tk"),
      from_session: input.session.id,
      from_dev: input.session.dev,
      question: input.question,
      context: input.context,
      tier: 1,
      status: "answering",
      sources: [],
      created_at: now,
      updated_at: now,
    };
    this.save(t);
    this.store.logEvent("ticket_ask", t.from_dev, { id: t.id, question: t.question, to_dev: input.to_dev });

    if (input.to_dev && input.to_dev !== t.from_dev) {
      return this.forward(t, input.to_dev, input.question, "Asked directly by the agent.");
    }
    const tier1 = this.engine.mode("qa.tier1_answer");
    if (tier1 === "off") {
      t.status = "closed";
      t.answer = "The Operator brain is disabled. Re-ask with to_dev set to the teammate who should answer.";
      return this.save(t);
    }
    const job = this.runTier1(t, input.session);
    const res = await Promise.race([job, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), this.cfg.askWaitMs))]);
    if (res === "timeout") {
      this.detached.add(t.id);
      return this.store.ticket(t.id)!;
    }
    return res;
  }

  private async runTier1(t: Ticket, session: Session): Promise<Ticket> {
    const task = this.store.sessionTask(session.id);
    const ws = this.store.workspace(session.workspace_id);
    const out = await this.engine.guarded("qa.tier1_answer", () =>
      this.engine.brain.run<AnswerOutput>({
        kind: "answer_question",
        prompt: answerPrompt({
          asker: session.dev,
          askerWorkspace: `${session.workspace_id} (${ws?.label ?? "?"})`,
          askerTask: task ? `${task.title} — ${task.goal ?? ""}` : undefined,
          question: t.question,
          context: t.context,
          teammates: this.devs().filter((d) => d !== session.dev),
        }),
        schema: ANSWER_SCHEMA,
      }),
    );
    const cur = this.store.ticket(t.id)!;
    if (!out) {
      // Brain unavailable: fall back to the asker's own human.
      return this.finish(cur, {
        status: "closed",
        answer: "The Operator could not answer (brain unavailable). Ask your user, or re-ask with to_dev set to a teammate.",
        confidence: "low",
      });
    }
    const o = out.output;
    this.store.logEvent("ticket_tier1", t.from_dev, { id: t.id, output: o, ms: out.ms });
    const shadow = this.engine.mode("qa.tier1_answer") === "shadow";
    cur.sources = o.sources as Ticket["sources"];
    cur.confidence = o.confidence;
    if (o.route === "answer" && !shadow && o.confidence !== "low") {
      return this.finish(cur, { status: "answered", answer: o.answer, answered_by: "operator" });
    }
    const target = o.forward_to_dev && this.devs().includes(o.forward_to_dev) && o.forward_to_dev !== t.from_dev ? o.forward_to_dev : undefined;
    if (target && o.route === "forward" && isActive(this.engine.mode("qa.tier2_relay"))) {
      return this.forward(cur, target, o.forward_question || t.question, o.answer);
    }
    if (target && o.route === "human" && isActive(this.engine.mode("qa.tier3_human"))) {
      return this.askHuman(cur, target, o.forward_question || t.question, o.answer);
    }
    return this.finish(cur, {
      status: "closed",
      answer: `${o.answer}\n(The Operator is not confident. Check with your user before relying on this.)`,
    });
  }

  private forward(t: Ticket, toDev: string, question: string, note: string): Ticket {
    t.tier = 2;
    t.status = "forwarded";
    t.to_dev = toDev;
    t.forwarded_question = question;
    t.answer = note;
    this.save(t);
    this.store.addMessage({
      to_dev: toDev,
      kind: "ticket_question",
      ref_id: t.id,
      body: `[gtv question ${t.id} from ${t.from_dev}] ${question}\nAnswer with the gtv_reply tool (ticket_id "${t.id}") if you can decide from your task and code; if your user must decide, call gtv_reply with escalate=true and ask them.`,
    });
    this.notifyAsker(t, `Question ${t.id} was forwarded to ${toDev}. Continue with other work; the answer will be delivered to you.`);
    return t;
  }

  private askHuman(t: Ticket, toDev: string, question: string, note?: string): Ticket {
    t.tier = 3;
    t.status = "waiting_human";
    t.to_dev = toDev;
    t.forwarded_question ??= question;
    if (note) t.answer = note;
    this.save(t);
    this.store.addMessage({
      to_dev: toDev,
      kind: "human_request",
      ref_id: t.id,
      body: `[gtv] ${t.from_dev} needs your decision (${t.id}): ${question}\nReply in a terminal: gtv answer ${t.id} "<your answer>"`,
    });
    this.notifyAsker(t, `Question ${t.id} is waiting for ${toDev} (a human decision is needed).`);
    return t;
  }

  private finish(t: Ticket, patch: Partial<Ticket>): Ticket {
    Object.assign(t, patch);
    this.save(t);
    if (t.status === "answered" && isActive(this.engine.mode("knowledge.doc_kb"))) this.engine.kb.addQa(t);
    this.notifyAsker(t, this.formatAnswer(t));
    return t;
  }

  formatAnswer(t: Ticket): string {
    const src = t.sources.length ? `\nSources: ${t.sources.map((s) => `${s.type}:${s.ref}`).join(", ")}` : "";
    return `[gtv answer ${t.id} from ${t.answered_by ?? "operator"}${t.confidence ? `, confidence ${t.confidence}` : ""}] Q: ${truncate(t.question, 200)}\nA: ${t.answer}${src}`;
  }

  /** Push to the asker only once the synchronous gtv_ask call has returned (otherwise it carries the result). */
  private notifyAsker(t: Ticket, body: string): void {
    if (!this.detached.has(t.id)) return;
    const s = this.store.session(t.from_session);
    this.store.addMessage({ to_dev: t.from_dev, to_session: s?.status === "ended" ? undefined : t.from_session, to_workspace: s?.workspace_id, kind: "ticket_answer", ref_id: t.id, body });
  }

  /** The synchronous ask() response has been sent; from now on push updates. */
  detach(id: string): void {
    this.detached.add(id);
  }

  reply(input: { ticket_id: string; answer: string; by: string; escalate?: boolean }): Ticket {
    const t = this.store.ticket(input.ticket_id);
    if (!t) throw new Error(`unknown ticket ${input.ticket_id}`);
    if (t.status === "answered" || t.status === "closed" || t.status === "expired") throw new Error(`ticket ${t.id} is already ${t.status}`);
    this.detached.add(t.id);
    if (input.escalate) {
      return this.askHuman(t, t.to_dev ?? input.by, t.forwarded_question ?? t.question, input.answer || undefined);
    }
    return this.finish(t, { status: "answered", answer: input.answer, answered_by: input.by, confidence: "high" });
  }

  /** Timeouts: forwarded → human, human → expired. */
  tick(now = Date.now()): void {
    for (const t of this.store.tickets({ status: ["forwarded", "waiting_human"] })) {
      const age = now - Date.parse(t.updated_at);
      if (t.status === "forwarded" && age > this.cfg.tier2TimeoutMs && isActive(this.engine.mode("qa.tier3_human"))) {
        this.detached.add(t.id);
        this.askHuman(t, t.to_dev!, t.forwarded_question ?? t.question);
      } else if (age > this.cfg.tier3TimeoutMs && (t.status === "waiting_human" || t.status === "forwarded")) {
        this.detached.add(t.id);
        this.finish(t, { status: "expired", answer: `Nobody answered within the time limit. Decide with your user or ask ${t.to_dev} directly.` });
      }
    }
  }
}
