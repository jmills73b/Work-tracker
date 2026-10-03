-- Recurring tasks. recurrence: NULL, 'weekly:N', 'monthly:N' or 'after:N' (see
-- src/domain/recurrence.js). next_task_id: set once marking it done has created the next
-- occurrence, so done → reopened → done doesn't create a second.
ALTER TABLE tasks ADD COLUMN recurrence TEXT;
ALTER TABLE tasks ADD COLUMN next_task_id TEXT;
