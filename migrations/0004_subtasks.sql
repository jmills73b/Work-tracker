-- Subtasks: a checklist under each task, in the order they were added.
-- Percentage progress is retired in favour of these; tasks.progress and
-- task_updates.progress stay (applied migrations are never edited) but nothing reads them.
CREATE TABLE subtasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_subtasks_task_id ON subtasks(task_id, position);
