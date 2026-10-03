import { DEFAULT_SETTINGS } from '../domain/reminders.js';

const fromRow = (r) => ({
  enabled: Boolean(r.enabled),
  digest_time: r.digest_time,
  time_zone: r.time_zone,
  include_tomorrow: Boolean(r.include_tomorrow),
  last_digest_date: r.last_digest_date ?? null,
});

export async function getSettings(env, userId) {
  const row = await env.DB.prepare(
    'SELECT enabled, digest_time, time_zone, include_tomorrow, last_digest_date FROM reminder_settings WHERE user_id = ?',
  ).bind(userId).first();
  return row ? fromRow(row) : { ...DEFAULT_SETTINGS, last_digest_date: null };
}

export function saveSettings(env, userId, s) {
  return env.DB.prepare(
    `INSERT INTO reminder_settings (user_id, enabled, digest_time, time_zone, include_tomorrow)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET enabled = excluded.enabled, digest_time = excluded.digest_time,
       time_zone = excluded.time_zone, include_tomorrow = excluded.include_tomorrow`,
  ).bind(userId, s.enabled ? 1 : 0, s.digest_time, s.time_zone, s.include_tomorrow ? 1 : 0).run();
}

export function markDigestSent(env, userId, localDate) {
  return env.DB.prepare('UPDATE reminder_settings SET last_digest_date = ? WHERE user_id = ?').bind(localDate, userId).run();
}

export async function listSubscriptions(env, userId) {
  const { results } = await env.DB.prepare(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? ORDER BY created_at',
  ).bind(userId).all();
  return results;
}

// One row per device; a device that subscribes again (or under another account) takes the row over.
export function saveSubscription(env, userId, { endpoint, p256dh, auth }, at) {
  return env.DB.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
  ).bind(crypto.randomUUID(), userId, endpoint, p256dh, auth, at).run();
}

export function deleteSubscription(env, userId, endpoint) {
  return env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').bind(userId, endpoint).run();
}

export function forgetSubscription(env, id) {
  return env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(id).run();
}

export function markDelivered(env, id, at) {
  return env.DB.prepare('UPDATE push_subscriptions SET last_success_at = ? WHERE id = ?').bind(at, id).run();
}

// Everyone with reminders on and at least one device to send to.
export async function usersToRemind(env) {
  const { results } = await env.DB.prepare(
    `SELECT s.user_id, s.enabled, s.digest_time, s.time_zone, s.include_tomorrow, s.last_digest_date
     FROM reminder_settings s
     WHERE s.enabled = 1 AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = s.user_id)`,
  ).all();
  return results.map((r) => ({ userId: r.user_id, settings: fromRow(r) }));
}
