import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getShareToken, setShareToken, UNAUTHORIZED_EVENT } from "../api/client";
import { api } from "../api/endpoints";
import type { AuthConfig, Me, Role } from "../api/types";

const RANK: Record<Role, number> = { member: 0, admin: 1 };

interface AuthState {
  /** Server state for the gate pages; undefined while loading. */
  config: AuthConfig | undefined;
  /** Who is logged in: undefined while loading, null when nobody is (the session cookie is missing or ended). */
  me: Me | null | undefined;
  /** True when the caller's system role is at least `role` (project access: useProject().access). */
  can: (role: Role) => boolean;
  shared: boolean;
  /** Ask the server again who is logged in (after logging in, joining a project, renaming…). */
  refresh: () => Promise<Me | null>;
  logout: () => Promise<void>;
  leaveShare: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

const ROLE_KEY = "gtv.lastRole";
function writeRole(role: Role | null) {
  try {
    if (role) localStorage.setItem(ROLE_KEY, role);
    else localStorage.removeItem(ROLE_KEY);
  } catch {
    /* storage blocked: the role then loads with /me as before */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AuthConfig>();
  const [me, setMe] = useState<Me | null>();

  const refresh = useCallback(async () => {
    const next = await api.auth.me().catch(() => null);
    setMe(next);
    return next;
  }, []);

  useEffect(() => {
    api.auth
      .config()
      .then(setConfig)
      .catch(() => setConfig({ setup_needed: false, registration: "open", needs_admin_token: false }));
    void refresh();
    const onUnauthorized = () => {
      if (!getShareToken()) setMe(null);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [refresh]);

  // Role-dependent CSS: .admin-only controls disappear for members (the server still refuses what a role may not do).
  useEffect(() => {
    if (me === undefined) {
      if (!document.body.dataset.role) document.body.dataset.role = localStorage.getItem(ROLE_KEY) ?? "member";
      return;
    }
    document.body.dataset.role = me?.role ?? "member";
    writeRole(me?.role ?? null);
  }, [me]);

  const logout = useCallback(async () => {
    await api.auth.logout().catch(() => undefined);
    setShareToken(null);
    writeRole(null);
    setMe(null);
    window.location.href = "/login";
  }, []);

  const leaveShare = useCallback(() => {
    setShareToken(null);
    window.location.href = "/";
  }, []);

  const can = useCallback((role: Role) => !!me && RANK[me.role] >= RANK[role], [me]);

  return <AuthContext.Provider value={{ config, me, can, shared: me?.kind === "share", refresh, logout, leaveShare }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

/** The display name to greet someone with: their own, else the user name. */
export const displayName = (me: Me | null | undefined) => me?.display_name || me?.name || "";
