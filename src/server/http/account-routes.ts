// Dashboard API (/api) for people and the server: setting up, signing up, logging in (session cookie), one's own
// account, sessions and computers, approving a computer (gtv login), and the admin's accounts and sign-up mode.

import { Hono, type Context } from "hono";
import type { Hub } from "../hub/hub.ts";
import type { Principal, Role } from "../hub/accounts.ts";
import { clearSessionCookie, openMode, publicOrigin, rateLimited, sessionMeta, setSessionCookie, type AuthVars } from "./auth.ts";

type Env = { Variables: AuthVars };
export type Registration = "open" | "invite" | "closed";
export const REGISTRATION: Registration[] = ["open", "invite", "closed"];

/** "Connected": the computer's daemon pinged /health (every 15 s) within the last minute. */
export const online = (lastSeen: string | null) => !!lastSeen && Date.now() - Date.parse(lastSeen) < 60_000;

/** A person's computers as "My computers" shows them. Repo paths are for the owner and server admins only. */
function devicesOf(hub: Hub, user: string) {
  const role = hub.accounts.user(user)?.role ?? "member";
  const running = hub
    .myProjects({ kind: "user", name: user, role })
    .flatMap(({ record }) =>
      (hub.live(record.id)?.engine.store.sessions() ?? [])
        .filter((s) => s.dev === user && s.device)
        .map((s) => ({ ...s, project: record.id, project_name: record.name })),
    );
  return hub.accounts.devices(user).map((d) => {
    const sessions = running
      .filter((s) => s.device === d.id)
      .map((s) => ({
        id: s.id,
        project: s.project,
        project_name: s.project_name,
        agent: s.agent,
        status: s.status,
        cwd: s.cwd ?? null,
        last_seen: s.last_seen,
      }));
    return {
      ...d,
      online: online(d.last_seen),
      repos: hub.accounts.deviceRepos(d.id).map((r) => {
        const rec = hub.record(r.project);
        const visible = rec && !rec.archived && hub.projectAccess({ kind: "user", name: user, role }, r.project) !== "none";
        return {
          ...r,
          project_name: visible ? rec.name : null, // not (or no longer) a member: the name stays private
          sessions: sessions
            .filter((s) => s.project === r.project && !!s.cwd && (s.cwd === r.path || s.cwd.startsWith(`${r.path}/`) || s.cwd.startsWith(`${r.path}\\`)))
            .map(({ id, agent, status }) => ({ id, agent, status })),
        };
      }),
      sessions,
    };
  });
}

const body = async <T>(c: Context) => (await c.req.json().catch(() => ({}))) as T;
const tooMany = (c: Context) => c.json({ error: "too many attempts: wait a minute" }, 429);

export function accountRoutes(hub: Hub): Hono<Env> {
  const app = new Hono<Env>();
  const registration = () => (hub.setting("registration") as Registration | undefined) ?? "open";

  /** Logs a person in on this browser: the session lives in an httpOnly cookie, never in the page's JavaScript. */
  const loggedIn = (c: Context, s: { token: string; user: { name: string; display_name: string; role: Role } }) => {
    setSessionCookie(c, s.token);
    return c.json({ name: s.user.name, display_name: s.user.display_name, role: s.user.role });
  };
  const me = (c: Context<Env>): Principal => c.get("principal")!;
  /** Account routes act on the logged-in person; the admin token and share links have no account. */
  const myName = (c: Context<Env>) => {
    const p = me(c);
    if (p.kind !== "user") throw new Error("log in with your own account for this");
    return p.name;
  };

  // ---- setting up, signing up, logging in ------------------------------------------------------

  app.get("/auth/config", (c) => c.json({ setup_needed: !hub.accounts.hasUsers(), registration: registration(), needs_admin_token: !!hub.cfg.adminToken }));

  /** The first account on an empty server is its admin; with GTV_ADMIN_TOKEN set, only whoever knows the token. */
  app.post("/auth/setup", async (c) => {
    if (rateLimited(c, "setup", 10)) return tooMany(c);
    if (hub.accounts.hasUsers()) return c.json({ error: "this server is already set up: log in" }, 409);
    const b = await body<{ name?: string; display_name?: string; password?: string; admin_token?: string }>(c);
    if (hub.cfg.adminToken && b.admin_token !== hub.cfg.adminToken) return c.json({ error: "wrong admin token (GTV_ADMIN_TOKEN on the server)" }, 403);
    hub.accounts.createUser(String(b.name ?? "").trim(), { display_name: b.display_name, role: "admin", password: String(b.password ?? "") });
    return loggedIn(c, hub.accounts.newSession(String(b.name).trim(), sessionMeta(c)));
  });

  app.post("/auth/signup", async (c) => {
    if (rateLimited(c, "signup", 5)) return tooMany(c);
    if (!hub.accounts.hasUsers()) return c.json({ error: "this server is not set up yet: open /setup" }, 403);
    const b = await body<{ name?: string; display_name?: string; password?: string; invite?: string }>(c);
    const mode = registration();
    if (mode === "closed") return c.json({ error: "sign-up is closed on this server: ask an admin" }, 403);
    if (b.invite && !hub.inviteInfo(b.invite).valid) return c.json({ error: "this invite link no longer works: ask for a new one" }, 400);
    if (mode === "invite" && !b.invite) return c.json({ error: "sign-up needs an invite link on this server" }, 403);
    const name = String(b.name ?? "").trim();
    hub.accounts.createUser(name, { display_name: b.display_name, password: String(b.password ?? "") });
    const joined = b.invite ? hub.acceptInvite(b.invite, name) : undefined;
    const s = hub.accounts.newSession(name, sessionMeta(c));
    setSessionCookie(c, s.token);
    return c.json({ name, display_name: s.user.display_name, role: s.user.role, project: joined ? { id: joined.project, access: joined.access } : null });
  });

  app.post("/auth/login", async (c) => {
    if (rateLimited(c, "login", 10)) return tooMany(c);
    const b = await body<{ name?: string; password?: string }>(c);
    return loggedIn(c, hub.accounts.login(String(b.name ?? "").trim(), String(b.password ?? ""), sessionMeta(c)));
  });

  app.post("/auth/logout", (c) => {
    const p = me(c);
    if (p.session) hub.accounts.endSession(p.session);
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  // Password reset links: the code is the credential (one use, one hour).
  app.get("/auth/reset/:code", (c) => {
    if (rateLimited(c, "reset", 30)) return tooMany(c);
    return c.json(hub.accounts.resetInfo(c.req.param("code")));
  });
  app.post("/auth/reset/:code", async (c) => {
    if (rateLimited(c, "reset", 30)) return tooMany(c);
    const { password } = await body<{ password?: string }>(c);
    return loggedIn(c, hub.accounts.resetPassword(c.req.param("code"), String(password ?? ""), sessionMeta(c)));
  });

  // ---- invite links ----------------------------------------------------------------------------

  /** Anyone may look at an invite: the project's name, the access and who invited, and whether they are in already. */
  app.get("/invites/:code", (c) => {
    if (rateLimited(c, "invite", 30)) return tooMany(c);
    const info = hub.inviteInfo(c.req.param("code"));
    const p = c.get("principal");
    const member = info.valid && p?.kind === "user" ? !!hub.members.access(info.project_id, p.name) : false;
    if (!info.valid) return c.json(info);
    const { project_id, ...card } = info;
    return c.json(member ? { ...info, member } : { ...card, member });
  });
  app.post("/invites/:code/accept", (c) => {
    if (rateLimited(c, "invite", 30)) return tooMany(c);
    const r = hub.acceptInvite(c.req.param("code"), myName(c));
    return c.json({ project: { id: r.project, name: hub.record(r.project)?.name ?? r.project }, access: r.access, already_member: r.already_member });
  });

  // ---- my account -----------------------------------------------------------------------------

  app.get("/me", (c) => {
    const p = me(c);
    const u = p.kind === "user" ? hub.accounts.user(p.name) : undefined;
    return c.json({
      name: p.name,
      display_name: u?.display_name ?? p.name,
      role: p.role,
      kind: p.kind,
      project: p.project ?? null,
      open_mode: openMode(hub),
      projects: hub.myProjects(p).map(({ record, access }) => ({ id: record.id, name: record.name, access })),
    });
  });
  app.patch("/me", async (c) => {
    const { display_name } = await body<{ display_name?: string }>(c);
    const u = hub.accounts.update(myName(c), { display_name: String(display_name ?? "") });
    return c.json({ name: u.name, display_name: u.display_name, role: u.role });
  });
  app.put("/me/password", async (c) => {
    const { current, password } = await body<{ current?: string; password?: string }>(c);
    hub.accounts.changePassword(myName(c), String(current ?? ""), String(password ?? ""), me(c).session);
    return c.json({ ok: true });
  });
  /** Deleting one's own account needs the password; the name stays taken. */
  app.delete("/me", async (c) => {
    const { password } = await body<{ password?: string }>(c);
    if (!hub.accounts.verifyPassword(myName(c), String(password ?? ""))) throw new Error("wrong password");
    hub.deleteAccount(myName(c));
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.get("/me/sessions", (c) => {
    const current = me(c).session?.slice(0, 16);
    return c.json(hub.accounts.sessions(myName(c)).map((s) => ({ ...s, current: s.id === current })));
  });
  /** Log out every other browser; this one stays. */
  app.delete("/me/sessions", (c) => {
    hub.accounts.endSessions(myName(c), { keep: me(c).session });
    return c.json({ ok: true });
  });
  app.delete("/me/sessions/:id", (c) => {
    hub.accounts.endSessions(myName(c), { id: c.req.param("id") });
    if (me(c).session?.startsWith(c.req.param("id"))) clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.get("/me/devices", (c) => c.json(me(c).kind === "user" ? devicesOf(hub, me(c).name) : []));
  app.patch("/me/devices/:id", async (c) => {
    const { name } = await body<{ name?: string }>(c);
    hub.accounts.renameDevice(c.req.param("id"), myName(c), String(name ?? ""));
    return c.json({ ok: true });
  });
  /** Disconnects a computer: its key stops working and its daemon says "Run: gtv login". */
  app.delete("/me/devices/:id", (c) => {
    if (!hub.accounts.removeDevice(c.req.param("id"), myName(c))) throw new Error("unknown computer");
    return c.json({ ok: true });
  });

  // Approving a computer that ran `gtv login`: it joins the account of whoever is logged in here.
  app.get("/connect/:code", (c) => {
    if (rateLimited(c, "connect-code", 30)) return tooMany(c);
    const r = hub.accounts.connectRequest(c.req.param("code"));
    return r ? c.json(r) : c.json({ error: "unknown or expired code: run gtv login again" }, 404);
  });
  app.post("/connect/:code/:action{approve|deny}", (c) => {
    hub.accounts.decideConnect(c.req.param("code"), myName(c), c.req.param("action") === "approve");
    return c.json({ ok: true });
  });

  // ---- server admin: accounts and sign-up mode ----------------------------------------------------

  app.get("/admin/users", (c) => {
    const devices = hub.accounts.devices();
    return c.json(
      hub.accounts.users().map((u) => {
        const mine = devices.filter((d) => d.user === u.name);
        return {
          ...u,
          disabled: !!u.disabled_at,
          projects: hub.myProjects({ kind: "user", name: u.name, role: "member" }).length,
          devices: mine.length,
          last_seen:
            mine
              .map((d) => d.last_seen ?? "")
              .sort()
              .pop() || null,
        };
      }),
    );
  });
  app.patch("/admin/users/:name", async (c) => {
    const b = await body<{ role?: Role; disabled?: boolean }>(c);
    return c.json(hub.accounts.update(c.req.param("name"), { role: b.role, disabled: b.disabled === undefined ? undefined : !!b.disabled }));
  });
  /** A one-time link (1 hour) for someone who forgot their password; the admin sends it by chat. */
  app.post("/admin/users/:name/reset", (c) => {
    const r = hub.accounts.createReset(c.req.param("name"));
    return c.json({ reset_url: `${publicOrigin(c)}/reset/${r.code}`, expires_at: r.expires_at });
  });
  app.get("/admin/users/:name/devices", (c) => c.json(devicesOf(hub, c.req.param("name"))));
  app.delete("/admin/users/:name", (c) => {
    hub.deleteAccount(c.req.param("name"));
    return c.json({ ok: true });
  });

  app.get("/admin/settings", (c) => c.json({ registration: registration() }));
  app.put("/admin/settings", async (c) => {
    const { registration: r } = await body<{ registration?: Registration }>(c);
    if (r !== undefined) {
      if (!REGISTRATION.includes(r)) throw new Error(`registration must be one of ${REGISTRATION.join(", ")}`);
      hub.setSetting("registration", r);
    }
    return c.json({ registration: registration() });
  });

  return app;
}
