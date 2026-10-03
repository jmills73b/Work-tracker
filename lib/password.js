// Password hashing: PBKDF2-SHA256 over HMAC(pepper, password).
// The pepper is a Pages secret kept outside the database, so a leaked database alone
// can't be brute-forced offline. Uses only Web Crypto, so it runs in Workers and Node.

const ALG = 'pbkdf2-sha256';
const ITERATIONS = 10000; // kept modest to fit the Workers free-plan CPU budget; the pepper carries the weight
const enc = new TextEncoder();

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;
// Same cost as a real hash, so unknown usernames take as long to reject as wrong passwords.
export const DUMMY_HASH = `${ALG}$${ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`;

const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password, pepper, salt, iterations) {
  const hmacKey = await crypto.subtle.importKey('raw', enc.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const peppered = await crypto.subtle.sign('HMAC', hmacKey, enc.encode(password));
  const baseKey = await crypto.subtle.importKey('raw', peppered, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, baseKey, 256));
}

export async function hashPassword(password, pepper) {
  if (!pepper) throw new Error('AUTH_PEPPER is not configured');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, pepper, salt, ITERATIONS);
  return `${ALG}$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password, stored, pepper) {
  if (!pepper) throw new Error('AUTH_PEPPER is not configured');
  const [alg, iterations, salt, hash] = String(stored).split('$');
  if (alg !== ALG || !salt || !hash) return false;
  const actual = await derive(password, pepper, fromB64(salt), Number(iterations));
  const expected = fromB64(hash);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

export function checkNewPassword(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters`;
  if (password.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters`;
  return null;
}
