// Small formatting helpers shared by pages.

export function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return "vừa xong";
  if (s < 3600) return `${Math.round(s / 60)} phút trước`;
  if (s < 86_400) return `${Math.round(s / 3600)} giờ trước`;
  return `${Math.round(s / 86_400)} ngày trước`;
}

export function clock(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })} ${time}`;
}

export const shortSha = (sha: string | null | undefined) => (sha ? sha.slice(0, 8) : "—");

export const ms = (v: number | null | undefined) => (v == null ? "—" : v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(1)} s`);

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const plural = (n: number, word: string) => `${n} ${word}`;

/** Last path segment of a repo URL or path: "…/realworld/origin.git" → "realworld/origin.git". */
export function repoName(url: string): string {
  // Local paths on Windows use backslashes ("C:\Users\me\Temp\shop\origin.git").
  const parts = url
    .replace(/[/\\]+$/, "")
    .split(/[/\\:]/)
    .filter(Boolean);
  return parts.slice(-2).join("/");
}
