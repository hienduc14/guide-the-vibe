import { useColorOf } from "../hooks/usePeople";
import { initials } from "../lib/people";
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

/** Initials in a ring of the person's colour (the same colour as their threads on the work map). */
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const colorOf = useColorOf();
  const text = initials(name);
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * (text.length > 1 ? 0.36 : 0.4), ["--p" as string]: colorOf(name) }}
      title={name}
    >
      {text || "?"}
    </span>
  );
}
