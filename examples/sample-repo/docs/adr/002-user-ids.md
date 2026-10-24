---
type: adr
status: active
---
# ADR 002: User ids are numbers

User ids are positive integers. External identity providers (Google SSO) map to an internal numeric id
through `users.external_id`; never pass provider ids (strings) into `getUser`.

Owner: bob.
