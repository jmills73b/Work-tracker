-- A subtask can have its own target date (YYYY-MM-DD), independent of its task's.
ALTER TABLE subtasks ADD COLUMN target_date TEXT;
