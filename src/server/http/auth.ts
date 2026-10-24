// Authentication: developers (daemons, CLI) use per-dev tokens; the dashboard uses the admin token.
// With no admin token and no developers configured the server runs in open dev mode.

import type { Context, Next } from "hono";
import type { Hub } from "../hub/hub.ts";

export interface AuthVars {
  dev: string;
  admin: boolean;
}

const bearer = (c: Context) => c.req.header("authorization")?.replace(/^Bearer\s+/i, "") || c.req.query("token") || undefined;

export function openMode(hub: Hub): boolean {
  return hub.cfg.authOpen || (!hub.cfg.adminToken && !hub.hasDevs());
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
 * Dashboard / admin API. Without GTV_ADMIN_TOKEN the dashboard stays open (dev mode) even after developers
 * get tokens — otherwise issuing the first token would lock the dashboard out. Production must set it.
 */
export function adminAuth(hub: Hub) {
  return async (c: Context<{ Variables: AuthVars }>, next: Next) => {
    const token = bearer(c);
    const ok = hub.cfg.authOpen || !hub.cfg.adminToken || token === hub.cfg.adminToken;
    if (!ok) return c.json({ error: "unauthorized: admin token required" }, 401);
    c.set("dev", "admin");
    c.set("admin", true);
    await next();
  };
}
