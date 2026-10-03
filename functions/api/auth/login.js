import { error, json, readJson } from '../../../lib/http.js';
import { DUMMY_HASH, PASSWORD_MAX, verifyPassword } from '../../../lib/password.js';
import { clearFailures, IP_MAX_FAILURES, lockedUntil, recordFailure, USER_MAX_FAILURES } from '../../../lib/ratelimit.js';
import { createSession, sessionCookie } from '../../../lib/session.js';

export async function onRequestPost({ request, env }) {
  if (!env.AUTH_PEPPER) return error(500, 'AUTH_PEPPER is not configured');
  const body = await readJson(request);
  const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!username || !password || username.length > 64 || password.length > PASSWORD_MAX) {
    return error(400, 'Enter your username and password');
  }

  const db = env.DB;
  const ipKey = `ip:${request.headers.get('CF-Connecting-IP') || 'unknown'}`;
  const userKey = `user:${username}`;
  const until = await lockedUntil(db, [ipKey, userKey]);
  if (until) {
    const minutes = Math.ceil((until - Date.now()) / 60000);
    return error(429, `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }

  const user = await db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').bind(username).first();
  const valid = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH, env.AUTH_PEPPER);
  if (!user || !valid) {
    await recordFailure(db, ipKey, IP_MAX_FAILURES);
    await recordFailure(db, userKey, USER_MAX_FAILURES);
    return error(401, 'Incorrect username or password');
  }

  await clearFailures(db, userKey);
  const token = await createSession(db, user.id);
  return json({ username: user.username }, 200, { 'Set-Cookie': sessionCookie(token) });
}
