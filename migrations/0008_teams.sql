-- Teams replace free-text categories. Teams are shared across the app and managed by
-- admins; a task (or template) has at most one, and none by default.
CREATE TABLE teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO teams (name, position) VALUES ('Dev Ops', 0), ('RDH', 1), ('GDS', 2);

ALTER TABLE tasks ADD COLUMN team_id INTEGER REFERENCES teams(id);
ALTER TABLE templates ADD COLUMN team_id INTEGER REFERENCES teams(id);
CREATE INDEX idx_tasks_team_id ON tasks(team_id);

-- Carry over categories that already name a team, ignoring case and spaces
-- ("devops" -> Dev Ops). The category columns stay, unused: applied migrations are
-- never edited and nothing is lost.
UPDATE tasks SET team_id = (
  SELECT id FROM teams WHERE lower(replace(teams.name, ' ', '')) = lower(replace(tasks.category, ' ', ''))
) WHERE category != '';
UPDATE templates SET team_id = (
  SELECT id FROM teams WHERE lower(replace(teams.name, ' ', '')) = lower(replace(templates.category, ' ', ''))
) WHERE category != '';
