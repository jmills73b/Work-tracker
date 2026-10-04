import { randomHex } from './crypto.js';

const PUBLIC_COLUMNS = 'id, name, email, is_admin';

export function findByEmail(env, email) {
  return env.DB.prepare(`SELECT ${PUBLIC_COLUMNS}, password_hash, password_salt FROM users WHERE email = ?`)
    .bind(email).first();
}

export function findById(env, id) {
  return env.DB.prepare(`SELECT ${PUBLIC_COLUMNS}, password_hash, password_salt FROM users WHERE id = ?`)
    .bind(id).first();
}

export async function countAll(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  return row ? row.n : 0;
}

export function findUnusedInviteCode(env, code) {
  return env.DB.prepare('SELECT code FROM invite_codes WHERE code = ? AND used_by IS NULL').bind(code).first();
}

// Creates the user and, for invitees, marks the code used, in one atomic batch.
// The insert itself re-checks the gate (empty table for the first user, unused code
// for everyone else), so two racing registrations can't both succeed.
// Returns the public user row, or null if the gate closed in the meantime.
export async function create(env, { name, email, passwordHash, passwordSalt, inviteCode }) {
  const db = env.DB;
  const stmts = inviteCode
    ? [
      db.prepare(
        `INSERT INTO users (name, email, password_hash, password_salt, is_admin)
         SELECT ?, ?, ?, ?, 0 WHERE EXISTS (SELECT 1 FROM invite_codes WHERE code = ? AND used_by IS NULL)`,
      ).bind(name, email, passwordHash, passwordSalt, inviteCode),
      db.prepare(
        `UPDATE invite_codes SET used_by = (SELECT id FROM users WHERE email = ?), used_at = datetime('now')
         WHERE code = ? AND used_by IS NULL AND EXISTS (SELECT 1 FROM users WHERE email = ?)`,
      ).bind(email, inviteCode, email),
    ]
    : [
      db.prepare(
        `INSERT INTO users (name, email, password_hash, password_salt, is_admin)
         SELECT ?, ?, ?, ?, 1 WHERE NOT EXISTS (SELECT 1 FROM users)`,
      ).bind(name, email, passwordHash, passwordSalt),
      // The starter teams wait unowned until the first account exists (migrations/0014).
      db.prepare('UPDATE teams SET user_id = (SELECT id FROM users WHERE email = ?) WHERE user_id IS NULL').bind(email),
    ];
  const [inserted] = await db.batch(stmts);
  if (!inserted.meta.changes) return null;
  return db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE email = ?`).bind(email).first();
}

// Also signs out every other session for this user.
export function updatePassword(env, userId, { passwordHash, passwordSalt, keepTokenHash }) {
  return env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?')
      .bind(passwordHash, passwordSalt, userId),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(userId, keepTokenHash),
  ]);
}

// Shown to people as XXXX-XXXX-XXXX.
export function newInviteCode() {
  return randomHex(6).toUpperCase().match(/.{4}/g).join('-');
}

export async function createInviteCode(env, createdBy) {
  const code = newInviteCode();
  await env.DB.prepare('INSERT INTO invite_codes (code, created_by) VALUES (?, ?)').bind(code, createdBy).run();
  return code;
}

export async function listInviteCodes(env, createdBy) {
  const { results } = await env.DB.prepare(
    `SELECT i.code, i.created_at, i.used_at, u.name AS used_by_name
     FROM invite_codes i LEFT JOIN users u ON u.id = i.used_by
     WHERE i.created_by = ? ORDER BY i.created_at DESC`,
  ).bind(createdBy).all();
  return results;
}
