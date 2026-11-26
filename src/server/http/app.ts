// Assembles the HTTP surface:
//   /health                    liveness + brain status
//   /v1/connect/*              connecting a computer to an account (gtv login), no token needed
//   /v1/me                     the computer's account and projects
//   /v1/projects, /v1/resolve  project discovery for daemons
//   /v1/p/:project/*           project API (daemons, agents via daemon, CLI, dashboard callers by role)
//   /api/*                     dashboard API
//   /*                         dashboard (web/dist)

import { Hono, type Context } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Hub } from "../hub/hub.ts";
import { adminAuth, projectDenied, publicOrigin, rateLimited, v1Auth, type AuthVars } from "./auth.ts";
import { repoKey } from "../hub/hub.ts";
import { agentRoutes, type ProjectEnv } from "./agent-routes.ts";
import { adminRoutes } from "./admin-routes.ts";

export function buildApp(hub: Hub): Hono {
  const app = new Hono();
  app.onError((err, c) => c.json({ error: err.message }, /unknown project/.test(err.message) ? 404 : 400));

  app.get("/health", async (c) => {
    // Daemons ping /health every 15 s with their key: that is what keeps a computer's "last seen" current.
    const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (token) hub.accounts.deviceFor(token);
    return c.json({
      ok: true,
      // health() checks the configuration only; `failing` says whether jobs actually work.
      brain: { backend: hub.brain.name, model: hub.brain.model ?? null, ...(await hub.brain.health()), failing: hub.brainFailing() },
      projects: hub.records().map((p) => p.id),
      commit: process.env.GTV_COMMIT || null,
    });
  });

  // Connecting a computer: the CLI starts a request and polls; the person approves the code on the dashboard (/connect).
  app.post("/v1/connect/start", async (c) => {
    if (rateLimited(c, "connect", 30)) return c.json({ error: "too many attempts: wait a minute" }, 429);
    const body = (await c.req.json().catch(() => ({}))) as { device_name?: string; platform?: string };
    const r = hub.accounts.startConnect(String(body.device_name ?? ""), String(body.platform ?? ""));
    return c.json({ ...r, verify_url: `${publicOrigin(c)}/connect?code=${r.user_code}`, interval: 2 });
  });
  app.post("/v1/connect/poll", async (c) => {
    if (rateLimited(c, "poll", 120)) return c.json({ error: "too many attempts: wait a minute" }, 429);
    const body = (await c.req.json().catch(() => ({}))) as { device_code?: string };
    return c.json(hub.accounts.pollConnect(String(body.device_code ?? "")));
  });
  app.post("/v1/join", (c) => c.json({ error: "Invite links are gone. Run: npx guide-the-vibe, then gtv login" }, 410));

  // Developers (and the dashboard with the admin token).
  const dev = new Hono<{ Variables: AuthVars }>();
  dev.use("*", v1Auth(hub));
  /** The computer's account and the projects it can work in (repos as repoKey(), never URLs that may hold a token). */
  dev.get("/me", (c) => {
    const p = c.get("principal")!;
    const device = p.device ? hub.accounts.devices(p.name).find((d) => d.id === p.device) : undefined;
    return c.json({
      user: p.name,
      role: p.role,
      device: device ? { id: device.id, name: device.name } : null,
      projects: hub
        .myProjects(p)
        .map(({ record: r, access }) => ({ id: r.id, name: r.name, access, repos: [...new Set([r.repo_url, ...r.aliases].map(repoKey))] })),
    });
  });
  dev.post("/me/logout", (c) => {
    const p = c.get("principal")!;
    if (p.kind !== "device") return c.json({ error: "only a computer's key can log itself out" }, 400);
    hub.accounts.removeDevice(p.device!);
    return c.json({ ok: true });
  });
  dev.get("/projects", (c) =>
    c.json(hub.records().map((p) => ({ id: p.id, name: p.name, repo_url: p.repo_url.replace(/\/\/[^@/]+@/, "//***@"), main_branch: p.main_branch }))),
  );
  dev.get("/resolve", (c) => {
    const p = hub.resolve(c.req.query("remote") ?? "");
    return p ? c.json({ id: p.id, name: p.name }) : c.json({ error: "no project matches this remote" }, 404);
  });
  const project = new Hono<ProjectEnv>();
  project.use("*", async (c, next) => {
    c.set("rt", await hub.runtime(c.req.param("project")!));
    const denied = await projectDenied(hub, c as never);
    if (denied) return c.json({ error: denied.error }, denied.status);
    await next();
  });
  project.route("/", agentRoutes());
  dev.route("/p/:project", project as never);
  app.route("/v1", dev);

  // Dashboard API.
  const admin = new Hono<{ Variables: AuthVars }>();
  admin.use("*", adminAuth(hub));
  admin.route("/", adminRoutes(hub));
  app.route("/api", admin);

  // Dashboard static files with SPA fallback.
  const webDir = resolve(hub.cfg.webDir);
  if (existsSync(join(webDir, "index.html"))) {
    const root = relative(process.cwd(), webDir) || ".";
    app.use("/*", serveStatic({ root }));
    app.get("*", (c) => c.html(readFileSync(join(webDir, "index.html"), "utf8")));
  } else {
    app.get("/", (c) => c.text("gtv operator is running. Build the dashboard with: npm run web:build"));
  }
  return app;
}
