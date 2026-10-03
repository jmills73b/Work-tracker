-- Web push: one row per device that turned reminders on, and one settings row per user.
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_success_at TEXT
);
CREATE INDEX idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- digest_time is HH:MM in time_zone; last_digest_date is that zone's YYYY-MM-DD of the
-- last morning handled, so a digest goes out at most once a day.
CREATE TABLE reminder_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  enabled INTEGER NOT NULL DEFAULT 1,
  digest_time TEXT NOT NULL DEFAULT '07:45',
  time_zone TEXT NOT NULL DEFAULT 'Europe/London',
  include_tomorrow INTEGER NOT NULL DEFAULT 1,
  last_digest_date TEXT
);
