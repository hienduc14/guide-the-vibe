import { findById, findByEmail, type User } from "../users/repo.ts";
import { createSession, type Session } from "./session.ts";

export class AuthService {
  login(email: string, password: string): Session {
    const user = findByEmail(email);
    if (!user || password.length < 8) throw new Error("invalid credentials");
    return createSession(user.id);
  }

  logout(session: Session): void {
    session.expiresAt = 0;
  }
}

export function getUser(id: number): User {
  const user = findById(id);
  if (!user) throw new Error(`user ${id} not found`);
  return user;
}
