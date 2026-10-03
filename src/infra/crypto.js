// WebCrypto only: Workers has no bcrypt or argon2.

export const PBKDF2_ITERATIONS = 100000;
const DERIVED_BITS = 256;

export function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// For salts, session tokens and invite codes. Never Math.random.
export function randomHex(n) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(n)));
}

export async function hashPassword(password, saltHex, iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex), iterations },
    key,
    DERIVED_BITS,
  );
  return bytesToHex(new Uint8Array(bits));
}

// Constant-time over two strings; the length check comes first.
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sha256Hex(text) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}
