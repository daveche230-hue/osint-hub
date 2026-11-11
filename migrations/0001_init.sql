CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY,
  credits    INTEGER NOT NULL DEFAULT 0,
  day        TEXT NOT NULL DEFAULT '',
  owned      TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS jobs (
  id     TEXT PRIMARY KEY,
  uid    INTEGER NOT NULL,
  kind   TEXT NOT NULL,
  value  TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  cost   INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  err    TEXT,
  ts     INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_jobs_uid ON jobs(uid, ts DESC);

CREATE TABLE IF NOT EXISTS ledger (
  id  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid INTEGER NOT NULL,
  d   INTEGER NOT NULL,
  why TEXT NOT NULL,
  ts  INTEGER NOT NULL DEFAULT (unixepoch())
);
