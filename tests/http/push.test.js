import { createECDH, randomBytes } from 'node:crypto';
import ece from 'http_ece';
import { describe, expect, it, vi } from 'vitest';
import { deliver, subscribe } from '../../src/http/push.js';
import { b64urlEncode } from '../../src/infra/webpush.js';
import { runDigests } from '../../src/reminders.js';
import { fakeDb, jsonRequest } from '../helpers/fakeDb.js';

const USER = { id: 7 };

function device(endpoint = 'https://web.push.apple.com/abc') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, sub: { id: `sub-${endpoint.slice(-3)}`, endpoint, p256dh: b64urlEncode(ecdh.getPublicKey()), auth: b64urlEncode(auth) } };
}

async function vapidEnv(db) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  return { DB: db, VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)), VAPID_SUBJECT: 'https://tracker.test' };
}

describe('subscribe', () => {
  const keys = () => ({ p256dh: device().sub.p256dh, auth: device().sub.auth });

  it('refuses an endpoint that is not a known push service, before storing anything', async () => {
    const db = fakeDb();
    const res = await subscribe(jsonRequest('/api/push/subscriptions', { endpoint: 'https://evil.test/hook', keys: keys() }), { DB: db }, USER);
    expect(res.status).toBe(400);
    expect(db.calls).toEqual([]);
  });

  it('refuses keys of the wrong size', async () => {
    const res = await subscribe(jsonRequest('/api/push/subscriptions', { endpoint: 'https://web.push.apple.com/x', keys: { p256dh: 'abc', auth: 'def' } }), { DB: fakeDb() }, USER);
    expect([res.status, (await res.json()).error]).toEqual([400, 'Invalid subscription keys']);
  });

  it("stores the device and saves settings in the device's time zone", async () => {
    const db = fakeDb();
    const res = await subscribe(jsonRequest('/api/push/subscriptions', { endpoint: 'https://web.push.apple.com/x', keys: keys(), time_zone: 'America/New_York' }), { DB: db }, USER);
    expect(res.status).toBe(201);
    const settings = db.calls.find((c) => c.sql?.startsWith('INSERT INTO reminder_settings'));
    expect(settings.params).toEqual([7, 1, '07:30', '07:30,10:00,20:00', 'America/New_York', 1]);
  });
});

describe('deliver', () => {
  it('forgets a device the push service reports as gone (410), and keeps the others', async () => {
    const gone = device('https://web.push.apple.com/old');
    const live = device('https://fcm.googleapis.com/fcm/send/new');
    const db = fakeDb({ all: [['FROM push_subscriptions WHERE user_id', [gone.sub, live.sub]]] });
    const fetchImpl = vi.fn(async (url) => new Response(null, { status: url.includes('/old') ? 410 : 201 }));
    expect(await deliver(await vapidEnv(db), 7, { title: 'x' }, { fetchImpl })).toEqual({ sent: 1, failed: 1 });
    const deletes = db.calls.filter((c) => c.sql?.startsWith('DELETE FROM push_subscriptions WHERE id'));
    expect(deletes.map((c) => c.params)).toEqual([[gone.sub.id]]);
  });

  it('keeps a device after a temporary failure such as a 500', async () => {
    const d = device();
    const db = fakeDb({ all: [['FROM push_subscriptions WHERE user_id', [d.sub]]] });
    await deliver(await vapidEnv(db), 7, { title: 'x' }, { fetchImpl: async () => new Response(null, { status: 500 }) });
    expect(db.calls.some((c) => c.sql?.startsWith('DELETE'))).toBe(false);
  });

  it('reports "not configured" instead of failing when the VAPID secret is missing', async () => {
    expect(await deliver({ DB: fakeDb() }, 7, {})).toEqual({ sent: 0, failed: 0, notConfigured: true });
  });
});

describe('runDigests', () => {
  // 07:50 in London on Saturday 3 October 2026: the 07:30 reminder is due.
  const NOW = new Date('2026-10-03T06:50:00Z');
  const settingsRow = (over = {}) => ({ user_id: 7, enabled: 1, digest_times: '07:30,10:00,20:00', time_zone: 'Europe/London', include_tomorrow: 1, last_digest_slot: null, ...over });

  function setup({ tasks, settings = settingsRow() }) {
    const d = device();
    const db = fakeDb({
      all: [
        ['FROM reminder_settings s', [settings]],
        ['FROM tasks t WHERE t.user_id', tasks],
        ['FROM subtasks WHERE user_id', []],
        ['FROM push_subscriptions WHERE user_id', [d.sub]],
      ],
    });
    return { d, db };
  }

  it('sends the digest the device can read, then marks the morning as done', async () => {
    const { d, db } = setup({ tasks: [{ id: 't1', title: 'Board deck', status: 'todo', priority: 'high', target_date: '2026-10-03' }] });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    expect(await runDigests(await vapidEnv(db), NOW, { fetchImpl })).toEqual([{ userId: 7, sent: 1, failed: 0 }]);
    const body = fetchImpl.mock.calls[0][1].body;
    const payload = JSON.parse(ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: d.ecdh, authSecret: d.auth }).toString());
    expect(payload).toMatchObject({ title: '1 due today', body: '• Board deck, today' });
    const mark = db.calls.find((c) => c.sql?.startsWith('UPDATE reminder_settings SET last_digest_slot'));
    expect(mark.params).toEqual(['2026-10-03 07:30', 7]);
  });

  it('stays quiet on a day with nothing due, but still marks the morning so it is not rechecked', async () => {
    const { db } = setup({ tasks: [] });
    const fetchImpl = vi.fn();
    expect(await runDigests(await vapidEnv(db), NOW, { fetchImpl })).toEqual([{ userId: 7, sent: 0, failed: 0, quiet: true }]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.calls.some((c) => c.sql?.startsWith('UPDATE reminder_settings SET last_digest_slot'))).toBe(true);
  });

  it('does nothing for a user already sent today', async () => {
    const { db } = setup({ tasks: [{ id: 't1', title: 'x', status: 'todo', priority: 'high', target_date: '2026-10-03' }], settings: settingsRow({ last_digest_slot: '2026-10-03 07:30' }) });
    const fetchImpl = vi.fn();
    expect(await runDigests(await vapidEnv(db), NOW, { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
