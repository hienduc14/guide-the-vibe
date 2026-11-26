import type { Member } from "../api/types";

/** Six person colours (tokens --c-*), given in the order members joined the project, then reused. */
const COLORS = ["amber", "violet", "teal", "green", "pink", "sky"] as const;

export function personColor(dev: string, members: Pick<Member, "dev" | "created_at">[]): string {
  const order = [...members].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.dev.localeCompare(b.dev)).map((m) => m.dev);
  let i = order.indexOf(dev);
  if (i < 0) i = order.length + [...dev].reduce((n, ch) => n + ch.charCodeAt(0), 0); // not a member yet: stable, after the members
  return `var(--c-${COLORS[i % COLORS.length]})`;
}

/** Two-letter initials as the avatars show them: "hien-test" → "HT", "hoc" → "Ho". */
export function initials(name: string): string {
  const parts = name.split(/[-_.\s]+/).filter(Boolean);
  if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 1).toUpperCase() + name.slice(1, 2);
}
