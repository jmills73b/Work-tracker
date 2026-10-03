// Failed sign-in lockout, stored in D1.
export const WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;
export const EMAIL_MAX_FAILURES = 5;
export const IP_MAX_FAILURES = 30;

// Latest lock expiry (ms since epoch) across the keys, or 0 if none is locked.
export async function lockedUntil(env, keys, now = Date.now()) {
  const { results } = await env.DB.prepare(
    `SELECT locked_until FROM login_attempts WHERE key IN (${keys.map(() => '?').join(', ')}) AND locked_until IS NOT NULL`,
  ).bind(...keys).all();
  return Math.max(0, ...results.map((r) => Date.parse(r.locked_until)).filter((t) => t > now));
}

export async function recordFailure(env, key, max, now = Date.now()) {
  const row = await env.DB.prepare('SELECT failures, window_start FROM login_attempts WHERE key = ?').bind(key).first();
  const fresh = !row || Date.parse(row.window_start) + WINDOW_MS <= now;
  const failures = fresh ? 1 : row.failures + 1;
  const windowStart = fresh ? new Date(now).toISOString() : row.window_start;
  const locked = failures >= max ? new Date(now + LOCK_MS).toISOString() : null;
  await env.DB.prepare(
    `INSERT INTO login_attempts (key, failures, window_start, locked_until) VALUES (?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET failures = excluded.failures, window_start = excluded.window_start,
       locked_until = excluded.locked_until`,
  ).bind(key, failures, windowStart, locked).run();
}

export function clearFailures(env, key) {
  return env.DB.prepare('DELETE FROM login_attempts WHERE key = ?').bind(key).run();
}
