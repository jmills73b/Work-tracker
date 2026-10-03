-- Tasks: one row per task, scoped to the signed-in user's email.
CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY,
  owner        TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'todo'
               CHECK (status IN ('todo', 'in_progress', 'blocked', 'done')),
  priority     TEXT NOT NULL DEFAULT 'medium'
               CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  progress     INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  target_date  TEXT,
  category     TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks (owner, status);

-- Progress updates: free-text notes ('note') plus automatic change log entries ('change').
CREATE TABLE IF NOT EXISTS task_updates (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  owner      TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'change')),
  note       TEXT NOT NULL,
  progress   INTEGER,
  status     TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_updates_task ON task_updates (task_id, created_at);
