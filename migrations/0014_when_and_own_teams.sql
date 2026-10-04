-- One "when" per task. planned_on is now the day you'll act on a task, or, while it is
-- Waiting, the day to chase it. target_date is an optional deadline that rescheduling
-- never moves. Chase dates move across; waiting_until stays in the schema, unused.
UPDATE tasks SET planned_on = waiting_until
WHERE status = 'blocked' AND waiting_until IS NOT NULL AND planned_on IS NULL;

-- Teams become each person's own labels, so renaming or removing one can never touch
-- anyone else's tasks. teams.name was UNIQUE across everyone, a column constraint that
-- can't be dropped, so the table is rebuilt. Tasks still pointing at the old table
-- would block dropping it, so their links are parked in a scratch table and restored.
CREATE TABLE teams_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL COLLATE NOCASE,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, name)
);

-- The existing teams go to the first account (the admin, and in practice the only one).
-- Before anyone registers they stay unowned; the first registration claims them.
INSERT INTO teams_new (id, user_id, name, position, created_at)
SELECT id, (SELECT MIN(id) FROM users), name, position, created_at FROM teams;

-- Anyone else with tasks on a team gets their own copy of it.
INSERT INTO teams_new (user_id, name, position, created_at)
SELECT DISTINCT t.user_id, tm.name, tm.position, tm.created_at
FROM tasks t JOIN teams tm ON tm.id = t.team_id
WHERE t.user_id != (SELECT MIN(id) FROM users);

-- Each task's team in the new table: the owner keeps the same id, others their copy.
CREATE TABLE task_team_links AS
SELECT t.id AS task_id, (
  SELECT n.id FROM teams_new n JOIN teams o ON o.name = n.name
  WHERE o.id = t.team_id AND n.user_id = t.user_id
) AS team_id
FROM tasks t WHERE t.team_id IS NOT NULL;

UPDATE tasks SET team_id = NULL WHERE team_id IS NOT NULL;
-- Templates are retired; they simply lose their label.
UPDATE templates SET team_id = NULL WHERE team_id IS NOT NULL;

DROP TABLE teams;
ALTER TABLE teams_new RENAME TO teams;
CREATE INDEX idx_teams_user_id ON teams(user_id);

UPDATE tasks SET team_id = (SELECT l.team_id FROM task_team_links l WHERE l.task_id = tasks.id)
WHERE id IN (SELECT task_id FROM task_team_links);
DROP TABLE task_team_links;
