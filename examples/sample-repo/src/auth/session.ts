/** Session lifetime in minutes. See docs/adr/001-session-tokens.md before changing. */
export const SESSION_TTL_MIN = 30;

export interface Session {
  token: string;
  userId: number;
  expiresAt: number;
}

export function createSession(userId: number, now = Date.now()): Session {
  return { token: Math.random().toString(36).slice(2), userId, expiresAt: now + SESSION_TTL_MIN * 60_000 };
}

export function isExpired(s: Session, now = Date.now()): boolean {
  return now >= s.expiresAt;
}
