// Server-side sessions. The browser holds a random token in an HttpOnly cookie; the
// database only stores its SHA-256 hash, so a database leak can't be replayed as a login.

const COOKIE = '__Host-wt_session';
const MAX_AGE_S = 30 * 24 * 3600; // absolute lifetime
const IDLE_MS = 7 * 24 * 3600 * 1000; // signed out after a week of inactivity
const TOUCH_MS = 3600 * 1000; // refresh last_seen_at at most hourly

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readToken(request) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return null;
}

export const sessionCookie = (token) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE_S}`;
export const clearedCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export async function createSession(db, userId) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const now = new Date();
  await db
    .prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, now.toISOString(), new Date(now.getTime() + MAX_AGE_S * 1000).toISOString(), now.toISOString())
    .run();
  return token;
}

// Returns { userId, username, sessionHash } or null.
export async function getSession(db, request) {
  const token = readToken(request);
  if (!token || token.length > 100) return null;
  const idHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT s.user_id, s.expires_at, s.last_seen_at, u.username
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`,
    )
    .bind(idHash)
    .first();
  if (!row) return null;

  const now = Date.now();
  if (Date.parse(row.expires_at) <= now || Date.parse(row.last_seen_at) + IDLE_MS <= now) {
    await db.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(idHash).run();
    return null;
  }
  if (Date.parse(row.last_seen_at) + TOUCH_MS <= now) {
    await db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?').bind(new Date(now).toISOString(), idHash).run();
  }
  return { userId: row.user_id, username: row.username, sessionHash: idHash };
}

export function deleteSession(db, idHash) {
  return db.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(idHash).run();
}
