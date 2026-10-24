import type { ReactNode } from "react";
import type { Level } from "../api/types";

export type BadgeTone = "default" | "strong" | "solid" | "danger" | "danger-outline";

export function Badge({ tone = "default", mono, children, title }: { tone?: BadgeTone; mono?: boolean; children: ReactNode; title?: string }) {
  return (
    <span className={`badge${tone === "default" ? "" : ` ${tone}`}${mono ? " mono" : ""}`} title={title}>
      {children}
    </span>
  );
}

const LEVEL_TONE: Record<Level, BadgeTone> = { info: "default", warning: "strong", high: "solid", critical: "danger" };

/** Severity: info (outline) → warning (bold outline) → high (inverted) → critical (red). */
export function LevelBadge({ level }: { level: Level }) {
  return <Badge tone={LEVEL_TONE[level]}>{level}</Badge>;
}

const STATUS_TONE: Record<string, BadgeTone> = {
  open: "strong",
  acked: "default",
  resolved: "default",
  dismissed: "default",
  answered: "solid",
  forwarded: "strong",
  waiting_human: "danger-outline",
  answering: "strong",
  closed: "default",
  expired: "danger-outline",
  active: "solid",
  idle: "strong",
  ended: "default",
  unverified: "danger-outline",
  superseded: "default",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "default"}>{status.replace("_", " ")}</Badge>;
}
