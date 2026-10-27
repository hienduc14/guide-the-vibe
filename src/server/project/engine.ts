// Engine: turns daemon events into registry updates, runs detectors per feature mode, and notifies.

import type { Db } from "../../shared/db.ts";
import { Store } from "./store.ts";
import type { Repo } from "./repo.ts";
import { KnowledgeBase, type KbHit } from "../knowledge/kb.ts";
import { CodeGraph, BASE } from "../../codeintel/graph.ts";
import { syncBase, syncOverlay, workspaceChanges } from "../../codeintel/indexer.ts";
import { detectL0, outOfScope, type FoundConflict } from "../detect/l0.ts";
import { detectL1For } from "../detect/l1.ts";
import { detectL2Pair, saveSymbolChanges, saveChangedLines, changedLineFilter } from "../detect/l2.ts";
import { type Brain, BrainUnavailable, Semaphore } from "../brain/types.ts";
import { REGISTRATION_SCHEMA, registrationPrompt, type RegistrationOutput, INTENT_SCHEMA, intentPrompt } from "../brain/prompts.ts";
import { CircuitBreaker, resolveFeatures, isActive, type FeatureKey, FEATURE_KEYS } from "../../shared/features.ts";
import type { Conflict, FeatureMode, GtvEvent, Session, Task, TaskRegistration, Workspace, Level } from "../../shared/types.ts";
import { LEVEL_RANK } from "../../shared/types.ts";
import { log, nowIso, truncate } from "../../shared/util.ts";

export interface EngineConfig {
  featureDefaults: Partial<Record<string, FeatureMode>>;
  registrationWaitMs: number;
  l3DailyBudget: number;
}

export interface RegistrationFeedback {
  task: Task;
  status: "ok" | "adjust_suggested" | "needs_coordination";
  overlaps: { conflict_id: string; layer: string; level: Level; with: string; message: string }[];
  knowledge: KbHit[];
  advice?: string;
  l3: "done" | "pending" | "off" | "shadow" | "unavailable";
}

export class Engine {
  readonly store: Store;
  readonly db: Db;
  readonly graph: CodeGraph;
  readonly kb: KnowledgeBase;
  readonly repo?: Repo;
  readonly brain: Brain;
  readonly breaker = new CircuitBreaker();
  readonly cfg: EngineConfig;
  private gitLock = new Semaphore(1);
  private driftWarned = new Set<string>();
  private l3Count = { day: "", n: 0 };
  mainSha?: string;

  constructor(opts: { db: Db; repo?: Repo; brain: Brain; cfg: EngineConfig }) {
    this.db = opts.db;
    this.store = new Store(opts.db);
    this.graph = new CodeGraph(opts.db);
    this.kb = new KnowledgeBase(opts.db);
    this.repo = opts.repo;
    this.brain = opts.brain;
    this.cfg = opts.cfg;
    this.store.features = () => this.features();
  }

  // ---- feature flags --------------------------------------------------------

  features(): Record<FeatureKey, FeatureMode> {
    const overrides: Partial<Record<string, FeatureMode>> = { ...this.cfg.featureDefaults };
    for (const r of this.db.all<{ feature: string; mode: FeatureMode }>(`SELECT feature, mode FROM feature_overrides`)) overrides[r.feature] = r.mode;
    for (const f of Object.keys(this.breaker.all())) overrides[f] = "off";
    if (this.brain.name === "null") overrides.brain = "off";
    if (!this.repo) {
      overrides["detect.l1_merge"] = "off";
      overrides["knowledge.code_graph"] = "off";
    }
    return resolveFeatures(overrides);
  }

  mode(f: FeatureKey): FeatureMode {
    return this.features()[f];
  }

  setFeature(f: string, mode: FeatureMode | null): void {
    if (!FEATURE_KEYS.includes(f as FeatureKey)) throw new Error(`unknown feature ${f}`);
    if (mode === null) this.db.run(`DELETE FROM feature_overrides WHERE feature = ?`, f);
    else this.db.upsert("feature_overrides", { feature: f, mode, updated_at: nowIso() });
    this.breaker.reset(f);
    this.store.changed();
  }

  /** Run `fn` for a feature; failures count towards its circuit breaker and never escape. */
  async guarded<T>(f: FeatureKey, fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (e) {
      const msg = (e as Error).message;
      log("engine", `${f} failed: ${msg}`);
      this.store.logEvent("feature_error", undefined, { feature: f, error: msg });
      if (!(e instanceof BrainUnavailable) && this.breaker.fail(f, msg)) {
        log("engine", `circuit breaker tripped for ${f}`);
        this.store.changed();
      }
      return undefined;
    }
  }

  // ---- conflicts → notifications ---------------------------------------------

  /** Apply one layer's findings according to its feature mode. */
  applyLayer(f: FeatureKey, layer: string, found: FoundConflict[], scope: (c: Conflict) => boolean): Conflict[] {
    const mode = this.mode(f);
    if (mode === "shadow") {
      if (found.length) this.store.logEvent("shadow_conflicts", undefined, { feature: f, found });
      this.store.syncConflicts(layer, [], scope);
      return [];
    }
    const fresh = this.store.syncConflicts(layer, mode === "on" ? found : [], scope);
    if (mode === "on") this.notifyConflicts(fresh);
    return fresh;
  }

  notifyConflicts(conflicts: Conflict[]): void {
    for (const c of conflicts) {
      this.store.logEvent("conflict", undefined, c);
      if (c.level === "info") continue; // visible in status, not pushed into agents
      for (const [ws, dev] of [
        [c.workspace_a, c.dev_a],
        [c.workspace_b, c.dev_b],
      ] as const) {
        if (ws === "main") continue;
        this.store.addMessage({
          to_dev: dev,
          to_workspace: ws,
          kind: "conflict",
          ref_id: c.id,
          body: `[gtv ${c.level.toUpperCase()} · ${c.layer}] ${c.message}\n(conflict ${c.id} — after coordinating, acknowledge it with the gtv_ack tool)`,
        });
      }
    }
  }

  // ---- events ---------------------------------------------------------------------

  async handle(dev: string, ev: GtvEvent): Promise<Record<string, unknown>> {
    switch (ev.type) {
      case "session_start": {
        const session = this.store.upsertSession({ ...ev.session, dev });
        this.store.logEvent("session_start", dev, ev.session);
        return { session, briefing: this.briefing(session) };
      }
      case "session_end":
        this.store.endSession(ev.session_id);
        return {};
      case "prompt":
        this.store.touchSession(ev.session_id);
        this.store.logEvent("prompt", dev, { session_id: ev.session_id, prompt: truncate(ev.prompt, 500) });
        return {};
      case "plan":
        return { registered: await this.onPlan(ev.session_id, ev.plan) };
      case "edit":
        return this.onEdit(ev.session_id, ev.paths);
      case "snapshot":
        void this.onSnapshot(ev.workspace_id, ev.sha, ev.branch);
        return { accepted: true };
    }
  }

  briefing(session: Session): string {
    const state = this.store.teamState();
    const others = state.tasks.filter((t) => t.workspace_id !== session.workspace_id);
    const mine = state.conflicts.filter((c) => c.workspace_a === session.workspace_id || c.workspace_b === session.workspace_id);
    const waiting = this.store.tickets({ status: ["forwarded", "waiting_human"], to_dev: session.dev });
    const lines = ["gtv Project Operator is active for this repo."];
    if (others.length) {
      lines.push("Teammates' active tasks:");
      for (const t of others) {
        const paths = t.resources
          .filter((r) => r.kind !== "module")
          .map((r) => r.value)
          .slice(0, 4)
          .join(", ");
        lines.push(`- ${t.dev}: "${t.title}"${paths ? ` (${paths})` : ""}`);
      }
    } else lines.push("No teammate has an active task right now.");
    if (mine.length) lines.push(`Open conflicts involving you: ${mine.map((c) => `${c.id} ${c.level} ${c.subject}`).join("; ")}`);
    if (waiting.length)
      lines.push(`Questions waiting for your answer: ${waiting.map((t) => `${t.id}: ${truncate(t.forwarded_question ?? t.question, 120)}`).join(" | ")}`);
    lines.push(
      "Before editing files, register your task with the gtv_register_task tool (title, goal, paths/symbols you will touch). Ask the Operator with gtv_ask when you need to know what others are doing or how something works.",
    );
    return lines.join("\n");
  }

  private usageOf = (symbol: string, workspaceId: string) => {
    if (!isActive(this.mode("knowledge.code_graph"))) return [];
    const targets = this.graph.findSymbols(symbol, BASE, 3);
    const written = changedLineFilter(this.db, workspaceId);
    return targets.flatMap((t) =>
      this.graph
        .whoCalls(t, workspaceId, { onlyLayer: workspaceId })
        .filter((h) => written(h.path, h.line))
        .map((h) => ({ path: h.path, line: h.line, confidence: h.confidence })),
    );
  };

  runL0(): Conflict[] {
    if (this.mode("detect.l0_path") === "off") {
      this.store.syncConflicts("L0", [], () => true);
      return [];
    }
    const found = detectL0({
      workspaces: this.store.activeWorkspaces(),
      tasks: this.store.activeTasks(),
      footprints: this.store.footprints(),
      policy: this.store.policy,
      usageOf: this.usageOf,
    });
    return this.applyLayer("detect.l0_path", "L0", found, () => true);
  }

  onEdit(sessionId: string, paths: string[]): Record<string, unknown> {
    const session = this.store.session(sessionId);
    if (!session) return { error: "unknown session" };
    this.store.touchSession(sessionId);
    const fresh = this.store.addFootprints(session, paths);
    if (fresh.length) this.runL0();
    const task = this.store.sessionTask(sessionId);
    const drift: string[] = [];
    if (this.mode("drift_check") !== "off") {
      for (const p of paths) {
        if (!outOfScope(task, p)) continue;
        const key = `${sessionId}|${p}`;
        if (this.driftWarned.has(key)) continue;
        this.driftWarned.add(key);
        drift.push(p);
      }
      if (drift.length) {
        this.store.logEvent("drift", session.dev, { session: sessionId, task: task?.id, paths: drift });
        if (this.mode("drift_check") === "on") {
          this.store.addMessage({
            to_dev: session.dev,
            to_session: session.id,
            kind: "info",
            body: `[gtv] You are editing ${drift.join(", ")} outside the scope registered for task "${task!.title}". If this is intended, extend the registration with gtv_update_task so teammates see it.`,
          });
        }
      }
    }
    return { fresh, drift };
  }

  // ---- registration ------------------------------------------------------------

  async register(session: Session, reg: TaskRegistration): Promise<RegistrationFeedback> {
    const task = this.store.registerTask(session, reg);
    this.store.logEvent("register", session.dev, task);
    this.runL0();

    const conflicts = this.store.conflicts("open").filter((c) => c.workspace_a === session.workspace_id || c.workspace_b === session.workspace_id);
    const ws = (id: string) => this.store.workspace(id);
    const overlaps = conflicts.map((c) => {
      const otherWs = c.workspace_a === session.workspace_id ? c.workspace_b : c.workspace_a;
      return {
        conflict_id: c.id,
        layer: c.layer,
        level: c.level,
        with: otherWs === "main" ? "main" : `${ws(otherWs)?.dev} (${ws(otherWs)?.label})`,
        message: c.message,
      };
    });
    const knowledge = isActive(this.mode("knowledge.doc_kb"))
      ? this.kb.search(`${reg.title} ${reg.goal ?? ""} ${reg.resources.map((r) => r.value).join(" ")}`, { limit: 4 })
      : [];

    let l3: RegistrationFeedback["l3"] = "off";
    let advice: string | undefined;
    const l3Mode = this.mode("detect.l3_semantic");
    const others = this.store.activeTasks().filter((t) => t.workspace_id !== session.workspace_id);
    if (l3Mode !== "off" && others.length && this.l3Budget()) {
      const job = this.judgeRegistration(task, others, conflicts);
      const res = await Promise.race([job, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), this.cfg.registrationWaitMs))]);
      if (res === "timeout") l3 = "pending";
      else if (res === undefined) l3 = "unavailable";
      else {
        l3 = l3Mode === "shadow" ? "shadow" : "done";
        if (l3Mode === "on") {
          advice = res.advice;
          for (const o of res.overlaps) {
            const c = this.store
              .conflicts("open")
              .find(
                (x) =>
                  x.layer === "L3" &&
                  (x.evidence as { tasks?: string[] }).tasks?.includes(o.task_id) &&
                  (x.evidence as { tasks?: string[] }).tasks?.includes(task.id),
              );
            if (c) overlaps.push({ conflict_id: c.id, layer: "L3", level: c.level, with: `${c.dev_a === task.dev ? c.dev_b : c.dev_a}`, message: c.message });
          }
        }
      }
    }
    const worst = overlaps.reduce((m, o) => Math.max(m, LEVEL_RANK[o.level]), -1);
    const status = worst >= LEVEL_RANK.high ? "needs_coordination" : worst >= LEVEL_RANK.warning ? "adjust_suggested" : "ok";
    return { task, status, overlaps, knowledge, advice, l3 };
  }

  private l3Budget(): boolean {
    const day = new Date().toISOString().slice(0, 10);
    if (this.l3Count.day !== day) this.l3Count = { day, n: 0 };
    if (this.l3Count.n >= this.cfg.l3DailyBudget) return false;
    this.l3Count.n++;
    return true;
  }

  /** L3: LLM judgement of a new registration against other active tasks. Runs to completion even if the caller stopped waiting. */
  private judgeRegistration(task: Task, others: Task[], evidence: Conflict[]): Promise<RegistrationOutput | undefined> {
    return this.guarded("detect.l3_semantic", async () => {
      const brief = (t: Task) => ({ task_id: t.id, dev: t.dev, workspace: t.workspace_id, title: t.title, goal: t.goal, resources: t.resources });
      const res = await this.brain.run<RegistrationOutput>({
        kind: "judge_registration",
        prompt: registrationPrompt({
          task: brief(task),
          others: others.map(brief),
          evidence: evidence.map((c) => ({ layer: c.layer, level: c.level, subject: c.subject, message: c.message })),
        }),
        schema: REGISTRATION_SCHEMA,
      });
      this.store.logEvent("l3_registration", task.dev, { task: task.id, output: res.output, ms: res.ms });
      const found: FoundConflict[] = [];
      for (const o of res.output.overlaps) {
        const other = others.find((t) => t.id === o.task_id);
        if (!other) continue;
        const [x, y] = task.workspace_id < other.workspace_id ? [task, other] : [other, task];
        found.push({
          key: `L3|${x.workspace_id}|${y.workspace_id}|${x.id}|${y.id}`,
          layer: "L3",
          kind: "semantic",
          level: o.level,
          workspace_a: x.workspace_id,
          workspace_b: y.workspace_id,
          dev_a: x.dev,
          dev_b: y.dev,
          subject: `${task.title} ↔ ${other.title}`,
          evidence: { tasks: [task.id, other.id], reason: o.reason, suggestion: o.suggestion, sources: res.output.sources },
          message: `Operator: task "${task.title}" (${task.dev}) and "${other.title}" (${other.dev}) may conflict: ${o.reason} Suggestion: ${o.suggestion}`,
        });
      }
      this.applyLayer("detect.l3_semantic", "L3", found, (c) => (c.evidence as { tasks?: string[] }).tasks?.includes(task.id) ?? false);
      return res.output;
    });
  }

  private async onPlan(sessionId: string, plan: string): Promise<string | undefined> {
    const session = this.store.session(sessionId);
    if (!session || this.store.sessionTask(sessionId)) return undefined;
    const mode = this.mode("registration.auto_from_plan");
    if (mode === "off") return undefined;
    const out = await this.guarded("registration.auto_from_plan", () =>
      this.brain.run<TaskRegistration>({ kind: "extract_intent_from_plan", prompt: intentPrompt(plan), schema: INTENT_SCHEMA }),
    );
    if (!out) return undefined;
    this.store.logEvent("plan_intent", session.dev, { session: sessionId, intent: out.output, mode });
    if (mode !== "on") return undefined;
    const fb = await this.register(session, { ...out.output, resources: out.output.resources.map((r) => ({ ...r, source: "plan" as const })) });
    this.store.addMessage({
      to_dev: session.dev,
      to_session: session.id,
      kind: "info",
      body: `[gtv] Registered task "${fb.task.title}" from your plan (${fb.task.id}). Status: ${fb.status}.${fb.overlaps.length ? " Overlaps: " + fb.overlaps.map((o) => o.message).join(" | ") : ""} Fix the scope with gtv_update_task if it is wrong.`,
    });
    return fb.task.id;
  }

  // ---- snapshots & repo ----------------------------------------------------------

  async onSnapshot(workspaceId: string, sha: string, branch?: string): Promise<void> {
    if (!this.repo) return;
    await this.gitLock.use(async () => {
      const ws = this.store.workspace(workspaceId);
      if (!ws) return;
      await this.repo!.fetch();
      const main = (this.mainSha = await this.repo!.mainSha());
      if (!(await this.repo!.revParse(sha))) {
        log("engine", `snapshot ${sha} for ${workspaceId} not found after fetch`);
        return;
      }
      const base = main ? await this.repo!.mergeBase(sha, main) : undefined;
      this.store.setSnapshot(workspaceId, sha, base, branch);
      this.store.logEvent("snapshot", ws.dev, { workspace: workspaceId, sha, base });
      if (main && isActive(this.mode("knowledge.code_graph"))) {
        await this.guarded("knowledge.code_graph", async () => {
          await syncBase(this.graph, this.repo!, main);
          await syncOverlay(this.graph, this.repo!, workspaceId, sha, main);
        });
        if (isActive(this.mode("detect.l2_symbol"))) {
          await this.guarded("detect.l2_symbol", async () => {
            const ch = await workspaceChanges(this.repo!, sha, main);
            if (ch) {
              saveSymbolChanges(this.db, workspaceId, ch.changes);
              saveChangedLines(this.db, workspaceId, await this.repo!.changedLines(ch.mergeBase, sha));
            }
          });
        }
      }
      if (main) await this.closeIfMerged(workspaceId, main);
      await this.detectForWorkspace(workspaceId);
      this.runL0(); // planned-breaking-change checks depend on fresh overlays
    });
  }

  private async detectForWorkspace(workspaceId: string): Promise<void> {
    const ws = this.store.workspace(workspaceId);
    if (!ws?.snapshot_sha) return;
    const others = this.store.activeWorkspaces().filter((w) => w.id !== workspaceId && w.snapshot_sha);
    const involves = (c: Conflict) => c.workspace_a === workspaceId || c.workspace_b === workspaceId;
    if (this.mode("detect.l1_merge") !== "off") {
      const found = await this.guarded("detect.l1_merge", () => detectL1For(this.repo!, ws, others, this.mainSha));
      if (found) this.applyLayer("detect.l1_merge", "L1", found, involves);
    }
    if (this.mode("detect.l2_symbol") !== "off") {
      const found: FoundConflict[] = [];
      for (const o of others) found.push(...detectL2Pair(this.db, this.graph, ws, o));
      this.applyLayer("detect.l2_symbol", "L2", found, involves);
    }
  }

  /** Periodic: fetch, follow main, pick up snapshots pushed without an event, close merged work. */
  async pollRepo(): Promise<void> {
    if (!this.repo) return;
    let changedMain = false;
    const pending: [string, string][] = [];
    await this.gitLock.use(async () => {
      await this.repo!.fetch();
      const main = await this.repo!.mainSha();
      changedMain = !!main && main !== this.mainSha;
      this.mainSha = main;
      if (main && changedMain) {
        if (isActive(this.mode("knowledge.code_graph"))) await this.guarded("knowledge.code_graph", () => syncBase(this.graph, this.repo!, main));
        if (isActive(this.mode("knowledge.doc_kb"))) await this.guarded("knowledge.doc_kb", () => this.kb.syncFromRepo(this.repo!, main));
        await this.closeMergedWork(main);
      }
      const refs = await this.repo!.snapshotRefs();
      for (const ws of this.store.activeWorkspaces()) {
        const sha = refs.get(`refs/gtv/${ws.dev}/${ws.id}`);
        if (sha && sha !== ws.snapshot_sha) pending.push([ws.id, sha]);
      }
    });
    for (const [id, sha] of pending) await this.onSnapshot(id, sha);
    if (changedMain && pending.length === 0) {
      for (const ws of this.store.activeWorkspaces()) if (ws.snapshot_sha) await this.gitLock.use(() => this.detectForWorkspace(ws.id));
    }
  }

  /** Finished/abandoned tasks: their semantic (L3) conflicts go away, path/symbol overlaps are recomputed. */
  tasksClosed(taskIds: string[]): void {
    if (!taskIds.length) return;
    this.store.syncConflicts("L3", [], (c) => ((c.evidence as { tasks?: string[] }).tasks ?? []).some((id) => taskIds.includes(id)));
    this.runL0();
  }

  private async closeMergedWork(main: string): Promise<void> {
    for (const ws of this.store.workspaces()) await this.closeIfMerged(ws.id, main);
  }

  /**
   * A workspace is done when its snapshot has no WIP on top of a commit that is already in main and
   * that was committed after its tasks were registered (a fresh clone of main must not close new tasks).
   */
  private async closeIfMerged(workspaceId: string, main: string): Promise<void> {
    const ws = this.store.workspace(workspaceId);
    if (!ws?.snapshot_sha) return;
    const parent = await this.repo!.revParse(`${ws.snapshot_sha}^`);
    if (!parent) return;
    if ((await this.repo!.mergeBase(parent, main)) !== parent) return;
    if ((await this.repo!.diffNames(parent, ws.snapshot_sha)).length > 0) return;
    const committedAt = await this.repo!.commitTime(parent);
    const tasks = this.store.activeTasks().filter((t) => t.workspace_id === ws.id && committedAt && committedAt >= t.created_at);
    const leftover = this.store.footprints().some((f) => f.workspace_id === ws.id);
    if (!tasks.length && !leftover) return;
    for (const t of tasks) this.store.updateTask(t.id, { status: "done" });
    this.tasksClosed(tasks.map((t) => t.id));
    this.store.clearFootprints(ws.id);
    this.graph.clearLayer(ws.id);
    saveSymbolChanges(this.db, ws.id, []);
    saveChangedLines(this.db, ws.id, new Map());
    this.store.logEvent("work_merged", ws.dev, { workspace: ws.id, commit: parent, tasks: tasks.map((t) => t.id) });
  }
}
