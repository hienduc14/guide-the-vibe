---
type: adr
status: active
---
# ADR 001: Session tokens

Decision: sessions are opaque random tokens that live 30 minutes (`SESSION_TTL_MIN`).

Constraint: the mobile app v1 cannot refresh tokens, so any change to the login response must keep the
fields `token`, `userId` and `expiresAt`. A move to JWT must keep these fields and add new ones only.

Owner: alice.
