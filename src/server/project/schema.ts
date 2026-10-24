// Per-project database: registry, code graph, knowledge base and event log.

export const PROJECT_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY, dev TEXT NOT NULL, label TEXT NOT NULL, branch TEXT,
  snapshot_sha TEXT, snapshot_base TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, dev TEXT NOT NULL, agent TEXT NOT NULL, workspace_id TEXT NOT NULL,
  agent_session_id TEXT, cwd TEXT, status TEXT NOT NULL, capabilities TEXT NOT NULL, last_seen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, workspace_id TEXT NOT NULL, dev TEXT NOT NULL,
  title TEXT NOT NULL, goal TEXT, base_sha TEXT, resources TEXT NOT NULL, status TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS footprints (
  workspace_id TEXT NOT NULL, session_id TEXT NOT NULL, dev TEXT NOT NULL, path TEXT NOT NULL,
  first_at TEXT NOT NULL, last_at TEXT NOT NULL, count INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, path)
);
CREATE TABLE IF NOT EXISTS conflicts (
  id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, layer TEXT NOT NULL, kind TEXT NOT NULL, level TEXT NOT NULL,
  workspace_a TEXT NOT NULL, workspace_b TEXT NOT NULL, dev_a TEXT NOT NULL, dev_b TEXT NOT NULL,
  subject TEXT NOT NULL, evidence TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY, from_session TEXT NOT NULL, from_dev TEXT NOT NULL, question TEXT NOT NULL, context TEXT,
  tier INTEGER NOT NULL, status TEXT NOT NULL, answer TEXT, answered_by TEXT, sources TEXT NOT NULL,
  confidence TEXT, to_dev TEXT, forwarded_question TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, to_dev TEXT NOT NULL, to_workspace TEXT, to_session TEXT, kind TEXT NOT NULL, ref_id TEXT,
  body TEXT NOT NULL, created_at TEXT NOT NULL, delivered_at TEXT
);
CREATE TABLE IF NOT EXISTS symbol_changes (
  workspace_id TEXT NOT NULL, symbol_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
  change TEXT NOT NULL, old_sig TEXT, new_sig TEXT, new_id TEXT, exported INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, symbol_id)
);
-- Lines each workspace added/modified relative to its merge base (L2 precision).
CREATE TABLE IF NOT EXISTS wip_lines (workspace_id TEXT NOT NULL, path TEXT NOT NULL, ranges TEXT NOT NULL, PRIMARY KEY (workspace_id, path));
CREATE TABLE IF NOT EXISTS kb_docs (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL,
  source TEXT NOT NULL, path TEXT, ticket_id TEXT, supersedes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(doc_id UNINDEXED, title, body, tokenize = 'unicode61 remove_diacritics 2');
CREATE TABLE IF NOT EXISTS feature_overrides (feature TEXT PRIMARY KEY, mode TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS event_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, type TEXT NOT NULL, actor TEXT, payload TEXT NOT NULL
);

-- Code graph: layer = 'base' (main) or a workspace id (overlay of files that differ from main).
CREATE TABLE IF NOT EXISTS g_meta (layer TEXT PRIMARY KEY, sha TEXT, base_sha TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS g_files (
  layer TEXT NOT NULL, path TEXT NOT NULL, lang TEXT NOT NULL, content_hash TEXT NOT NULL, has_errors INTEGER NOT NULL,
  PRIMARY KEY (layer, path)
);
CREATE TABLE IF NOT EXISTS g_tombstones (layer TEXT NOT NULL, path TEXT NOT NULL, PRIMARY KEY (layer, path));
CREATE TABLE IF NOT EXISTS g_symbols (
  layer TEXT NOT NULL, id TEXT NOT NULL, path TEXT NOT NULL, name TEXT NOT NULL, qualname TEXT NOT NULL,
  kind TEXT NOT NULL, start_line INTEGER, end_line INTEGER, sig TEXT, sig_hash TEXT, body_hash TEXT, exported INTEGER,
  PRIMARY KEY (layer, id)
);
CREATE INDEX IF NOT EXISTS g_symbols_name ON g_symbols(name);
CREATE INDEX IF NOT EXISTS g_symbols_path ON g_symbols(layer, path);
CREATE TABLE IF NOT EXISTS g_refs (
  layer TEXT NOT NULL, path TEXT NOT NULL, name TEXT NOT NULL, line INTEGER, kind TEXT NOT NULL, recv TEXT, from_symbol TEXT
);
CREATE INDEX IF NOT EXISTS g_refs_name ON g_refs(name);
CREATE INDEX IF NOT EXISTS g_refs_path ON g_refs(layer, path);
CREATE TABLE IF NOT EXISTS g_imports (layer TEXT NOT NULL, path TEXT NOT NULL, source TEXT NOT NULL, names TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS g_imports_path ON g_imports(layer, path);
`;
