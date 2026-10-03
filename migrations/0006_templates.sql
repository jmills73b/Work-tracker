-- Reusable task templates. A template's subtasks keep their dates as an offset in days
-- from the task's target date, so applying it to a new date lays them out again.
CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium',
  category TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_templates_user_id ON templates(user_id);

CREATE TABLE template_subtasks (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  position INTEGER NOT NULL,
  offset_days INTEGER
);
CREATE INDEX idx_template_subtasks_template_id ON template_subtasks(template_id, position);
