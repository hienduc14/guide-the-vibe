// Authentication.
//   Developers (daemons, CLI, agents) use per-dev tokens on /v1.
//   The dashboard uses the admin token (GTV_ADMIN_TOKEN), a user session (gtvs_…, see hub/accounts.ts) or a
//   read-only share link (gtvl_…) limited to one project. Roles decide what a dashboard caller may do.
// With no admin token, no developers and no dashboard users the server runs in open dev mode.

import type { Context, Next } from "hono";
import type { Hub } from "../hub/hub.ts";
import { ROLE_RANK, type Principal, type Role } from "../hub/accounts.ts";

export interface AuthVars {
  dev: string;
  admin: boolean;
  /** Set for dashboard callers (admin token, user session, share link, open mode). */
  principal?: Principal;
}

export const bearer = (c: Context) => c.req.header("authorization")?.replace(/^Bearer\s+/i, "") || c.req.query("token") || undefined;

export function openMode(hub: Hub): boolean {
  return hub.cfg.authOpen || (!hub.cfg.adminToken && !hub.hasDevs());
}

/** Dashboard identity for a request, or undefined (no or unknown token). */
export function dashboardPrincipal(hub: Hub, c: Context): Principal | undefined {
  const token = bearer(c);
  if (token && hub.cfg.adminToken && token === hub.cfg.adminToken) return { kind: "admin_token", name: "admin", role: "admin" };
  const p = token ? hub.accounts.principal(token) : undefined;
  if (p) return p;
  // Without an admin token the dashboard stays open until the first dashboard account exists — issuing a developer
  // token must not lock the dashboard out (developers' tokens are not dashboard credentials).
  if (hub.cfg.authOpen || (!hub.cfg.adminToken && !hub.accounts.hasUsers())) return { kind: "open", name: "admin", role: "admin" };
  return undefined;
}

const atLeast = (p: Principal, role: Role) => ROLE_RANK[p.role] >= ROLE_RANK[role];

/** Role needed for a dashboard API call (path relative to /api). */
export function apiRoleFor(method: string, path: string): Role {
  const write = method !== "GET" && method !== "HEAD";
  if (path === "/logout") return "viewer";
  if (path.startsWith("/users") || path.startsWith("/brain/")) return "admin";
  if (path === "/projects" && write) return "admin"; // create
  if (/^\/projects\/[^/]+$/.test(path) && method === "DELETE") return "admin"; // archive
  if (path.startsWith("/devs") && write) return "admin";
  if (/^\/projects\/[^/]+\/share-links/.test(path)) return "manager";
  return write ? "manager" : "viewer";
}

/** What a share link may read: its own project, plus who-am-I and the (filtered) overview. */
function shareAllows(p: Principal, method: string, path: string): boolean {
  if (path === "/logout") return true;
  if (method !== "GET") return false;
  if (path === "/me" || path === "/overview") return true;
  const m = /^\/projects\/([^/]+)(\/.*)?$/.exec(path);
  return !!m && decodeURIComponent(m[1]) === p.project && !m[2]?.startsWith("/share-links");
}

/** Dashboard API (/api). */
export function adminAuth(hub: Hub) {
  return async (c: Context<{ Variables: AuthVars }>, next: Next) => {
    const path = c.req.path.replace(/^\/api/, "") || "/";
    if (path === "/login") return next(); // the only call that needs no credentials
    const p = dashboardPrincipal(hub, c);
    if (!p) return c.json({ error: "unauthorized: log in to the dashboard" }, 401);
    const method = c.req.method;
    if (p.kind === "share" ? !shareAllows(p, method, path) : !atLeast(p, apiRoleFor(method, path)))
      return c.json({ error: `forbidden: your role (${p.role}) cannot do this` }, 403);
    c.set("dev", p.name);
    c.set("admin", p.role === "admin");
    c.set("principal", p);
    await next();
  };
}

/** Developer identity: token → dev; in open mode the X-Gtv-Dev header is trusted. */
export function devAuth(hub: Hub) {
  return async (c: Context<{ Variables: AuthVars }>, next: Next) => {
    const token = bearer(c);
    const dev = (token && hub.devForToken(token)) || (openMode(hub) ? c.req.header("x-gtv-dev") : undefined);
    if (!dev) return c.json({ error: "unauthorized: send Authorization: Bearer <dev token>" }, 401);
    c.set("dev", dev);
    c.set("admin", false);
    await next();
  };
}

/**
 * Project API (/v1) for both developers and the dashboard. Dashboard callers read with any role and change
 * things (ack a conflict, toggle a layer, answer a question) as manager or admin; share links read their project only.
 */
export function v1Auth(hub: Hub) {
  return async (c: Context<{ Variables: AuthVars }>, next: Next) => {
    const token = bearer(c);
    const p = token && (token === hub.cfg.adminToken || /^gtv[sl]_/.test(token)) ? dashboardPrincipal(hub, c) : undefined;
    if (!p) return devAuth(hub)(c, next);
    const method = c.req.method;
    const write = method !== "GET" && method !== "HEAD";
    const path = c.req.path.replace(/^\/v1/, "");
    if (p.kind === "share") {
      const m = /^\/p\/([^/]+)/.exec(path);
      if (write || !m || decodeURIComponent(m[1]) !== p.project) return c.json({ error: "forbidden: this link is read-only for one project" }, 403);
    } else if (write && !atLeast(p, "manager")) return c.json({ error: `forbidden: your role (${p.role}) is read-only` }, 403);
    c.set("dev", c.req.header("x-gtv-dev") || p.name);
    c.set("admin", atLeast(p, "manager"));
    c.set("principal", p);
    await next();
  };
}
