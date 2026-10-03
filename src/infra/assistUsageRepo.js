import { nextUsage } from '../domain/assist.js';

// Counts this call against the user's hourly allowance. Returns nextUsage's verdict.
export async function take(env, userId, now = Date.now()) {
  const row = await env.DB.prepare('SELECT window_start, count FROM assist_usage WHERE user_id = ?').bind(userId).first();
  const verdict = nextUsage(row, now);
  if (verdict.allowed) {
    await env.DB.prepare(
      `INSERT INTO assist_usage (user_id, window_start, count) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET window_start = excluded.window_start, count = excluded.count`,
    ).bind(userId, verdict.row.window_start, verdict.row.count).run();
  }
  return verdict;
}
