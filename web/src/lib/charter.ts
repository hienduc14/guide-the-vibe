import type { Charter } from "../api/types";

export const QUALITY: Record<NonNullable<Charter["quality"]>, string> = { prototype: "Prototype", mvp: "MVP", production: "Production" };

/** Days until a YYYY-MM-DD date (negative when past). */
export function daysUntil(date: string): number {
  return Math.ceil((new Date(`${date}T23:59:59`).getTime() - Date.now()) / 86_400_000);
}
