// Assembles the HTTP surface:
//   /health                    liveness + brain status
//   /v1/projects, /v1/resolve  project discovery for daemons
//   /v1/p/:project/*           project API (daemons, agents via daemon, CLI, dashboard with admin token)
//   /p/:project/mcp            read-only MCP tools for the brain
//   /api/*                     dashboard API
//   /*                         dashboard (web/dist)

import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Hub } from "../hub/hub.ts";
import { adminAuth, devAuth, type AuthVars } from "./auth.ts";
import { agentRoutes, type ProjectEnv } from "./agent-routes.ts";
import { adminRoutes } from "./admin-routes.ts";
import { handleBrainMcp } from "../brain/mcp-tools.ts";

export function buildApp(hub: Hub): Hono {
  const app = new Hono();
  app.onError((err, c) => c.json({ error: err.message }, /unknown project/.test(err.message) ? 404 : 400));

  app.get("/health", async (c) =>
    c.json({
      ok: true,
      brain: { backend: hub.brain.name, model: hub.brain.model ?? null, ...(await hub.brain.health()) },
      projects: hub.records().map((p) => p.id),
    }),
  );

  // Brain tools, one MCP endpoint per project.
  app.all("/p/:project/mcp", async (c) => {
    const token = hub.cfg.brainToken;
    if (token && c.req.header("authorization") !== `Bearer ${token}`) return c.json({ error: "unauthorized" }, 401);
    const rt = await hub.runtime(c.req.param("project"));
    return handleBrainMcp(rt.engine, c.req.raw);
  });

  // Developers (and the dashboard with the admin token).
  const dev = new Hono<{ Variables: AuthVars }>();
  dev.use("*", async (c, next) => {
    const t = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") || c.req.query("token");
    if (hub.cfg.adminToken && t === hub.cfg.adminToken) {
      c.set("dev", c.req.header("x-gtv-dev") || "admin");
      c.set("admin", true);
      return next();
    }
    return devAuth(hub)(c, next);
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
