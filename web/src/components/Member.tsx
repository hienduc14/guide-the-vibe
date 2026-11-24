import type { MemberLevel } from "../api/types";

export const LEVELS: MemberLevel[] = ["intern", "junior", "mid", "senior", "lead"];
export const LEVEL_LABEL: Record<MemberLevel, string> = { intern: "Thực tập", junior: "Junior", mid: "Middle", senior: "Senior", lead: "Lead" };
export const ROLE_SUGGESTIONS = ["tech lead", "backend", "frontend", "fullstack", "mobile", "qa", "devops", "designer", "pm"];

/** Level as a small ladder: filled steps up to the member's level, so seniority reads at a glance. */
export function LevelLadder({ level }: { level: MemberLevel | null | undefined }) {
  if (!level) return null;
  const n = LEVELS.indexOf(level);
  return (
    <span className="ladder" title={`Level: ${LEVEL_LABEL[level]}`}>
      {LEVELS.map((l, i) => (
        <i key={l} className={i <= n ? "on" : ""} />
      ))}
      <span>{LEVEL_LABEL[level]}</span>
    </span>
  );
}

/** Initials in a coloured circle; the colour is stable per name. */
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  const parts = name.split(/[._\-\s]+/).filter(Boolean);
  // One-word names get two letters ("hoc" → "Ho", "hien" → "Hi") so people sharing an initial stay apart.
  const initials =
    parts.length > 1
      ? parts
          .slice(0, 2)
          .map((p) => p[0]!.toUpperCase())
          .join("")
      : (parts[0] ?? "").slice(0, 2).replace(/^./, (c) => c.toUpperCase());
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * (initials.length > 1 ? 0.36 : 0.4),
        background: `hsl(${h} 55% 90%)`,
        color: `hsl(${h} 50% 28%)`,
      }}
      title={name}
    >
      {initials || "?"}
    </span>
  );
}
