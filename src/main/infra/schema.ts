// SQLite 建表 DDL，对应 TECH_DESIGN.md §3。应用启动时执行（IF NOT EXISTS 幂等）。

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scans (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  status        TEXT NOT NULL,
  total_files   INTEGER DEFAULT 0,
  safe_bytes    INTEGER DEFAULT 0,
  migratable_bytes INTEGER DEFAULT 0,
  highrisk_bytes   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scan_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id      INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  path         TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  category     TEXT NOT NULL,
  risk_level   TEXT NOT NULL,
  default_action TEXT NOT NULL,
  matched_rule TEXT,
  mtime        TEXT,
  atime        TEXT,
  ext          TEXT,
  explain_tmpl TEXT
);
CREATE INDEX IF NOT EXISTS idx_scan_items_scan ON scan_items(scan_id);
CREATE INDEX IF NOT EXISTS idx_scan_items_cat  ON scan_items(category);

CREATE TABLE IF NOT EXISTS operations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL,
  op_type      TEXT NOT NULL,
  path         TEXT,
  dest_path    TEXT,
  size_bytes   INTEGER,
  category     TEXT,
  risk_level   TEXT,
  action       TEXT,
  status       TEXT NOT NULL,
  error_code   TEXT,
  error_detail TEXT,
  user_confirm TEXT,
  ai_summary   TEXT,
  batch_id     TEXT
);
CREATE INDEX IF NOT EXISTS idx_ops_ts    ON operations(ts);
CREATE INDEX IF NOT EXISTS idx_ops_path  ON operations(path);
CREATE INDEX IF NOT EXISTS idx_ops_type  ON operations(op_type);
CREATE INDEX IF NOT EXISTS idx_ops_error ON operations(error_code);

CREATE TABLE IF NOT EXISTS cold_items (
  id            TEXT PRIMARY KEY,
  original_path TEXT NOT NULL,
  cold_path     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  category      TEXT,
  risk_level    TEXT,
  mtime         TEXT,
  migrated_at   TEXT NOT NULL,
  reason        TEXT,
  explain       TEXT,
  checksum      TEXT,
  cold_period_days INTEGER,
  expires_at    TEXT,
  state         TEXT NOT NULL,
  restorable    INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS watch_items (
  id          TEXT PRIMARY KEY,
  path        TEXT NOT NULL,
  size_bytes  INTEGER,
  category    TEXT,
  reason      TEXT,
  added_at    TEXT NOT NULL,
  period_days INTEGER NOT NULL,
  remind_at   TEXT NOT NULL,
  last_seen_mtime TEXT,
  status      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_rules (
  id          TEXT PRIMARY KEY,
  json        TEXT NOT NULL,
  source      TEXT NOT NULL,
  enabled     INTEGER DEFAULT 1,
  created_at  TEXT NOT NULL
);
`
