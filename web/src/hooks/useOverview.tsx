import { createContext, useContext, type ReactNode } from "react";
import { api } from "../api/endpoints";
import type { Overview } from "../api/types";
import { usePoll, type Poll } from "./usePoll";

const OverviewContext = createContext<Poll<Overview> | null>(null);

/** /api/overview is shared by the sidebar (project list, mode) and the overview page. */
export function OverviewProvider({ children }: { children: ReactNode }) {
  const poll = usePoll(api.overview, [], 5000);
  return <OverviewContext.Provider value={poll}>{children}</OverviewContext.Provider>;
}

export function useOverview(): Poll<Overview> {
  const ctx = useContext(OverviewContext);
  if (!ctx) throw new Error("useOverview outside OverviewProvider");
  return ctx;
}
