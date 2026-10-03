import { randomHex, sha256Hex } from './crypto.js';

export const SESSION_DAYS = 30;
const COOKIE_NAME = 'session';
const MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

// Split on ';', then each pair at the FIRST '=' only, so a value containing '=' survives.
export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const name = part.slice(0, i).trim();
    if (name) out[name] = part.slice(i + 1).trim();
  }
  return out;
}

export const hashToken = (token) => sha256Hex(token);

export const sessionCookie = (token) =>
  `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`;
export const clearedCookie = () => `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

// Inserts a session and sweeps this user's expired ones in the same batch.
export async function createSession(env, userId, now = new Date()) {
  const token = randomHex(32);
  const expiresAt = new Date(now.getTime() + MAX_AGE * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?').bind(userId, now.toISOString()),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(await hashToken(token), userId, expiresAt),
  ]);
  return token;
}

// Returns { id, name, email, is_admin, tokenHash } or null. Expiry is checked here in
// JavaScript after the row is fetched, so an expired row is found and then rejected.
export async function getSessionUser(env, request, now = new Date()) {
  const token = parseCookies(request.headers.get('Cookie'))[COOKIE_NAME];
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(
    `SELECT s.expires_at, u.id, u.name, u.email, u.is_admin
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
  ).bind(tokenHash).first();
  if (!row || Date.parse(row.expires_at) <= now.getTime()) return null;
  return { id: row.id, name: row.name, email: row.email, is_admin: row.is_admin, tokenHash };
}

export async function destroySession(env, request) {
  const token = parseCookies(request.headers.get('Cookie'))[COOKIE_NAME];
  if (!token) return;
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hashToken(token)).run();
}
