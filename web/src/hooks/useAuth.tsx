import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getToken, setToken, UNAUTHORIZED_EVENT } from "../api/client";

interface AuthState {
  token: string | null;
  needsLogin: boolean;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTok] = useState<string | null>(getToken());
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    const onUnauthorized = () => setNeedsLogin(true);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback((t: string) => {
    setToken(t);
    setTok(t);
    setNeedsLogin(false);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setTok(null);
    setNeedsLogin(true);
  }, []);

  return <AuthContext.Provider value={{ token, needsLogin, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
