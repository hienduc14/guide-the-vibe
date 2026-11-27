// Authentication and permissions.
//   Callers: a person's dashboard session (gtvs_… in the httpOnly gtv_session cookie), a person's computer (gtvd_…),
//   a read-only share link (gtvl_…) for one project, the admin token (GTV_ADMIN_TOKEN: rescue, scripts, tests) or,
//   with no admin token and no account yet, open mode. Everything but the cookie comes as Authorization: Bearer.
//   Two tiers decide what they may do: the system role (admin | member) and their access in each project
//   (manager | developer | viewer, see Hub.projectAccess).

import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { ACCESS_RANK, type Hub, type ProjectAccess } from "../hub/hub.ts";
import { SESSION_DAYS, type Principal, type SessionMeta } from "../hub/accounts.ts";
import type { ProjectRuntime } from "../project/runtime.ts";

export interface AuthVars {
  dev: string;
  /** Manages the project from the dashboard (may act on other people's sessions and tasks). */
  admin: boolean;
  principal?: Principal;
}

export const SESSION_COOKIE = "gtv_session";

export const bearer = (c: Context) => c.req.header("authorization")?.replace(/^Bearer\s+/i, "") || c.req.query("token") || undefined;

/** The caller's token and whether it came from the session cookie (which makes writes need a same-site Origin). */
function credentials(c: Context): { token?: string; cookie: boolean } {
  const b = bearer(c);
  if (b) return { token: b, cookie: false };
  const s = getCookie(c, SESSION_COOKIE);
  return s?.startsWith("gtvs_") ? { token: s, cookie: true } : { cookie: false };
}

const isHttps = (c: Context) => (c.req.header("x-forwarded-proto")?.split(",")[0].trim() || new URL(c.req.url).protocol.slice(0, -1)) === "https";

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: "Lax", secure: isHttps(c), path: "/", maxAge: SESSION_DAYS * 86_400 });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: isHttps(c) });
}

/** Client address (behind Cloudflare or a proxy too); undefined for in-process requests (tests). */
export function clientIp(c: Context): string | undefined {
  return (
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
    (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress
  );
}

export const sessionMeta = (c: Context): SessionMeta => ({ user_agent: c.req.header("user-agent"), ip: clientIp(c) });

/**
 * CSRF: a write with the session cookie must come from the dashboard's own pages, and any write that names an Origin
 * must name this server. Compared by host: behind a tunnel the scheme the server sees may differ.
 */
function crossSite(c: Context, cookie: boolean): boolean {
  if (c.req.method === "GET" || c.req.method === "HEAD") return false;
  const origin = c.req.header("origin");
  if (!origin) return cookie;
  try {
    return new URL(origin).host !== (c.req.header("x-forwarded-host") ?? new URL(c.req.url).host);
  } catch {
    return true;
  }
}

export function openMode(hub: Hub): boolean {
  return hub.cfg.authOpen || (!hub.cfg.adminToken && !hub.accounts.hasUsers());
}

/** Who is calling, or undefined (no or unknown token outside open mode; locked or deleted accounts). */
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
  const ip = clientIp(c);
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
const UNAUTHORIZED: Denied = { status: 401, error: "unauthorized: log in to the dashboard" };
const FORBIDDEN_ADMIN: Denied = { status: 403, error: "forbidden: only an admin can do this" };
const FORBIDDEN_SHARE: Denied = { status: 403, error: "forbidden: this link is read-only for one project" };
const forbidden = (need: ProjectAccess): Denied => ({ status: 403, error: `forbidden: this needs ${need} access in the project` });
const FORBIDDEN_MANAGER = forbidden("manager");

/** public | any logged-in person | server admin | project access (self: the person named in the path, or a manager). */
type Need = "public" | "user" | "admin" | "viewer" | "developer" | "manager" | "self";

/** Who may call each dashboard route (path relative to /api). The first match wins; anything unlisted is for admins. */
const ROUTES: [method: string, path: RegExp, need: Need][] = [
  ["GET", /^\/auth\/config$/, "public"],
  ["POST", /^\/auth\/(setup|signup|login)$/, "public"],
  ["*", /^\/auth\/reset\/[^/]+$/, "public"],
  ["GET", /^\/invites\/[^/]+$/, "public"],
  ["*", /^\/(admin|brain)(\/|$)/, "admin"],
  ["POST", /^\/projects\/check-repo$/, "user"],
  ["*", /^\/projects\/[^/]+\/(share-links|invites)(\/|$)/, "manager"],
  ["DELETE", /^\/projects\/[^/]+\/members\/[^/]+$/, "self"],
  ["GET", /^\/projects\/[^/]+(\/|$)/, "viewer"],
  ["*", /^\/projects\/[^/]+(\/|$)/, "manager"],
  ["*", /^\/(auth\/logout|me|me\/.+|connect\/.+|invites\/[^/]+\/accept|overview|projects)$/, "user"],
];

/** Why a dashboard API call (path relative to /api) is refused, or undefined when allowed. */
export function apiDenied(hub: Hub, p: Principal | undefined, method: string, path: string): Denied | undefined {
  const need = ROUTES.find(([m, re]) => (m === "*" || m === method) && re.test(path))?.[2] ?? "admin";
  if (need === "public") return undefined;
  if (!p || p.kind === "device") return UNAUTHORIZED; // a computer's key is not a dashboard login
  if (p.kind === "share" && need !== "viewer" && path !== "/auth/logout" && !(method === "GET" && (path === "/me" || path === "/overview")))
    return FORBIDDEN_SHARE;
  if (need === "user") return undefined;
  if (need === "admin") return p.role === "admin" ? undefined : FORBIDDEN_ADMIN;
  const [, id, member] = /^\/projects\/([^/]+)(?:\/members\/([^/]+))?/.exec(path)!;
  const access = hub.projectAccess(p, decodeURIComponent(id));
  if (access === "none") return { status: 404, error: `unknown project ${decodeURIComponent(id)}` }; // do not reveal it exists
  if (need === "self") return decodeURIComponent(member) === p.name || access === "manager" ? undefined : forbidden("manager");
  return ACCESS_RANK[access] >= ACCESS_RANK[need] ? undefined : forbidden(need);
}

/** Dashboard API (/api). */
export function adminAuth(hub: Hub) {
  return async (c: Context<{ Variables: AuthVars }>, next: Next) => {
    const path = c.req.path.replace(/^\/api/, "") || "/";
    const { token, cookie } = credentials(c);
    if (crossSite(c, cookie)) return c.json({ error: "forbidden: this request did not come from the dashboard" }, 403);
    const p = principalFor(hub, token);
    const denied = apiDenied(hub, p, c.req.method, path);
    if (denied) return c.json({ error: denied.error }, denied.status);
    if (p && p.kind !== "device") {
      c.set("dev", p.name);
      c.set("admin", p.role === "admin");
      c.set("principal", p);
    }
    await next();
  };
}

/** Project-independent part of /v1: who is calling. The admin token and open mode may act as a developer (X-Gtv-Dev). */
export function v1Auth(hub: Hub) {
  return async (c: Context<{ Variables: AuthVars }>, next: Next) => {
    const { token, cookie } = credentials(c);
    if (crossSite(c, cookie)) return c.json({ error: "forbidden: this request did not come from the dashboard" }, 403);
    const p = principalFor(hub, token);
    if (!p) return c.json({ error: "unauthorized: this computer is not connected (run: gtv login)" }, 401);
    if (p.kind === "share" && !/^\/v1\/p\//.test(c.req.path)) return c.json({ error: "forbidden: this link is read-only for one project" }, 403);
    c.set("dev", p.kind === "admin_token" || p.kind === "open" ? c.req.header("x-gtv-dev") || p.name : p.name);
    c.set("admin", false);
    c.set("principal", p);
    await next();
  };
}

/** The 403 an agent's computer gets in a project it may not work in; the CLI and daemon show it as is. */
export function notMemberMessage(project: { id: string; name: string }, access: string): string {
  return access === "viewer"
    ? `You are a viewer in project ${project.name}; agents need developer access. Ask a project manager to change it.`
    : `You are not a member of project ${project.id}. Ask a project manager for an invite link.`; // the id they already know, never the name
}

const FORBIDDEN_OTHERS_TASK: Denied = { status: 403, error: "forbidden: only a manager gives tasks to someone else" };

/**
 * Project API (/v1/p/:id), once the project is known. Computers work in projects where their person is a developer
 * or manager. Dashboard sessions read as viewers and change things as managers; a developer may also answer
 * questions sent to them (or to everyone), update the tasks assigned to them, create tasks for themselves or for
 * nobody yet, and edit the project's documents and knowledge notes.
 */
export async function projectDenied(hub: Hub, c: Context<{ Variables: AuthVars & { rt: ProjectRuntime } }>): Promise<Denied | undefined> {
  const p = c.get("principal")!;
  const rt = c.get("rt");
  const access = hub.projectAccess(p, rt.record.id);
  if (p.kind === "device") return access === "developer" || access === "manager" ? undefined : { status: 403, error: notMemberMessage(rt.record, access) };
  if (access === "none") return { status: 404, error: `unknown project ${rt.record.id}` };
  // In open mode a daemon names its developer and acts as that developer only (as before accounts).
  c.set("admin", access === "manager" && !(p.kind === "open" && c.req.header("x-gtv-dev")));
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || access === "manager") return undefined;
  if (p.kind === "share" || access !== "developer") return FORBIDDEN_MANAGER;
  const me = p.name;
  const sub = c.req.path.replace(/^\/v1\/p\/[^/]+/, "");
  const ticket = /^\/tickets\/([^/]+)\/(reply|withdraw)$/.exec(sub);
  if (ticket && method === "POST") {
    const t = rt.engine.store.ticket(decodeURIComponent(ticket[1]));
    if (ticket[2] === "withdraw")
      return !t || t.from_dev === me ? undefined : { status: 403, error: "forbidden: only the asker or a manager closes a question" };
    return !t || !t.to_dev || t.to_dev === me ? undefined : { status: 403, error: "forbidden: this question was sent to someone else" };
  }
  if (sub === "/board" && method === "POST") {
    const body = (await c.req.json().catch(() => ({}))) as { assignee?: string | null };
    return !body.assignee || body.assignee === me ? undefined : FORBIDDEN_OTHERS_TASK;
  }
  const board = /^\/board\/([^/]+)(\/notes)?$/.exec(sub);
  if (board && (method === "PATCH" || (method === "POST" && board[2]))) {
    const item = rt.engine.board.get(decodeURIComponent(board[1]));
    if (item && item.assignee !== me) return { status: 403, error: "forbidden: you can only change tasks assigned to you" };
    if (method === "PATCH") {
      const body = (await c.req.json().catch(() => ({}))) as { assignee?: string | null };
      if ("assignee" in body && (body.assignee || undefined) !== item?.assignee) return FORBIDDEN_OTHERS_TASK;
    }
    return undefined;
  }
  if (
    (sub === "/kb" && method === "POST") ||
    (/^\/kb\/[^/]+$/.test(sub) && method === "PATCH") ||
    (/^\/kb\/[^/]+\/(confirm|reject)$/.test(sub) && method === "POST")
  )
    return undefined;
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
