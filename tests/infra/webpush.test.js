import { createECDH, randomBytes } from 'node:crypto';
import ece from 'http_ece';
import { describe, expect, it, vi } from 'vitest';
import {
  b64urlDecode, b64urlEncode, encryptPayload, isPushEndpoint, sendPush, vapidAuthorization, vapidPublicKey,
} from '../../src/infra/webpush.js';

// A browser's subscription keys, made the way the browser makes them.
function fakeBrowser() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, keys: { p256dh: b64urlEncode(ecdh.getPublicKey()), auth: b64urlEncode(auth) }, auth };
}

async function vapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { jwk: await crypto.subtle.exportKey('jwk', pair.privateKey), publicKey: pair.publicKey };
}

describe('encryptPayload', () => {
  it('produces a body the reference http_ece library decrypts with the browser keys', async () => {
    // If this fails, Apple and Google would receive messages they can't read, and drop them.
    const browser = fakeBrowser();
    const body = await encryptPayload('{"title":"2 due today"}', browser.keys);
    const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: browser.ecdh, authSecret: browser.auth });
    expect(plain.toString()).toBe('{"title":"2 due today"}');
  });

  it('writes the aes128gcm header: salt, a 4096 record size and the server key', async () => {
    const body = await encryptPayload('x', fakeBrowser().keys);
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
    expect(body[20]).toBe(65);
    expect(body[21]).toBe(4); // an uncompressed P-256 point
  });

  it('uses a fresh key and salt for every message', async () => {
    const keys = fakeBrowser().keys;
    const [a, b] = await Promise.all([encryptPayload('same', keys), encryptPayload('same', keys)]);
    expect(b64urlEncode(a)).not.toBe(b64urlEncode(b));
  });

  it('fails to decrypt with the wrong auth secret, so a leaked endpoint alone reads nothing', async () => {
    const browser = fakeBrowser();
    const body = await encryptPayload('secret', browser.keys);
    expect(() => ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: browser.ecdh, authSecret: randomBytes(16) })).toThrow();
  });
});

describe('vapidAuthorization', () => {
  it('signs a JWT for the push service origin that verifies with the public key it advertises', async () => {
    const { jwk, publicKey } = await vapidKeys();
    const now = Date.UTC(2026, 9, 3, 12);
    const header = await vapidAuthorization('https://web.push.apple.com/QGuQyavXu/abc', jwk, 'https://tracker.example', now);
    const [, token, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
    const [h, c, sig] = token.split('.');
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(c)))).toEqual({
      aud: 'https://web.push.apple.com', exp: now / 1000 + 3600, sub: 'https://tracker.example',
    });
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, b64urlDecode(sig), new TextEncoder().encode(`${h}.${c}`));
    expect(valid).toBe(true);
    expect(k).toBe(vapidPublicKey(jwk));
    expect(b64urlDecode(k).length).toBe(65);
  });
});

describe('isPushEndpoint', () => {
  it('accepts the push services of Apple, Google, Mozilla and Microsoft', () => {
    for (const url of [
      'https://web.push.apple.com/QGuQyavXu',
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://wns2-db5p.notify.windows.com/w/?token=abc',
    ]) expect(isPushEndpoint(url)).toBe(true);
  });

  it('refuses anything else, so a stored subscription cannot aim the Worker at another site', () => {
    for (const url of [
      'http://web.push.apple.com/x', // not https
      'https://web.push.apple.com.evil.test/x',
      'https://evil.test/push.apple.com/',
      'https://localhost/x',
      null,
    ]) expect(isPushEndpoint(url)).toBe(false);
  });
});

describe('sendPush', () => {
  it('posts the encrypted body with the headers push services require', async () => {
    const { jwk } = await vapidKeys();
    const browser = fakeBrowser();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    const status = await sendPush({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', ...browser.keys }, { title: 'Hi' },
      { vapidJwk: jwk, subject: 'https://tracker.example', fetchImpl });
    expect(status).toBe(201);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://fcm.googleapis.com/fcm/send/abc');
    expect(init.headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', TTL: '86400' });
    expect(init.headers.Authorization).toMatch(/^vapid t=/);
    const plain = ece.decrypt(Buffer.from(init.body), { version: 'aes128gcm', privateKey: browser.ecdh, authSecret: browser.auth });
    expect(JSON.parse(plain.toString())).toEqual({ title: 'Hi' });
  });

  it('refuses to send to a non-push endpoint without making a request', async () => {
    const fetchImpl = vi.fn();
    await expect(sendPush({ endpoint: 'https://evil.test/', p256dh: 'x', auth: 'y' }, {}, { fetchImpl })).rejects.toThrow('Not a push service endpoint');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
