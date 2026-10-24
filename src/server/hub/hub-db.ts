// Hub database (data/hub.db): projects, developers + tokens, brain job metering, global settings.

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
CREATE TABLE IF NOT EXISTS brain_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, project TEXT NOT NULL, kind TEXT NOT NULL,
  backend TEXT NOT NULL, model TEXT, ms INTEGER NOT NULL, ok INTEGER NOT NULL, error TEXT
);
CREATE INDEX IF NOT EXISTS brain_jobs_ts ON brain_jobs(ts);
CREATE INDEX IF NOT EXISTS brain_jobs_project ON brain_jobs(project, ts);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;
