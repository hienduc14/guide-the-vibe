import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../api/endpoints";
import { useAuth } from "./useAuth";

/** What waits for me in one project: clashes I am in, questions sent to me, my tasks in progress. */
export interface Waiting {
  clash: number;
  ask: number;
  tasks: number;
}

const WaitingContext = createContext<Record<string, Waiting>>({});

/** Polls each of my projects for what waits for me; the rail badges and the home cards read it. */
export function WaitingProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const [byProject, setByProject] = useState<Record<string, Waiting>>({});
  const ids = me?.kind === "user" ? me.projects.filter((p) => p.access !== "viewer").map((p) => p.id) : [];
  const key = ids.join(",");
  useEffect(() => {
    if (!key || !me) return;
    let stop = false;
    const load = async () => {
      const entries = await Promise.all(
        key.split(",").map(async (id): Promise<[string, Waiting]> => {
          const [tasks, asks, incidents] = await Promise.all([
            api.board.list(id, "mine").catch(() => []),
            api.tickets.forMe(id).catch(() => []),
            api.incidents.list(id).catch(() => []),
          ]);
          return [
            id,
            {
              clash: incidents.filter((i) => i.status === "open" && (i.dev_a === me.name || i.dev_b === me.name)).length,
              ask: asks.length,
              tasks: tasks.filter((t) => t.status === "in_progress").length,
            },
          ];
        }),
      );
      if (!stop) setByProject(Object.fromEntries(entries));
    };
    void load();
    const t = window.setInterval(() => void load(), 30_000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [key, me]);
  return <WaitingContext.Provider value={byProject}>{children}</WaitingContext.Provider>;
}

export const useWaiting = () => useContext(WaitingContext);
