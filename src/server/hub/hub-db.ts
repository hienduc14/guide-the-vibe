// Hub database (data/hub.db): projects, developers + tokens, brain job metering and providers, global settings.

export const HUB_SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, repo_url TEXT NOT NULL, main_branch TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]', policy TEXT NOT NULL DEFAULT '{}', description TEXT,
  archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS devs (
  name TEXT PRIMARY KEY, token_hash TEXT NOT NULL, created_at TEXT NOT NULL, last_seen TEXT
);
-- One-time invite links (gtv join): redeeming one issues the dev's token.
CREATE TABLE IF NOT EXISTS invites (code_hash TEXT PRIMARY KEY, dev TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS brain_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, project TEXT NOT NULL, kind TEXT NOT NULL,
  backend TEXT NOT NULL, model TEXT, ms INTEGER NOT NULL, ok INTEGER NOT NULL, error TEXT
);
CREATE INDEX IF NOT EXISTS brain_jobs_ts ON brain_jobs(ts);
CREATE INDEX IF NOT EXISTS brain_jobs_project ON brain_jobs(project, ts);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- LLM providers entered on the dashboard (brain/credentials.ts): data is sealed with GTV_SECRET_KEY.
CREATE TABLE IF NOT EXISTS brain_credentials (provider TEXT PRIMARY KEY, type TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);
-- Dashboard accounts (admin | manager | viewer), their login sessions and read-only share links (accounts.ts).
CREATE TABLE IF NOT EXISTS users (name TEXT PRIMARY KEY, role TEXT NOT NULL, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL, last_login TEXT);
CREATE TABLE IF NOT EXISTS user_sessions (token_hash TEXT PRIMARY KEY, user TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS share_links (
  id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, project TEXT NOT NULL, label TEXT, created_by TEXT,
  created_at TEXT NOT NULL, expires_at TEXT, last_used TEXT
);
CREATE TABLE IF NOT EXISTS brain_endpoints (id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, api TEXT NOT NULL, created_at TEXT NOT NULL);
`;
