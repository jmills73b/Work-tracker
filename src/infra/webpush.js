// Web Push with nothing but Web Crypto: VAPID signing (RFC 8292) and aes128gcm payload
// encryption (RFC 8291). Workers has no Node crypto, and a dependency would be heavier
// than these ~100 lines.

const enc = new TextEncoder();

export function b64urlEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text) {
  const b64 = String(text).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

// Only real push services, so a stored "subscription" can't make the Worker post to
// any URL someone chooses.
const PUSH_HOSTS = /^https:\/\/(?:[a-z0-9-]+\.)*(?:push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)(?::443)?\//i;

export function isPushEndpoint(url) {
  return typeof url === 'string' && url.length <= 1024 && PUSH_HOSTS.test(url);
}

// ---------- VAPID ----------

// The browser-facing key: 0x04 || x || y, base64url (what pushManager.subscribe wants).
export function vapidPublicKey(jwk) {
  return b64urlEncode(concat(new Uint8Array([4]), b64urlDecode(jwk.x), b64urlDecode(jwk.y)));
}

export async function vapidAuthorization(endpoint, jwk, subject, now = Date.now()) {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    // Apple refuses tokens that live too long; an hour is well inside every service's limit.
    exp: Math.floor(now / 1000) + 3600,
    sub: subject,
  })));
  const key = await crypto.subtle.importKey(
    'jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  );
  // Web Crypto's ECDSA signature is already r || s, the form JWS wants.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64urlEncode(sig)}, k=${vapidPublicKey(jwk)}`;
}

// ---------- aes128gcm payload ----------

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

// Encrypts one record for a subscription's keys. `serverKeys` and `salt` exist for tests;
// in use both are fresh for every message.
export async function encryptPayload(plaintext, { p256dh, auth }, { serverKeys, salt } = {}) {
  const uaPublic = b64urlDecode(p256dh);
  const authSecret = b64urlDecode(auth);
  const keys = serverKeys ?? await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, keys.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const saltBytes = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(saltBytes, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(saltBytes, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // One record: the plaintext then the 0x02 "last record" delimiter, no padding.
  const record = concat(typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(saltBytes, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

// Sends one notification. Resolves to the push service's status: 201 delivered,
// 404/410 the subscription is gone and should be forgotten.
export async function sendPush(subscription, payload, { vapidJwk, subject, ttl = 86400, fetchImpl = fetch } = {}) {
  if (!isPushEndpoint(subscription.endpoint)) throw new Error('Not a push service endpoint');
  const body = await encryptPayload(JSON.stringify(payload), subscription);
  const res = await fetchImpl(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(subscription.endpoint, vapidJwk, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: 'normal',
    },
    body,
  });
  return res.status;
}
