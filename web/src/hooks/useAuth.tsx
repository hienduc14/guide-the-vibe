import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getShareToken, getToken, setShareToken, setToken, UNAUTHORIZED_EVENT } from "../api/client";
import { api } from "../api/endpoints";
import type { Me, Role } from "../api/types";

const RANK: Record<Role, number> = { viewer: 0, manager: 1, admin: 2 };

interface AuthState {
  token: string | null;
  needsLogin: boolean;
  /** Who is logged in; undefined while loading. */
  me: Me | undefined;
  /** True when the caller's role is at least `role`. */
  can: (role: Role) => boolean;
  shared: boolean;
  login: (token: string) => void;
  logout: () => void;
  leaveShare: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTok] = useState<string | null>(getShareToken() ?? getToken());
  const [needsLogin, setNeedsLogin] = useState(false);
  const [me, setMe] = useState<Me>();

  useEffect(() => {
    const onUnauthorized = () => setNeedsLogin(true);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  useEffect(() => {
    if (needsLogin) return;
    api.auth
      .me()
      .then(setMe)
      .catch(() => undefined);
  }, [token, needsLogin]);

  // Role-dependent CSS: .manage-only and .admin-only controls disappear for lower roles.
  useEffect(() => {
    const role = me?.role ?? "viewer";
    document.body.dataset.role = role;
  }, [me]);

  const login = useCallback((t: string) => {
    setShareToken(null); // a share link's token would otherwise keep winning over the new login
    setToken(t);
    setTok(t);
    setNeedsLogin(false);
  }, []);

  const logout = useCallback(() => {
    void api.auth.logout().catch(() => undefined);
    setShareToken(null);
    setToken(null);
    setTok(null);
    setMe(undefined);
    setNeedsLogin(true);
  }, []);

  const leaveShare = useCallback(() => {
    setShareToken(null);
    window.location.href = "/";
  }, []);

  const can = useCallback((role: Role) => !!me && RANK[me.role] >= RANK[role], [me]);

  return (
    <AuthContext.Provider value={{ token, needsLogin, me, can, shared: me?.kind === "share", login, logout, leaveShare }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
