import { randomHex } from './crypto.js';

export const CHALLENGE_MS = 5 * 60 * 1000;

// Stores a ceremony's challenge and sweeps expired ones in the same batch.
export async function saveChallenge(env, { kind, userId = null, challenge }, now = Date.now()) {
  const id = randomHex(16);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM webauthn_challenges WHERE expires_at <= ?').bind(new Date(now).toISOString()),
    env.DB.prepare('INSERT INTO webauthn_challenges (id, kind, user_id, challenge, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, kind, userId, challenge, new Date(now + CHALLENGE_MS).toISOString()),
  ]);
  return id;
}

// Single use: deleted as it is read, so a replayed response finds nothing. Returns
// { challenge, user_id } or null when missing, of the wrong kind or expired.
export async function takeChallenge(env, id, kind, now = Date.now()) {
  if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id)) return null;
  const row = await env.DB.prepare(
    'DELETE FROM webauthn_challenges WHERE id = ? AND kind = ? RETURNING challenge, user_id, expires_at',
  ).bind(id, kind).first();
  if (!row || Date.parse(row.expires_at) <= now) return null;
  return { challenge: row.challenge, user_id: row.user_id };
}

export function findPasskey(env, id) {
  return env.DB.prepare('SELECT id, user_id, public_key, counter, transports FROM passkeys WHERE id = ?').bind(id).first();
}

export async function listPasskeys(env, userId) {
  const { results } = await env.DB.prepare(
    'SELECT id, name, transports, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at',
  ).bind(userId).all();
  return results;
}

export function addPasskey(env, userId, { id, publicKey, counter, transports, name }, at) {
  return env.DB.prepare(
    `INSERT INTO passkeys (id, user_id, public_key, counter, transports, name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, userId, publicKey, counter, transports, name, at).run();
}

export function markUsed(env, id, counter, at) {
  return env.DB.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?').bind(counter, at, id).run();
}

export async function deletePasskey(env, userId, id) {
  const { meta } = await env.DB.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return meta.changes > 0;
}
