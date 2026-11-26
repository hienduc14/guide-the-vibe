// Dashboard API (/api): accounts and computers, projects, members, statistics, layers and brain settings.
// Mutations on a project's tasks/conflicts/tickets/knowledge reuse the project API (/v1/p/:id) with the admin token.

import { Hono } from "hono";
import type { Hub } from "../hub/hub.ts";
import type { ProjectRuntime } from "../project/runtime.ts";
import type { AuthVars } from "./auth.ts";
import { bearer, openMode, publicOrigin } from "./auth.ts";
import type { Principal, Role } from "../hub/accounts.ts";
import type { MemberAccess } from "../../shared/types.ts";
import { FEATURES, FEATURE_KEYS, isActive } from "../../shared/features.ts";
import { BASE } from "../../codeintel/graph.ts";
import type { Level } from "../../shared/types.ts";
import { PiBrain } from "../brain/pi.ts";
import { attention, conversations } from "../project/conversations.ts";
import { incident, suggester } from "../project/incidents.ts";
import { summarizer } from "../project/summaries.ts";
import { loadSymbolChanges } from "../detect/l2.ts";
import { globMatch, normPath } from "../../shared/util.ts";

type Env = { Variables: AuthVars };

const STATUS_RANK: Record<string, number> = { ended: 0, idle: 1, active: 2 };

/** Feature key → conflict layer it produces (for per-layer metrics). */
const LAYER_OF: Record<string, string> = { "detect.l0_path": "L0", "detect.l1_merge": "L1", "detect.l2_symbol": "L2", "detect.l3_semantic": "L3" };

export function summarize(rt: ProjectRuntime) {
  const { store } = rt.engine;
  const state = store.teamState();
  const sessions = store.sessions(true);
  const byLevel: Record<Level, number> = { info: 0, warning: 0, high: 0, critical: 0 };
  for (const c of state.conflicts) byLevel[c.level]++;
  const items = rt.engine.board.list().filter((t) => t.status !== "cancelled");
  const people = new Map<
    string,
    {
      dev: string;
      role: string | null;
      level: string | null;
      status: string;
      agents: Set<string>;
      workspaces: Set<string>;
      last_seen: string;
      tasks: string[];
      editing: number;
      conflicts: number;
    }
  >();
  for (const s of sessions) {
    const p = people.get(s.dev) ?? {
      dev: s.dev,
      role: store.member(s.dev)?.role ?? null,
      level: store.member(s.dev)?.level ?? null,
      status: "ended",
      agents: new Set(),
      workspaces: new Set(),
      last_seen: s.last_seen,
      tasks: [],
      editing: 0,
      conflicts: 0,
    };
    if (s.status !== "ended") p.agents.add(s.agent);
    const ws = store.workspace(s.workspace_id);
    if (ws && s.status !== "ended") p.workspaces.add(ws.label);
    if (STATUS_RANK[s.status] > STATUS_RANK[p.status]) p.status = s.status;
    if (s.last_seen > p.last_seen) p.last_seen = s.last_seen;
    people.set(s.dev, p);
  }
  for (const t of state.tasks) people.get(t.dev)?.tasks.push(t.title);
  for (const f of state.footprints) if (people.has(f.dev)) people.get(f.dev)!.editing++;
  for (const c of state.conflicts) for (const d of [c.dev_a, c.dev_b]) if (people.has(d)) people.get(d)!.conflicts++;
  // "Đang làm": has work in progress (a registration or a board item) and an agent session that has not ended
  // (seen in the last 2 hours). Every count of people at work on the dashboard uses this one rule.
  const working = (p: { dev: string; status: string; tasks: string[] }) =>
    p.status !== "ended" && (p.tasks.length > 0 || items.some((t) => t.status === "in_progress" && t.assignee === p.dev));
  return {
    id: rt.record.id,
    name: rt.record.name,
    description: rt.record.description,
    repo_url: rt.record.repo_url.replace(/\/\/[^@/]+@/, "//***@"),
    main_branch: rt.record.main_branch,
    main_sha: rt.engine.mainSha ?? null,
    last_sync: rt.lastSync ?? null,
    counts: {
      // "Đang làm": has work in progress (a board item or a registration) and an agent session that has not ended
      // (seen in the last 2 hours). Every place on the dashboard counts people this one way.
      people_active: [...people.values()].filter(working).length,
      sessions_active: state.sessions.filter((s) => s.status === "active").length,
      tasks_active: state.tasks.length,
      conflicts_open: state.conflicts.length,
      conflicts_by_level: byLevel,
      tickets_waiting: store.tickets({ status: ["answering", "forwarded", "waiting_human"] }).length,
      kb_unverified: rt.engine.kb.list({ status: "unverified" }).length,
    },
    board: {
      total: items.length,
      done: items.filter((t) => t.status === "done").length,
      open: items.filter((t) => t.status !== "done").length,
      in_progress: items.filter((t) => t.status === "in_progress").length,
      overdue: items.filter((t) => t.overdue).length,
      blocked: items.filter((t) => t.blocked).length,
    },
    charter: rt.record.charter ?? {},
    attention: attention(rt.engine).length,
    members: store.members(),
    people: [...people.values()]
      .map((p) => ({ ...p, working: working(p), agents: [...p.agents], workspaces: [...p.workspaces] }))
      .sort((a, b) => (a.status === b.status ? a.dev.localeCompare(b.dev) : a.status === "active" ? -1 : 1)),
  };
}

function stats(hub: Hub, rt: ProjectRuntime, days: number) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const db = rt.db;
  const count = (sql: string, ...p: string[]) => db.all<{ k: string; n: number }>(sql, ...p);
  return {
    days,
    brain: hub.brainStats({ project: rt.record.id, days }),
    conflicts: {
      byLayer: count(`SELECT layer AS k, COUNT(*) AS n FROM conflicts WHERE created_at >= ? GROUP BY layer`, since),
      byLevel: count(`SELECT level AS k, COUNT(*) AS n FROM conflicts WHERE created_at >= ? GROUP BY level`, since),
      byStatus: count(`SELECT status AS k, COUNT(*) AS n FROM conflicts WHERE created_at >= ? GROUP BY status`, since),
      byDay: count(`SELECT substr(created_at, 1, 10) AS k, COUNT(*) AS n FROM conflicts WHERE created_at >= ? GROUP BY k ORDER BY k`, since),
    },
    tickets: {
      byTier: count(`SELECT CAST(tier AS TEXT) AS k, COUNT(*) AS n FROM tickets WHERE created_at >= ? GROUP BY tier`, since),
      byStatus: count(`SELECT status AS k, COUNT(*) AS n FROM tickets WHERE created_at >= ? GROUP BY status`, since),
    },
    events: {
      byType: count(`SELECT type AS k, COUNT(*) AS n FROM event_log WHERE ts >= ? GROUP BY type ORDER BY n DESC`, since),
      byDay: count(`SELECT substr(ts, 1, 10) AS k, COUNT(*) AS n FROM event_log WHERE ts >= ? GROUP BY k ORDER BY k`, since),
    },
    kb: count(`SELECT type || ':' || status AS k, COUNT(*) AS n FROM kb_docs GROUP BY type, status`),
  };
}

function layers(rt: ProjectRuntime) {
  const { engine, db } = rt;
  const modes = engine.features();
  const tripped = engine.breaker.all();
  const shadow = new Map<string, number>();
  for (const r of db.all<{ payload: string }>(`SELECT payload FROM event_log WHERE type = 'shadow_conflicts' ORDER BY id DESC LIMIT 500`)) {
    try {
      const p = JSON.parse(r.payload) as { feature: string; found: unknown[] };
      shadow.set(p.feature, (shadow.get(p.feature) ?? 0) + p.found.length);
    } catch {
      // ignore malformed rows
    }
  }
  const errors = new Map(
    db
      .all<{ f: string; n: number }>(`SELECT json_extract(payload, '$.feature') AS f, COUNT(*) AS n FROM event_log WHERE type = 'feature_error' GROUP BY f`)
      .map((r) => [r.f, r.n]),
  );
  const overrides = new Map(db.all<{ feature: string; mode: string }>(`SELECT feature, mode FROM feature_overrides`).map((r) => [r.feature, r.mode]));
  return FEATURE_KEYS.map((key) => {
    const def = FEATURES[key] as { default: string; requires?: string[]; description: string };
    const layer = LAYER_OF[key];
    const metrics: Record<string, number | string | null> = {};
    if (layer) {
      metrics.open = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM conflicts WHERE layer = ? AND status IN ('open','acked')`, layer)!.n;
      metrics.total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM conflicts WHERE layer = ?`, layer)!.n;
      metrics.shadow_detections = shadow.get(key) ?? 0;
    }
    if (key === "knowledge.code_graph") Object.assign(metrics, engine.graph.stats(BASE));
    if (key === "knowledge.doc_kb") metrics.documents = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM kb_docs`)!.n;
    if (key.startsWith("qa.")) {
      const tier = key === "qa.tier1_answer" ? 1 : key === "qa.tier2_relay" ? 2 : 3;
      metrics.tickets = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM tickets WHERE tier = ?`, tier)!.n;
    }
    if (key === "drift_check") metrics.drift_events = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM event_log WHERE type = 'drift'`)!.n;
    if (key === "registration") metrics.tasks = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM tasks`)!.n;
    const blocked_by = (def.requires ?? []).filter((r) => modes[r as keyof typeof modes] === "off");
    if (key === "brain" && engine.brain.name === "null") blocked_by.push("BRAIN_BACKEND=null");
    if (tripped[key]) blocked_by.push("circuit breaker");
    return {
      key,
      layer: layer ?? null,
      description: def.description,
      default: def.default,
      requires: def.requires ?? [],
      mode: modes[key],
      override: overrides.get(key) ?? null, // set by hand (dashboard/CLI); null = config default
      blocked_by, // why an "on" setting is effectively off
      tripped: tripped[key] ?? null,
      errors: errors.get(key) ?? 0,
      metrics,
    };
  });
}

export function adminRoutes(hub: Hub): Hono<Env> {
  const app = new Hono<Env>();
  const rt = (id: string) => hub.runtime(id);

  // ---- accounts ----------------------------------------------------------------------

  const session = (r: { token: string; expires_at: string; user: { name: string; role: Role } }) => ({
    token: r.token,
    expires_at: r.expires_at,
    name: r.user.name,
    role: r.user.role,
  });
  app.post("/login", async (c) => {
    const { name, password } = (await c.req.json()) as { name?: string; password?: string };
    return c.json(session(hub.accounts.login(String(name ?? ""), String(password ?? ""))));
  });
  app.post("/logout", (c) => {
    const t = bearer(c);
    if (t) hub.accounts.logout(t);
    return c.json({ ok: true });
  });
  app.get("/me", (c) => {
    const p = c.get("principal")!;
    return c.json({
      name: p.name,
      role: p.role,
      kind: p.kind,
      project: p.project ?? null,
      open_mode: openMode(hub),
      has_users: hub.accounts.hasUsers(),
      projects: hub.myProjects(p).map(({ record, access }) => ({ id: record.id, name: record.name, access })),
    });
  });

  // Activation links: the code is the credential (one use, 48 hours).
  app.get("/activate/:code", (c) => c.json(hub.accounts.activationInfo(c.req.param("code"))));
  app.post("/activate/:code", async (c) => {
    const { password } = (await c.req.json().catch(() => ({}))) as { password?: string };
    return c.json(session(hub.accounts.activate(c.req.param("code"), String(password ?? ""))));
  });

  const myName = (c: { get: (k: "principal") => Principal | undefined }) => {
    const p = c.get("principal")!;
    if (p.kind !== "user") throw new Error("log in with your own account for this");
    return p.name;
  };
  app.get("/me/devices", (c) => c.json(c.get("principal")!.kind === "user" ? hub.accounts.devices(c.get("principal")!.name) : []));
  app.delete("/me/devices/:id", (c) => {
    if (!hub.accounts.removeDevice(c.req.param("id"), myName(c))) throw new Error("unknown computer");
    return c.json({ ok: true });
  });
  app.put("/me/password", async (c) => {
    const { current, password } = (await c.req.json()) as { current?: string; password?: string };
    hub.accounts.changePassword(myName(c), String(current ?? ""), String(password ?? ""));
    return c.json(session(hub.accounts.login(myName(c), String(password))));
  });

  // Approving a computer that ran `gtv login`: it joins the account of whoever is logged in here.
  app.get("/connect/:code", (c) => {
    const r = hub.accounts.connectRequest(c.req.param("code"));
    return r ? c.json(r) : c.json({ error: "unknown or expired code: run gtv login again" }, 404);
  });
  app.post("/connect/:code/:action{approve|deny}", (c) => {
    hub.accounts.decideConnect(c.req.param("code"), myName(c), c.req.param("action") === "approve");
    return c.json({ ok: true });
  });

  /** Account names, for choosing project members. */
  app.get("/people", (c) => c.json(hub.accounts.users().map((u) => ({ name: u.name }))));

  const activationUrl = (c: Parameters<typeof publicOrigin>[0], name: string) => {
    const a = hub.accounts.createActivation(name);
    return { activation_url: `${publicOrigin(c)}/activate/${a.code}`, expires_at: a.expires_at };
  };
  app.get("/users", (c) => {
    const devices = hub.accounts.devices();
    return c.json(
      hub.accounts.users().map((u) => {
        const mine = devices.filter((d) => d.user === u.name);
        return {
          ...u,
          devices: mine.length,
          last_seen:
            mine
              .map((d) => d.last_seen ?? "")
              .sort()
              .pop() || null,
          projects: hub.myProjects({ kind: "user", name: u.name, role: "member" }).map(({ record, access }) => ({ id: record.id, name: record.name, access })),
        };
      }),
    );
  });
  app.post("/users", async (c) => {
    const body = (await c.req.json()) as { name?: string; role?: Role; projects?: { id: string; access: MemberAccess }[] };
    const name = String(body.name ?? "").trim();
    // Without GTV_ADMIN_TOKEN the first account is what locks the dashboard: it must be able to administer it.
    const role = !hub.cfg.adminToken && !hub.accounts.hasUsers() ? "admin" : (body.role ?? "member");
    for (const p of body.projects ?? []) if (!hub.live(p.id)) throw new Error(`unknown project ${p.id}`);
    const user = hub.accounts.createUser(name, role, c.get("dev"));
    for (const p of body.projects ?? []) {
      const m = hub.live(p.id)!.engine.store.saveMember(name, { access: p.access ?? "developer" });
      hub.live(p.id)!.engine.store.logEvent("member_set", c.get("dev"), m);
    }
    return c.json({ user, ...activationUrl(c, name) });
  });
  app.patch("/users/:name", async (c) => {
    const { role } = (await c.req.json()) as { role?: Role };
    const me = c.get("principal")!;
    if (me.kind === "user" && me.name === c.req.param("name") && role !== "admin") throw new Error("you cannot lower your own role");
    return c.json(hub.accounts.setRole(c.req.param("name"), role ?? "member"));
  });
  app.delete("/users/:name", (c) => {
    const name = c.req.param("name");
    const me = c.get("principal")!;
    if (me.kind === "user" && me.name === name) throw new Error("you cannot delete your own account");
    if (!hub.accounts.user(name)) throw new Error(`unknown account ${name}`);
    hub.accounts.removeUser(name);
    // A new account with the same name must not inherit project access.
    for (const r of hub.records()) if (hub.live(r.id)?.engine.store.member(name)) hub.live(r.id)!.engine.store.removeMember(name);
    return c.json({ ok: true });
  });
  /** A new activation link (or a password reset for an activated account); the previous link stops working. */
  app.post("/users/:name/activation", (c) => c.json(activationUrl(c, c.req.param("name"))));
  app.get("/users/:name/devices", (c) => c.json(hub.accounts.devices(c.req.param("name"))));
  app.delete("/users/:name/devices/:id", (c) => {
    if (!hub.accounts.removeDevice(c.req.param("id"), c.req.param("name"))) throw new Error("unknown computer");
    return c.json({ ok: true });
  });

  app.get("/overview", async (c) => {
    const me = c.get("principal");
    const brainHealth = await hub.brain.health();
    if (me?.kind === "share") {
      // A share link sees its project and nothing about the server, developers' tokens or the brain's usage.
      const live = hub.live(me.project!);
      return c.json({
        open_mode: false,
        commit: null,
        brain: { backend: hub.brain.name, model: null, ok: brainHealth.ok, detail: "" },
        brain_stats: hub.brainStats({ project: "-", days: 1 }),
        projects: live ? [summarize(live)] : [],
      });
    }
    const projects = [];
    for (const { record: r } of hub.myProjects(me!)) {
      const live = hub.live(r.id);
      projects.push(live ? summarize(live) : { id: r.id, name: r.name, repo_url: r.repo_url, error: "not loaded" });
    }
    return c.json({
      open_mode: openMode(hub),
      commit: process.env.GTV_COMMIT || null, // the deployed git commit (docker/auto-deploy.sh)
      brain: { backend: hub.brain.name, model: hub.brain.model ?? null, ...brainHealth, failing: hub.brainFailing() },
      brain_stats: hub.brainStats({ days: 7 }),
      projects,
    });
  });

  // ---- projects -----------------------------------------------------------------------

  app.get("/projects", (c) =>
    c.json(
      hub
        .myProjects(c.get("principal")!)
        .map(({ record: r }) => (hub.live(r.id) ? summarize(hub.live(r.id)!) : { id: r.id, name: r.name, error: "not loaded" })),
    ),
  );

  app.post("/projects", async (c) => {
    const body = await c.req.json();
    const p = await hub.createProject(body);
    return c.json(summarize(p));
  });

  app.get("/projects/:id", async (c) => {
    const p = await rt(c.req.param("id"));
    return c.json({
      ...summarize(p),
      record: { ...p.record, repo_url: p.record.repo_url.replace(/\/\/[^@/]+@/, "//***@") },
      graph: p.engine.graph.stats(BASE),
      my_access: hub.projectAccess(c.get("principal")!, p.record.id),
    });
  });

  app.patch("/projects/:id", async (c) => c.json(await hub.updateProject(c.req.param("id"), await c.req.json())));

  app.delete("/projects/:id", (c) => {
    hub.archiveProject(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/projects/:id/sync", async (c) => {
    const p = await rt(c.req.param("id"));
    await p.sync();
    return c.json({ last_sync: p.lastSync, main: p.engine.mainSha });
  });

  // Team members: role and level per developer in this project.
  app.get("/projects/:id/members", async (c) => c.json((await rt(c.req.param("id"))).engine.store.members()));
  app.put("/projects/:id/members/:dev", async (c) => {
    const p = await rt(c.req.param("id"));
    const dev = c.req.param("dev");
    // New members are people with an account; rows from before accounts keep working.
    if (!p.engine.store.member(dev) && !hub.accounts.user(dev)) throw new Error(`no account named ${dev}: an admin creates it on the People page`);
    const m = p.engine.store.saveMember(dev, await c.req.json());
    p.engine.store.logEvent("member_set", c.get("dev"), m);
    return c.json(m);
  });
  app.delete("/projects/:id/members/:dev", async (c) => {
    const p = await rt(c.req.param("id"));
    p.engine.store.removeMember(c.req.param("dev"));
    p.engine.store.logEvent("member_removed", c.get("dev"), { dev: c.req.param("dev") });
    return c.json({ ok: true });
  });

  // Read-only links for showing a project to people outside the team.
  app.get("/projects/:id/share-links", (c) => c.json(hub.accounts.shareLinks(c.req.param("id"))));
  app.post("/projects/:id/share-links", async (c) => {
    await rt(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as { label?: string; days?: number };
    return c.json(hub.accounts.createShareLink(c.req.param("id"), { label: body.label, days: body.days, by: c.get("dev") }));
  });
  app.delete("/projects/:id/share-links/:link", (c) => {
    hub.accounts.revokeShareLink(c.req.param("link"));
    return c.json({ ok: true });
  });

  app.get("/projects/:id/conversations", async (c) => {
    const { engine } = await rt(c.req.param("id"));
    const kinds = c.req.query("kinds")?.split(",").filter(Boolean);
    const threads = conversations(engine, Math.min(200, Number(c.req.query("limit") ?? 40)), kinds);
    summarizer(engine).threads(threads);
    return c.json(threads);
  });
  /** Today's brain digest (cached; null until the first one is written or when the brain is off). */
  app.get("/projects/:id/digest", async (c) => c.json({ digest: summarizer((await rt(c.req.param("id"))).engine).day() ?? null }));
  app.get("/projects/:id/attention", async (c) => c.json(attention((await rt(c.req.param("id"))).engine)));
  /** The brain's drafts for settling an incident; [] until they are written (the page asks again) or when the brain is off. */
  app.get("/projects/:id/incidents/:iid/plans", async (c) => {
    const { engine } = await rt(c.req.param("id"));
    const inc = incident(engine, c.req.param("iid"));
    if (!inc) throw new Error("unknown incident");
    return c.json({ plans: suggester(engine).plans(inc) });
  });
  app.post("/projects/:id/incidents/:iid/rewrite", async (c) => {
    const { engine } = await rt(c.req.param("id"));
    const inc = incident(engine, c.req.param("iid"));
    if (!inc) throw new Error("unknown incident");
    const { text } = (await c.req.json()) as { text?: string };
    return c.json({ text: await suggester(engine).rewrite(inc, String(text ?? "")) });
  });

  app.get("/projects/:id/state", async (c) => c.json((await rt(c.req.param("id"))).engine.store.teamState()));
  /**
   * One file seen through the team's work: who touched it, who registered it, the conflicts about it,
   * and each workspace's diff of it at its latest WIP snapshot (not live keystrokes).
   */
  app.get("/projects/:id/file", async (c) => {
    const p = await rt(c.req.param("id"));
    const path = normPath(c.req.query("path") ?? "");
    if (!path) throw new Error("path is required");
    const state = p.engine.store.teamState();
    const sessionAgent = new Map(state.sessions.map((s) => [s.id, s.agent]));
    // Whole-file context lets the dashboard show each person's version side by side (capped for huge files).
    const context = Math.max(3, Math.min(100_000, Number(c.req.query("context") ?? 3)));
    const aboutFile = (subject: string) => subject === path || subject.startsWith(`${path}#`) || subject.split(" ~ ").includes(path);
    const conflicts = state.conflicts.filter((x) => (x.status === "open" || x.status === "acked") && aboutFile(x.subject));
    const workspaces = [];
    for (const ws of state.workspaces) {
      const footprint = state.footprints.find((f) => f.workspace_id === ws.id && f.path === path);
      const tasks = state.tasks.filter((t) => t.workspace_id === ws.id && t.resources.some((r) => r.kind === "path" && globMatch(r.value, path)));
      let diff = "";
      if (p.engine.repo && ws.snapshot_sha && ws.snapshot_base) diff = await p.engine.repo.diffFile(ws.snapshot_base, ws.snapshot_sha, path, context);
      if (!footprint && !tasks.length && !diff) continue;
      const symbols = loadSymbolChanges(p.db, ws.id).filter((s) => s.symbol_id.startsWith(`${path}#`));
      workspaces.push({
        workspace_id: ws.id,
        label: ws.label,
        dev: ws.dev,
        agent: (footprint && sessionAgent.get(footprint.session_id)) ?? state.sessions.find((s) => s.workspace_id === ws.id)?.agent ?? "other",
        footprint: footprint ?? null,
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          ops: t.resources.filter((r) => r.kind === "path" && globMatch(r.value, path)).map((r) => r.op ?? ""),
        })),
        snapshot_at: ws.snapshot_sha ? ws.updated_at : null,
        base: ws.snapshot_base ?? null,
        diff: diff.length > 400_000 ? diff.slice(0, 400_000) + "\n… (cắt bớt)" : diff,
        symbols,
      });
    }
    // The file's functions and classes (main), and who calls a symbol someone is changing in a breaking way.
    const outline = isActive(p.engine.mode("knowledge.code_graph"))
      ? p.engine.graph.fileSymbols(path, BASE).map((s) => ({ name: s.qualname || s.name, kind: s.kind, start_line: s.start_line, end_line: s.end_line }))
      : [];
    const used_by = state.conflicts
      .filter((x) => x.kind === "breaking_change_used" && x.subject.startsWith(`${path}#`))
      .flatMap((x) => {
        const ev = x.evidence as { used_by?: string; changed_by?: string; callers?: { path: string; line: number; from_symbol?: string | null }[] };
        return (ev.callers ?? []).map((h) => ({
          dev: ev.used_by ?? "",
          symbol: x.subject.split("#")[1] ?? "",
          path: h.path,
          line: h.line,
          from_symbol: h.from_symbol ?? null,
        }));
      });
    return c.json({ path, conflicts, workspaces, outline, used_by });
  });
  app.get("/projects/:id/stats", async (c) => c.json(stats(hub, await rt(c.req.param("id")), Number(c.req.query("days") ?? 7))));
  app.get("/projects/:id/layers", async (c) => c.json(layers(await rt(c.req.param("id")))));

  app.get("/projects/:id/activity", async (c) => {
    const p = await rt(c.req.param("id"));
    const type = c.req.query("type");
    const limit = Math.min(500, Number(c.req.query("limit") ?? 100));
    const rows = type
      ? p.db.all(`SELECT * FROM event_log WHERE type = ? ORDER BY id DESC LIMIT ?`, type, limit)
      : p.db.all(`SELECT * FROM event_log WHERE type NOT IN ('prompt') ORDER BY id DESC LIMIT ?`, limit);
    return c.json(rows);
  });

  /** Manual note into a developer's agents (delivered at their next tool call). */
  app.post("/projects/:id/messages", async (c) => {
    const p = await rt(c.req.param("id"));
    const body = (await c.req.json()) as { to_dev: string; body: string; ref_id?: string };
    if (!body.to_dev || !body.body?.trim()) throw new Error("to_dev and body are required");
    const by = c.get("dev");
    const m = p.engine.store.addMessage({
      to_dev: body.to_dev,
      kind: "info",
      from_dev: by,
      ref_id: body.ref_id,
      body: `[gtv note from ${by === "admin" ? "the team lead" : `${by} (team lead)`}${body.ref_id ? ` about ${body.ref_id}` : ""}] ${body.body}`,
    });
    p.engine.store.logEvent("manual_message", "admin", m);
    return c.json(m);
  });

  // ---- brain ---------------------------------------------------------------------------------

  app.get("/brain", async (c) => {
    const b = hub.brain;
    const models = (await b.models?.().catch(() => [])) ?? [];
    return c.json({
      backend: b.name,
      model: b.model ?? null,
      thinking: b instanceof PiBrain ? b.thinking : null,
      health: await b.health(),
      models,
      stats: hub.brainStats({ days: Number(c.req.query("days") ?? 7) }),
    });
  });

  // Providers (Pi only): keys and endpoints entered here are stored in hub.db, sealed with GTV_SECRET_KEY.
  const pi = () => {
    if (!(hub.brain instanceof PiBrain)) throw new Error("the active brain backend has no provider settings (BRAIN_BACKEND=pi)");
    return hub.brain;
  };
  app.get("/brain/providers", async (c) => c.json({ secrets_encrypted: pi().secretsEncrypted, providers: await pi().providers() }));
  app.put("/brain/providers/:id/key", async (c) => {
    const { key } = (await c.req.json()) as { key?: string };
    await pi().setKey(c.req.param("id"), key ?? "");
    return c.json({ ok: true });
  });
  app.delete("/brain/providers/:id/key", async (c) => {
    await pi().clearKey(c.req.param("id"));
    return c.json({ ok: true });
  });
  app.post("/brain/providers/:id/test", async (c) => {
    const { model } = (await c.req.json().catch(() => ({}))) as { model?: string };
    return c.json(await pi().test(c.req.param("id"), model || undefined));
  });
  // "Log in with your account" (OAuth): start → show url / user_code → paste input if asked → poll until done.
  app.get("/brain/oauth", (c) => c.json({ providers: pi().oauthProviders() }));
  app.post("/brain/oauth/:provider/start", async (c) => {
    const { domain } = (await c.req.json().catch(() => ({}))) as { domain?: string };
    return c.json(await pi().startLogin(c.req.param("provider"), { domain }));
  });
  app.get("/brain/oauth/sessions/:id", (c) => c.json(pi().loginStatus(c.req.param("id"))));
  app.post("/brain/oauth/sessions/:id/input", async (c) => {
    const { value } = (await c.req.json()) as { value?: string };
    return c.json(await pi().loginInput(c.req.param("id"), value ?? ""));
  });
  app.delete("/brain/oauth/sessions/:id", (c) => {
    pi().cancelLogin(c.req.param("id"));
    return c.json({ ok: true });
  });
  app.post("/brain/endpoints", async (c) => c.json(await pi().addEndpoint(await c.req.json())));
  app.delete("/brain/endpoints/:id", async (c) => {
    await pi().removeEndpoint(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.put("/brain", async (c) => {
    const body = (await c.req.json()) as { model?: string | null; thinking?: string | null };
    if (!hub.brain.setModel) throw new Error("the active brain backend has no model setting");
    if ("model" in body) {
      if (body.model && hub.brain instanceof PiBrain) hub.brain.resolveModel(body.model); // typo or unknown provider → 400 now, not at the next job
      hub.brain.setModel(body.model ?? undefined);
      hub.setSetting("brain.model", body.model ?? null);
    }
    if ("thinking" in body) {
      pi().setThinking(body.thinking ?? undefined);
      hub.setSetting("brain.thinking", body.thinking ?? null);
    }
    return c.json({ model: hub.brain.model ?? null, thinking: hub.brain instanceof PiBrain ? hub.brain.thinking : null });
  });

  return app;
}
