-- Accounts. The first user to register becomes admin and needs no invite code;
-- everyone after needs an unused code from invite_codes.
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- token_hash is SHA-256 of the cookie token. The raw token is never stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);

CREATE TABLE invite_codes (
  code TEXT PRIMARY KEY,
  created_by INTEGER NOT NULL REFERENCES users(id),
  used_by INTEGER REFERENCES users(id),
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Failed sign-in counters for lockout, keyed "ip:<addr>" or "email:<address>".
CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  window_start TEXT NOT NULL,
  locked_until TEXT
);

-- Tasks belong to one user; nobody sees anyone else's.
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'in_progress', 'blocked', 'done')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  target_date TEXT,
  category TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_tasks_user_id ON tasks(user_id, status);

-- Progress updates: free-text notes ('note') and automatic change-log lines ('change').
CREATE TABLE task_updates (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'change')),
  note TEXT NOT NULL,
  progress INTEGER,
  status TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_task_updates_task_id ON task_updates(task_id, created_at);
