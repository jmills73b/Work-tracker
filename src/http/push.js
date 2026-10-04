import { DEFAULT_SETTINGS, validateSettings } from '../domain/reminders.js';
import * as repo from '../infra/remindersRepo.js';
import { isPushEndpoint, sendPush, vapidPublicKey } from '../infra/webpush.js';
import { json } from './respond.js';

// The VAPID key pair lives in one secret, a private JWK (x, y and d). Unset → reminders
// are reported as not set up rather than failing.
export function vapidJwk(env) {
  try {
    const jwk = JSON.parse(env.VAPID_PRIVATE_JWK || '');
    return jwk && jwk.x && jwk.y && jwk.d ? jwk : null;
  } catch {
    return null;
  }
}

export const vapidSubject = (env) => env.VAPID_SUBJECT || 'mailto:reminders@invalid';

export async function config(env, user) {
  const jwk = vapidJwk(env);
  const [settings, subs] = await Promise.all([repo.getSettings(env, user.id), repo.listSubscriptions(env, user.id)]);
  const { last_digest_slot: _last, ...visible } = settings;
  return json({ public_key: jwk ? vapidPublicKey(jwk) : null, settings: visible, devices: subs.length, endpoints: subs.map((s) => s.endpoint) });
}

export async function putSettings(request, env, user) {
  const current = await repo.getSettings(env, user.id);
  const { value, error } = validateSettings(await request.json(), current);
  if (error) return json({ error }, 400);
  await repo.saveSettings(env, user.id, value);
  const { last_digest_slot: _last, ...visible } = value;
  return json({ settings: visible });
}

const B64URL = /^[A-Za-z0-9_-]+$/;

// Body: the browser's PushSubscription.toJSON(), plus the device's time zone.
export async function subscribe(request, env, user) {
  const body = await request.json();
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (!isPushEndpoint(endpoint)) return json({ error: 'That is not a push service this app sends to' }, 400);
  if (typeof p256dh !== 'string' || !B64URL.test(p256dh) || p256dh.length !== 87) return json({ error: 'Invalid subscription keys' }, 400);
  if (typeof auth !== 'string' || !B64URL.test(auth) || auth.length !== 22) return json({ error: 'Invalid subscription keys' }, 400);

  await repo.saveSubscription(env, user.id, { endpoint, p256dh, auth }, new Date().toISOString());
  // First device: create settings, in the device's own time zone when it sent one.
  const current = await repo.getSettings(env, user.id);
  const { value } = validateSettings(body?.time_zone ? { time_zone: body.time_zone } : {}, current);
  await repo.saveSettings(env, user.id, value ?? { ...DEFAULT_SETTINGS, ...current });
  return json({ ok: true }, 201);
}

export async function unsubscribe(request, env, user) {
  const body = await request.json();
  await repo.deleteSubscription(env, user.id, String(body?.endpoint || ''));
  return json({ ok: true });
}

// Sends to every device of this user; forgets devices the push service says are gone.
export async function deliver(env, userId, payload, { fetchImpl } = {}) {
  const jwk = vapidJwk(env);
  if (!jwk) return { sent: 0, failed: 0, notConfigured: true };
  const subs = await repo.listSubscriptions(env, userId);
  let sent = 0;
  let failed = 0;
  for (const sub of subs) {
    try {
      const status = await sendPush(sub, payload, { vapidJwk: jwk, subject: vapidSubject(env), fetchImpl });
      if (status >= 200 && status < 300) {
        sent += 1;
        await repo.markDelivered(env, sub.id, new Date().toISOString());
      } else {
        failed += 1;
        if (status === 404 || status === 410) await repo.forgetSubscription(env, sub.id);
        else console.warn('push failed', status, new URL(sub.endpoint).host);
      }
    } catch (e) {
      failed += 1;
      console.error('push error', e);
    }
  }
  return { sent, failed };
}

export async function test(env, user) {
  const result = await deliver(env, user.id, {
    title: 'Reminders are working',
    body: 'This is a test. Your morning digest will arrive like this.',
    tag: 'test',
    url: '/',
  });
  if (result.notConfigured) return json({ error: 'Reminders are not set up on the server yet' }, 503);
  if (!result.sent && !result.failed) return json({ error: 'No devices have reminders turned on' }, 400);
  return json(result);
}
