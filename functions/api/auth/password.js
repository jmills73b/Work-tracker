import { error, json, readJson } from '../../../lib/http.js';
import { checkNewPassword, hashPassword, verifyPassword } from '../../../lib/password.js';
import { lockedUntil, recordFailure, USER_MAX_FAILURES, clearFailures } from '../../../lib/ratelimit.js';

// Change password: requires the current one, then signs out every other session.
export async function onRequestPost({ request, env, data }) {
  const body = await readJson(request);
  const current = typeof body?.current === 'string' ? body.current : '';
  const next = typeof body?.next === 'string' ? body.next : '';
  const problem = checkNewPassword(next);
  if (problem) return error(400, problem);
  if (next === current) return error(400, 'New password must be different from the current one');

  const db = env.DB;
  const userKey = `user:${data.username}`;
  if (await lockedUntil(db, [userKey])) return error(429, 'Too many failed attempts. Try again later.');

  const user = await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(data.user).first();
  if (!user || !(await verifyPassword(current, user.password_hash, env.AUTH_PEPPER))) {
    await recordFailure(db, userKey, USER_MAX_FAILURES);
    return error(400, 'Current password is incorrect');
  }
  await clearFailures(db, userKey);

  const now = new Date().toISOString();
  await db.batch([
    db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?')
      .bind(await hashPassword(next, env.AUTH_PEPPER), now, data.user),
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?').bind(data.user, data.sessionHash),
  ]);
  return json({ ok: true });
}
