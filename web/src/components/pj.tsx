// Small pieces shared by the project pages (styles in styles/project.css, scoped under .pj).

import type { ReactNode } from "react";
import { useColorOf } from "../hooks/usePeople";
import { initials } from "../lib/people";
import { agentName } from "./Badge";

const LOGO: Record<string, string> = { claude: "/agents/claude-code.svg", codex: "/agents/codex.svg" };

/** A person: initials in a ring of their colour, their agent's logo as a badge. */
export function Av({ who, agent, size = "", title }: { who: string; agent?: string | null; size?: "" | "sm" | "lg"; title?: string }) {
  const colorOf = useColorOf();
  if (who === "gtv" || who === "operator")
    return (
      <span className={`av ${size}`} title={who === "gtv" ? "gtv" : "AI của gtv"}>
        <img src="/gtv-logo.png" alt="" style={{ width: "62%", height: "62%" }} />
      </span>
    );
  return (
    <span className={`av ${size}`} style={{ ["--p" as string]: colorOf(who) }} title={title ?? (agent ? `${who} · ${agentName(agent)}` : who)}>
      {initials(who)}
      {agent && (
        <span className="p-logo">
          {LOGO[agent] ? <img src={LOGO[agent]} alt={agentName(agent)} /> : <span style={{ fontSize: 9 }}>{agentName(agent).slice(0, 1)}</span>}
        </span>
      )}
    </span>
  );
}

export function Avs({ people }: { people: { who: string; agent?: string | null }[] }) {
  return (
    <span className="avs">
      {people.map((p) => (
        <Av key={p.who} who={p.who} agent={p.agent} size="sm" />
      ))}
    </span>
  );
}

/** Person colour as a CSS custom property, for borders, threads and tints. */
export function usePc(): (who: string) => Record<string, string> {
  const colorOf = useColorOf();
  return (who: string) => ({ ["--p"]: colorOf(who) });
}

export const STATUS_LABEL: Record<string, string> = { active: "đang chạy", idle: "tạm nghỉ", ended: "đã thoát" };
const STATE_CLASS: Record<string, string> = { active: "running", idle: "idle", ended: "" };

export function State({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  return <span className={`state ${STATE_CLASS[status] ?? ""}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, ReactNode][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="p-seg" role="group" aria-label={label}>
      {options.map(([k, l]) => (
        <button key={k} type="button" className={value === k ? "on" : ""} aria-pressed={value === k} onClick={() => onChange(k)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Blank({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="p-empty">
      {icon && <span className="p-ring">{icon}</span>}
      <b>{title}</b>
      {children}
    </div>
  );
}

export const base = (path: string) => path.split("/").pop() ?? path;
export const dirOf = (path: string) => path.split("/").slice(0, -1).join("/") || "(gốc repo)";
