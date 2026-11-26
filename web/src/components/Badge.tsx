import type { ReactNode } from "react";
import type { Level } from "../api/types";

export type BadgeTone =
  "default" | "strong" | "solid" | "accent" | "ok" | "info" | "warning" | "high" | "critical" | "danger" | "danger-outline" | "claude" | "codex" | "other";

export function Badge({ tone = "default", mono, children, title }: { tone?: BadgeTone; mono?: boolean; children: ReactNode; title?: string }) {
  return (
    <span className={`badge${tone === "default" ? "" : ` ${tone}`}${mono ? " mono" : ""}`} title={title}>
      {children}
    </span>
  );
}

const LEVEL_LABEL: Record<Level, string> = { info: "Thông tin", warning: "Cảnh báo", high: "Nghiêm trọng", critical: "Rất nghiêm trọng" };

/** Severity uses its own colour ramp: info → warning → high → critical. */
export function LevelBadge({ level }: { level: Level }) {
  return <Badge tone={level}>{LEVEL_LABEL[level]}</Badge>;
}

const AGENT_NAME: Record<string, string> = { claude: "Claude Code", codex: "Codex" };
export const agentTone = (agent: string): BadgeTone => (agent === "claude" || agent === "codex" ? agent : "other");
export const agentName = (agent: string): string => AGENT_NAME[agent] ?? agent;

export function AgentBadge({ agent }: { agent: string }) {
  return <Badge tone={agentTone(agent)}>{agentName(agent)}</Badge>;
}

const STATUS: Record<string, { tone: BadgeTone; label: string }> = {
  open: { tone: "strong", label: "đang mở" },
  acked: { tone: "default", label: "đã biết" },
  resolved: { tone: "ok", label: "đã xử lý" },
  dismissed: { tone: "default", label: "bỏ qua" },
  answered: { tone: "ok", label: "đã trả lời" },
  forwarded: { tone: "info", label: "đã chuyển" },
  waiting_human: { tone: "warning", label: "chờ người trả lời" },
  answering: { tone: "info", label: "đang trả lời" },
  closed: { tone: "default", label: "đã đóng" },
  expired: { tone: "default", label: "hết hạn" },
  active: { tone: "ok", label: "đang làm" },
  idle: { tone: "default", label: "đang rảnh" },
  ended: { tone: "default", label: "đã thoát" },
  unverified: { tone: "warning", label: "chưa xác nhận" },
  superseded: { tone: "default", label: "đã thay thế" },
};

/** Knowledge documents reuse a few status words with another meaning. */
const DOC_STATUS: Record<string, { tone: BadgeTone; label: string }> = {
  active: { tone: "ok", label: "đã xác nhận" },
  rejected: { tone: "default", label: "đã loại" },
};

export function StatusBadge({ status, doc }: { status: string; doc?: boolean }) {
  const s = (doc && DOC_STATUS[status]) || STATUS[status];
  return (
    <Badge tone={s?.tone ?? "default"} title={status}>
      {s?.label ?? status.replace("_", " ")}
    </Badge>
  );
}
