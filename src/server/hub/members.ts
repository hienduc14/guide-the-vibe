// Who is in which project (hub.db project_members) and the invite links that bring people in. Access is decided here
// only, so it is known before a project's runtime opens. A project always keeps a manager: the last one cannot be
// lowered, removed or leave. Invites never make someone a manager; a manager raises them later.

import { randomBytes } from "node:crypto";
import type { Db } from "../../shared/db.ts";
import { MEMBER_ACCESS, type MemberAccess } from "../../shared/types.ts";
import { newId, nowIso } from "../../shared/util.ts";
import { hashToken } from "./accounts.ts";

export interface Membership {
  project: string;
  user: string;
  access: MemberAccess;
  joined_at: string;
  invited_by: string | null;
}

export interface InviteRow {
  id: string;
  project: string;
  access: MemberAccess;
  created_by: string;
  created_at: string;
  expires_at: string;
  max_uses: number | null;
  uses: number;
  revoked_at: string | null;
}

export const INVITE_DAYS = [1, 7, 30];
export const INVITE_USES = [1, 10, null];
const INVITE_COLS = `id, project, access, created_by, created_at, expires_at, max_uses, uses, revoked_at`;

const usable = (i: InviteRow) => !i.revoked_at && i.expires_at > nowIso() && (i.max_uses === null || i.uses < i.max_uses);

function checkAccess(access: unknown): asserts access is MemberAccess {
  if (!MEMBER_ACCESS.includes(access as MemberAccess)) throw new Error(`access must be one of ${MEMBER_ACCESS.join(", ")}`);
}

export class Members {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }

  list(project: string): Membership[] {
    return this.db.all<Membership>(`SELECT * FROM project_members WHERE project = ? ORDER BY user`, project);
  }

  access(project: string, user: string): MemberAccess | undefined {
    return this.db.get<{ access: MemberAccess }>(`SELECT access FROM project_members WHERE project = ? AND user = ?`, project, user)?.access;
  }

  ofUser(user: string): Membership[] {
    return this.db.all<Membership>(`SELECT * FROM project_members WHERE user = ? ORDER BY project`, user);
  }

  add(project: string, user: string, access: MemberAccess, by: string | null): Membership {
    checkAccess(access);
    if (this.access(project, user)) throw new Error(`${user} is already a member of this project`);
    const m: Membership = { project, user, access, joined_at: nowIso(), invited_by: by };
    this.db.upsert("project_members", { ...m });
    return m;
  }

  private isLastManager(project: string, user: string): boolean {
    const managers = this.db.all<{ user: string }>(`SELECT user FROM project_members WHERE project = ? AND access = 'manager'`, project);
    return managers.length === 1 && managers[0].user === user;
  }

  setAccess(project: string, user: string, access: MemberAccess): void {
    checkAccess(access);
    if (!this.access(project, user)) throw new Error(`${user} is not a member of this project`);
    if (access !== "manager" && this.isLastManager(project, user)) throw new Error(`${user} is the last manager: make someone else a manager first`);
    this.db.run(`UPDATE project_members SET access = ? WHERE project = ? AND user = ?`, access, project, user);
  }

  remove(project: string, user: string): void {
    if (!this.access(project, user)) throw new Error(`${user} is not a member of this project`);
    if (this.isLastManager(project, user)) throw new Error(`${user} is the last manager: make someone else a manager first`);
    this.db.run(`DELETE FROM project_members WHERE project = ? AND user = ?`, project, user);
  }

  /** Projects where this person is the only manager (they cannot leave them or delete their account). */
  soleManagerOf(user: string): string[] {
    return this.ofUser(user)
      .filter((m) => m.access === "manager" && this.isLastManager(m.project, user))
      .map((m) => m.project);
  }

  removeUser(user: string): void {
    this.db.run(`DELETE FROM project_members WHERE user = ?`, user);
  }

  // ---- invite links ------------------------------------------------------------------------

  /** A link for joining as developer or viewer; the code is returned once (only its hash is kept). */
  createInvite(project: string, opts: { access?: unknown; days?: unknown; max_uses?: unknown }, by: string): InviteRow & { code: string } {
    const access = opts.access ?? "developer";
    if (access !== "developer" && access !== "viewer") throw new Error("an invite gives developer or viewer access; raise someone to manager afterwards");
    const days = opts.days ?? 7;
    if (!INVITE_DAYS.includes(days as number)) throw new Error(`days must be one of ${INVITE_DAYS.join(", ")}`);
    const max_uses = opts.max_uses ?? null;
    if (!INVITE_USES.includes(max_uses as number | null)) throw new Error("max_uses must be 1, 10 or null (no limit)");
    const code = randomBytes(18).toString("base64url");
    const row: InviteRow = {
      id: newId("inv"),
      project,
      access,
      created_by: by,
      created_at: nowIso(),
      expires_at: new Date(Date.now() + (days as number) * 86_400_000).toISOString(),
      max_uses: max_uses as number | null,
      uses: 0,
      revoked_at: null,
    };
    this.db.upsert("project_invites", { ...row, code_hash: hashToken(code) });
    return { ...row, code };
  }

  /** Links that still work. */
  invites(project: string): InviteRow[] {
    return this.db.all<InviteRow>(`SELECT ${INVITE_COLS} FROM project_invites WHERE project = ? ORDER BY created_at DESC`, project).filter(usable);
  }

  revokeInvite(project: string, id: string): void {
    this.db.run(`UPDATE project_invites SET revoked_at = ? WHERE project = ? AND id = ? AND revoked_at IS NULL`, nowIso(), project, id);
  }

  /** The link behind a code, if it still works. */
  invite(code: string): InviteRow | undefined {
    const row = this.db.get<InviteRow>(`SELECT ${INVITE_COLS} FROM project_invites WHERE code_hash = ?`, hashToken(String(code)));
    return row && usable(row) ? row : undefined;
  }

  /** Joins through a working link; someone already in the project keeps their access and uses no turn of the link. */
  acceptInvite(code: string, user: string): { project: string; access: MemberAccess; already_member: boolean } {
    const inv = this.invite(code);
    if (!inv) throw new Error("this invite link no longer works: ask for a new one");
    const current = this.access(inv.project, user);
    if (current) return { project: inv.project, access: current, already_member: true };
    this.db.tx(() => {
      this.db.run(`UPDATE project_invites SET uses = uses + 1 WHERE id = ?`, inv.id);
      this.add(inv.project, user, inv.access, inv.created_by);
    });
    return { project: inv.project, access: inv.access, already_member: false };
  }
}
