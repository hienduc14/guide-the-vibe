import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { Avatar } from "./Member";
import { agentName } from "./Badge";

/*
 * Visual building blocks: agent logos, avatars, progress rings, KPI tiles and empty states.
 * Pictures carry the meaning; text is one or two words beside them.
 */

const AGENT_LOGO: Record<string, string> = { claude: "/agents/claude-code.svg", codex: "/agents/codex.svg" };

/** The agent's real logo (Claude Code, Codex); other agents get their initial in a neutral square. */
export function AgentLogo({ agent, size = 16 }: { agent: string; size?: number }) {
  const src = AGENT_LOGO[agent];
  if (src) return <img className={`agent-logo a-${agent}`} src={src} alt={agentName(agent)} title={agentName(agent)} width={size} height={size} />;
  return (
    <span className="agent-logo other" title={agentName(agent)} style={{ width: size, height: size, fontSize: size * 0.6 }}>
      {agentName(agent).slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Avatar with the agent's logo pinned to the corner. */
export function DevAvatar({ name, agent, size = 32 }: { name: string; agent?: string; size?: number }) {
  return (
    <span className="dev-avatar" title={agent ? `${name} · ${agentName(agent)}` : name}>
      <Avatar name={name} size={size} />
      {agent && (
        <span className="dev-avatar-agent">
          <AgentLogo agent={agent} size={Math.max(12, Math.round(size * 0.45))} />
        </span>
      )}
    </span>
  );
}

/** Overlapping avatars; extra people collapse into "+n". */
export function AvatarStack({ people, max = 4, size = 26 }: { people: { name: string; agent?: string }[]; max?: number; size?: number }) {
  const shown = people.slice(0, max);
  return (
    <span className="avatar-stack" title={people.map((p) => p.name).join(", ")}>
      {shown.map((p) => (
        <DevAvatar key={p.name} name={p.name} agent={p.agent} size={size} />
      ))}
      {people.length > max && (
        <span className="avatar more" style={{ width: size, height: size, fontSize: size * 0.38 }}>
          +{people.length - max}
        </span>
      )}
    </span>
  );
}

/** Circular progress; the number in the middle is the percentage. */
export function Ring({ value, total, size = 44, label }: { value: number; total: number; size?: number; label?: ReactNode }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const r = 15.5;
  const c = 2 * Math.PI * r;
  return (
    <span className="ring" style={{ width: size, height: size }} role="img" aria-label={`${pct}% (${value}/${total})`}>
      <svg viewBox="0 0 36 36" width={size} height={size} aria-hidden="true">
        <circle className="ring-track" cx="18" cy="18" r={r} />
        <circle className="ring-fill" cx="18" cy="18" r={r} strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 18 18)" />
      </svg>
      <span className="ring-label" style={{ fontSize: size * 0.24 }}>
        {label ?? `${pct}%`}
      </span>
    </span>
  );
}

export type Tone = "neutral" | "accent" | "ok" | "warning" | "high" | "critical";

/** One number with an icon: the big-picture tiles at the top of a page. */
export function Kpi({
  icon: Icon,
  value,
  label,
  tone = "neutral",
  to,
  title,
  aside,
}: {
  icon: LucideIcon;
  value: ReactNode;
  label: string;
  tone?: Tone;
  to?: string;
  title?: string;
  aside?: ReactNode;
}) {
  const body = (
    <>
      <span className="kpi-icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <span className="kpi-text">
        <b className="kpi-value">{value}</b>
        <span className="kpi-label">{label}</span>
      </span>
      {aside && <span className="kpi-aside">{aside}</span>}
    </>
  );
  return to ? (
    <Link to={to} className={`kpi t-${tone}`} title={title}>
      {body}
    </Link>
  ) : (
    <div className={`kpi t-${tone}`} title={title}>
      {body}
    </div>
  );
}

/** Empty state: a large icon and one short line. */
export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">
        <Icon size={28} />
      </span>
      <b>{title}</b>
      {children && <span className="small muted">{children}</span>}
    </div>
  );
}

/** Coloured dot + one or two words. */
export function StatusDot({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`status-dot t-${tone}`} title={title}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}
