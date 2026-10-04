-- Reminders at up to three times a day. digest_times: 'HH:MM' values, comma-separated and
-- sorted. Settings still on the old single default (07:45) move to the new default of
-- 07:30, 10:00 and 20:00; a time someone chose is kept. digest_time stays, unused.
-- last_digest_slot: 'YYYY-MM-DD HH:MM' of the last reminder handled, so each time is
-- sent at most once a day.
ALTER TABLE reminder_settings ADD COLUMN digest_times TEXT;
ALTER TABLE reminder_settings ADD COLUMN last_digest_slot TEXT;
UPDATE reminder_settings SET digest_times = CASE WHEN digest_time = '07:45' THEN '07:30,10:00,20:00' ELSE digest_time END;
