// Failed sign-in lockout, stored in D1.
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
export const USER_MAX_FAILURES = 5;
export const IP_MAX_FAILURES = 30;

// Returns the latest lock expiry (ms) across the given keys, or 0 if none are locked.
export async function lockedUntil(db, keys) {
  const { results } = await db
    .prepare(`SELECT locked_until FROM login_attempts WHERE key IN (${keys.map(() => '?').join(',')}) AND locked_until IS NOT NULL`)
    .bind(...keys)
    .all();
  const now = Date.now();
  return Math.max(0, ...results.map((r) => Date.parse(r.locked_until)).filter((t) => t > now));
}

export async function recordFailure(db, key, max) {
  const now = Date.now();
  const row = await db.prepare('SELECT failures, window_start FROM login_attempts WHERE key = ?').bind(key).first();
  const fresh = !row || Date.parse(row.window_start) + WINDOW_MS <= now;
  const failures = fresh ? 1 : row.failures + 1;
  const windowStart = fresh ? new Date(now).toISOString() : row.window_start;
  const locked = failures >= max ? new Date(now + LOCK_MS).toISOString() : null;
  await db
    .prepare(
      `INSERT INTO login_attempts (key, failures, window_start, locked_until) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET failures = excluded.failures, window_start = excluded.window_start,
         locked_until = excluded.locked_until`,
    )
    .bind(key, failures, windowStart, locked)
    .run();
}

export function clearFailures(db, key) {
  return db.prepare('DELETE FROM login_attempts WHERE key = ?').bind(key).run();
}
