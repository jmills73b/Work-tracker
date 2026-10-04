-- The simpler model (see public/shared/rules.js). The stored codes keep the old CHECK
-- constraints: 'todo' now means Open and 'blocked' means Waiting; 'in_progress' folds
-- into Open. Priority becomes a High flag: Urgent joins High, Low joins normal ('medium').
UPDATE tasks SET status = 'todo' WHERE status = 'in_progress';
UPDATE task_updates SET status = 'todo' WHERE status = 'in_progress';
UPDATE tasks SET priority = 'high' WHERE priority = 'urgent';
UPDATE tasks SET priority = 'medium' WHERE priority = 'low';

-- Waiting's "chase on" date, and the day a task is planned for (the daily plan).
ALTER TABLE tasks ADD COLUMN waiting_until TEXT;
ALTER TABLE tasks ADD COLUMN planned_on TEXT;

-- Reminder settings lose their master switch and the "High tomorrow" switch: on per
-- device, High tasks due tomorrow always included in daytime reminders.
UPDATE reminder_settings SET enabled = 1, include_tomorrow = 1;

-- Templates are retired in favour of Duplicate and Repeats. Their tables stay, unused,
-- so nothing saved is lost.
