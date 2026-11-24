// Dashboard API (/api): projects, people, statistics, layers, developers and brain settings.
// Mutations on a project's tasks/conflicts/tickets/knowledge reuse the project API (/v1/p/:id) with the admin token.

import { Hono } from "hono";
import type { Hub } from "../hub/hub.ts";
import type { ProjectRuntime } from "../project/runtime.ts";
import type { AuthVars } from "./auth.ts";
import { bearer, openMode } from "./auth.ts";
import type { Role } from "../hub/accounts.ts";
import { FEATURES, FEATURE_KEYS } from "../../shared/features.ts";
import { BASE } from "../../codeintel/graph.ts";
import type { Level } from "../../shared/types.ts";
import { PiBrain } from "../brain/pi.ts";

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
  const people = new Map<
    string,
    { dev: string; status: string; agents: Set<string>; workspaces: Set<string>; last_seen: string; tasks: string[]; editing: number; conflicts: number }
  >();
  for (const s of sessions) {
    const p = people.get(s.dev) ?? {
      dev: s.dev,
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
  return {
    id: rt.record.id,
    name: rt.record.name,
    description: rt.record.description,
    repo_url: rt.record.repo_url.replace(/\/\/[^@/]+@/, "//***@"),
    main_branch: rt.record.main_branch,
    main_sha: rt.engine.mainSha ?? null,
    last_sync: rt.lastSync ?? null,
    counts: {
      people_active: [...people.values()].filter((p) => p.status === "active").length,
      sessions_active: state.sessions.filter((s) => s.status === "active").length,
      tasks_active: state.tasks.length,
      conflicts_open: state.conflicts.length,
      conflicts_by_level: byLevel,
      tickets_waiting: store.tickets({ status: ["answering", "forwarded", "waiting_human"] }).length,
      kb_unverified: rt.engine.kb.list({ status: "unverified" }).length,
    },
    people: [...people.values()]
      .map((p) => ({ ...p, agents: [...p.agents], workspaces: [...p.workspaces] }))
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

  // ---- dashboard accounts -------------------------------------------------------------

  app.post("/login", async (c) => {
    const { name, password } = (await c.req.json()) as { name?: string; password?: string };
    const res = hub.accounts.login(String(name ?? ""), String(password ?? ""));
    return c.json({ token: res.token, expires_at: res.expires_at, name: res.user.name, role: res.user.role });
  });
  app.post("/logout", (c) => {
    const t = bearer(c);
    if (t) hub.accounts.logout(t);
    return c.json({ ok: true });
  });
  app.get("/me", (c) => {
    const p = c.get("principal")!;
    return c.json({ name: p.name, role: p.role, kind: p.kind, project: p.project ?? null, open_mode: openMode(hub), has_users: hub.accounts.hasUsers() });
  });

  app.get("/users", (c) => c.json(hub.accounts.users()));
  app.put("/users/:name", async (c) => {
    const body = (await c.req.json()) as { role?: Role; password?: string };
    // Without GTV_ADMIN_TOKEN the first account is what locks the dashboard: it must be able to administer it.
    if (!hub.cfg.adminToken && !hub.accounts.hasUsers() && body.role !== "admin")
      throw new Error("the first account must be an admin (the server has no GTV_ADMIN_TOKEN)");
    const me = c.get("principal")!;
    if (me.kind === "user" && me.name === c.req.param("name") && body.role && body.role !== "admin") throw new Error("you cannot lower your own role");
    return c.json(hub.accounts.saveUser(c.req.param("name"), body));
  });
  app.delete("/users/:name", (c) => {
    const me = c.get("principal")!;
    if (me.kind === "user" && me.name === c.req.param("name")) throw new Error("you cannot delete your own account");
    hub.accounts.removeUser(c.req.param("name"));
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
        devs: [],
      });
    }
    const projects = [];
    for (const r of hub.records()) {
      const live = hub.live(r.id);
      projects.push(live ? summarize(live) : { id: r.id, name: r.name, repo_url: r.repo_url, error: "not loaded" });
    }
    return c.json({
      open_mode: openMode(hub),
      commit: process.env.GTV_COMMIT || null, // the deployed git commit (docker/auto-deploy.sh)
      brain: { backend: hub.brain.name, model: hub.brain.model ?? null, ...brainHealth },
      brain_stats: hub.brainStats({ days: 7 }),
      projects,
      devs: hub.devs(),
    });
  });

  // ---- projects -----------------------------------------------------------------------

  app.get("/projects", (c) =>
    c.json(hub.records().map((r) => (hub.live(r.id) ? summarize(hub.live(r.id)!) : { id: r.id, name: r.name, error: "not loaded" }))),
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

  app.get("/projects/:id/state", async (c) => c.json((await rt(c.req.param("id"))).engine.store.teamState()));
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
    const body = (await c.req.json()) as { to_dev: string; body: string };
    if (!body.to_dev || !body.body?.trim()) throw new Error("to_dev and body are required");
    const m = p.engine.store.addMessage({ to_dev: body.to_dev, kind: "info", body: `[gtv note from the team lead] ${body.body}` });
    p.engine.store.logEvent("manual_message", "admin", m);
    return c.json(m);
  });

  // ---- developers ------------------------------------------------------------------------

  app.get("/devs", (c) => c.json(hub.devs()));
  app.post("/devs", async (c) => {
    const { name } = (await c.req.json()) as { name: string };
    return c.json({ name, token: hub.issueToken(name) });
  });
  app.post("/devs/invite", async (c) => {
    const { name } = (await c.req.json()) as { name: string };
    return c.json({ name, ...hub.createInvite(name) });
  });
  app.delete("/devs/:name", (c) => {
    hub.removeDev(c.req.param("name"));
    return c.json({ ok: true });
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
