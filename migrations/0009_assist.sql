-- Task assistant: calls per user in the current one-hour window, to cap API spend.
CREATE TABLE assist_usage (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL
);
