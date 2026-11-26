import { createContext, useContext, type ReactNode } from "react";
import type { Member } from "../api/types";
import { personColor } from "../lib/people";

/** The open project's members, so every avatar and map thread gives a person the same colour. */
const Ctx = createContext<Pick<Member, "dev" | "created_at">[]>([]);

export function PeopleProvider({ members, children }: { members: Pick<Member, "dev" | "created_at">[]; children: ReactNode }) {
  return <Ctx.Provider value={members}>{children}</Ctx.Provider>;
}

export function useColorOf(): (dev: string) => string {
  const members = useContext(Ctx);
  return (dev: string) => personColor(dev, members);
}
