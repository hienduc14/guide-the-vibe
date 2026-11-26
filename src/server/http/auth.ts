// Authentication and permissions.
//   Callers: a person's dashboard session (gtvs_…), a person's computer (gtvd_…, or an old gtv_ developer token),
//   a read-only share link (gtvl_…) for one project, the admin token (GTV_ADMIN_TOKEN: rescue, scripts, tests) or,
//   with no admin token and no account yet, open mode.
//   Two tiers decide what they may do: the system role (admin | member) and their access in each project
//   (manager | developer | viewer, see Hub.projectAccess).

import type { Context, Next } from "hono";
import type { Hub } from "../hub/hub.ts";
import type { Principal } from "../hub/accounts.ts";
import type { ProjectRuntime } from "../project/runtime.ts";

export interface AuthVars {
  dev: string;
  /** Manages the project from the dashboard (may act on other people's sessions and tasks). */
  admin: boolean;
  principal?: Principal;
}

export const bearer = (c: Context) => c.req.header("authorization")?.replace(/^Bearer\s+/i, "") || c.req.query("token") || undefined;

export function openMode(hub: Hub): boolean {
  return hub.cfg.authOpen || (!hub.cfg.adminToken && !hub.accounts.hasUsers());
}

/** Who is calling, or undefined (no or unknown token outside open mode). */
export function principalFor(hub: Hub, token: string | undefined): Principal | undefined {
  if (token && hub.cfg.adminToken && token === hub.cfg.adminToken) return { kind: "admin_token", name: "admin", role: "admin" };
  const p = token ? hub.accounts.principal(token) : undefined;
  if (p) return p;
  if (openMode(hub)) return { kind: "open", name: "admin", role: "admin" };
  return undefined;
}

/** Simple fixed-window limit per client address, so short codes and passwords cannot be guessed quickly. */
const hits = new Map<string, { n: number; start: number }>();
export function rateLimited(c: Context, bucket: string, perMinute: number): boolean {
  const ip =
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
    (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress;
  if (!ip) return false; // in-process requests (tests)
  const key = `${bucket}|${ip}`;
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.start > 60_000) {
    if (hits.size > 10_000) hits.clear();
    hits.set(key, { n: 1, start: now });
    return false;
  }
  return ++h.n > perMinute;
}

type Denied = { status: 401 | 403 | 404 | 429; error: string };
const FORBIDDEN_MANAGER: Denied = { status: 403, error: "forbidden: this needs manager access in the project" };
const FORBIDDEN_ADMIN: Denied = { status: 403, error: "forbidden: only an admin can do this" };

/** What a share link may read: its own project, plus who-am-I and the (filtered) overview. */
function shareAllows(p: Principal, method: string, path: string): boolean {
  if (path === "/logout") return true;
  if (method !== "GET") return false;
  if (path === "/me" || path === "/overview") return true;
  const m = /^\/projects\/([^/]+)(\/.*)?$/.exec(path);
  return !!m && decodeURIComponent(m[1]) === p.project && !m[2]?.startsWith("/share-links");
}

/** Why a dashboard API call (path relative to /api) is refused, or undefined when allowed. */
export function apiDenied(hub: Hub, p: Principal, method: string, path: string): Denied | undefined {
  const write = method !== "GET" && method !== "HEAD";
  if (p.kind === "share") return shareAllows(p, method, path) ? undefined : { status: 403, error: "forbidden: this link is read-only for one project" };
  const admin = p.role === "admin";
  if (["/logout", "/me", "/overview", "/people"].includes(path) || /^\/(me|connect)\//.test(path)) return undefined;
  if (path === "/projects") return write && !admin ? FORBIDDEN_ADMIN : undefined; // listing is filtered; creating is for admins
  const m = /^\/projects\/([^/]+)(\/.*)?$/.exec(path);
  if (m) {
    if (!m[2] && method === "DELETE") return admin ? undefined : FORBIDDEN_ADMIN; // archive
    const access = hub.projectAccess(p, decodeURIComponent(m[1]));
    if (access === "none") return { status: 404, error: `unknown project ${decodeURIComponent(m[1])}` }; // do not reveal it exists
    if ((write || m[2]?.startsWith("/share-links")) && access !== "manager") return FORBIDDEN_MANAGER;
    return undefined;
  }
  return admin ? undefined : FORBIDDEN_ADMIN; // /users, /brain and anything new
}

/** Dashboard API (/api). Computers' keys are not dashboard credentials. */
export function adminAuth(hub: Hub) {
  return async (c: Context<{ Variables: AuthVars }>, next: Next) => {
    const path = c.req.path.replace(/^\/api/, "") || "/";
    // The only calls without credentials: logging in and setting a password from an activation link.
    if (path === "/login" || /^\/activate\/[^/]+$/.test(path)) {
      if (c.req.method === "POST" && rateLimited(c, path === "/login" ? "login" : "activate", 30))
        return c.json({ error: "too many attempts: wait a minute" }, 429);
      return next();
    }
    const p = principalFor(hub, bearer(c));
    if (!p || p.kind === "device") return c.json({ error: "unauthorized: log in to the dashboard" }, 401);
    const denied = apiDenied(hub, p, c.req.method, path);
    if (denied) return c.json({ error: denied.error }, denied.status);
    c.set("dev", p.name);
    c.set("admin", p.role === "admin");
    c.set("principal", p);
    await next();
  };
}

/** Project-independent part of /v1: who is calling. The admin token and open mode may act as a developer (X-Gtv-Dev). */
export function v1Auth(hub: Hub) {
  return async (c: Context<{ Variables: AuthVars }>, next: Next) => {
    const p = principalFor(hub, bearer(c));
    if (!p) return c.json({ error: "unauthorized: this computer is not connected (run: gtv login)" }, 401);
    if (p.kind === "share" && !/^\/v1\/p\//.test(c.req.path)) return c.json({ error: "forbidden: this link is read-only for one project" }, 403);
    c.set("dev", p.kind === "admin_token" || p.kind === "open" ? c.req.header("x-gtv-dev") || p.name : p.name);
    c.set("admin", false);
    c.set("principal", p);
    await next();
  };
}

/** The 403 an agent's computer gets in a project it may not work in; the CLI and daemon show it as is. */
export function notMemberMessage(project: string, access: string): string {
  return access === "viewer"
    ? `You are a viewer in project ${project}; agents need developer access. Ask a project manager to change it.`
    : `You are not a member of project ${project}. Ask a project manager to add you.`;
}

/**
 * Project API (/v1/p/:id), once the project is known. Computers work in projects where their person is a developer
 * or manager. Dashboard sessions read as viewers and change things as managers; a developer may also answer
 * questions sent to them (or to everyone) and update the tasks assigned to them.
 */
export async function projectDenied(hub: Hub, c: Context<{ Variables: AuthVars & { rt: ProjectRuntime } }>): Promise<Denied | undefined> {
  const p = c.get("principal")!;
  const rt = c.get("rt");
  const access = hub.projectAccess(p, rt.record.id);
  if (p.kind === "device") return access === "developer" || access === "manager" ? undefined : { status: 403, error: notMemberMessage(rt.record.name, access) };
  if (access === "none") return { status: 404, error: `unknown project ${rt.record.id}` };
  // In open mode a daemon names its developer and acts as that developer only (as before accounts).
  c.set("admin", access === "manager" && !(p.kind === "open" && c.req.header("x-gtv-dev")));
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || access === "manager") return undefined;
  if (p.kind === "share" || access !== "developer") return FORBIDDEN_MANAGER;
  const me = p.name;
  const sub = c.req.path.replace(/^\/v1\/p\/[^/]+/, "");
  const ticket = /^\/tickets\/([^/]+)\/reply$/.exec(sub);
  if (ticket && method === "POST") {
    const t = rt.engine.store.ticket(decodeURIComponent(ticket[1]));
    return !t || !t.to_dev || t.to_dev === me ? undefined : { status: 403, error: "forbidden: this question was sent to someone else" };
  }
  const board = /^\/board\/([^/]+)(\/notes)?$/.exec(sub);
  if (board && (method === "PATCH" || (method === "POST" && board[2]))) {
    const item = rt.engine.board.get(decodeURIComponent(board[1]));
    if (item && item.assignee !== me) return { status: 403, error: "forbidden: you can only change tasks assigned to you" };
    if (method === "PATCH") {
      const body = (await c.req.json().catch(() => ({}))) as { assignee?: string | null };
      if ("assignee" in body && (body.assignee || undefined) !== item?.assignee) return FORBIDDEN_MANAGER;
    }
    return undefined;
  }
  return FORBIDDEN_MANAGER;
}

/** The address people use to reach this server (behind a proxy too), for links the server hands out. */
export function publicOrigin(c: Context): string {
  const origin = c.req.header("origin");
  if (origin) return origin;
  // Behind a tunnel (Cloudflare) the request arrives as http with only x-forwarded-proto set; CLI calls carry no Origin.
  const url = new URL(c.req.url);
  const host = c.req.header("x-forwarded-host");
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0].trim() || (host ? "https" : url.protocol.slice(0, -1));
  return `${proto}://${host ?? url.host}`;
}
