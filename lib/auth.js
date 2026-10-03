// Verifies the Cloudflare Access JWT on every API request. Cloudflare Access already
// blocks unauthenticated visitors at the edge; this check means the API also fails
// closed if Access is ever removed or misconfigured (e.g. on a *.pages.dev URL).

export class AuthError extends Error {}
export class ConfigError extends Error {}

const CERT_TTL_MS = 60 * 60 * 1000;
const TEAM_DOMAIN_RE = /^[a-z0-9-]+\.cloudflareaccess\.com$/i;
let certCache = { team: null, keys: [], expires: 0 };

export async function authenticate(request, env) {
  // Local development only: `wrangler pages dev` with DEV_AUTH_EMAIL in .dev.vars.
  const { hostname } = new URL(request.url);
  if (env.DEV_AUTH_EMAIL && (hostname === 'localhost' || hostname === '127.0.0.1')) {
    return env.DEV_AUTH_EMAIL.toLowerCase();
  }

  const team = String(env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const aud = String(env.ACCESS_AUD || '').trim();
  if (!TEAM_DOMAIN_RE.test(team) || !aud) {
    throw new ConfigError('Cloudflare Access is not configured (ACCESS_TEAM_DOMAIN / ACCESS_AUD).');
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new AuthError('Missing access token');

  const payload = await verifyJwt(token, team, aud);
  const email = String(payload.email || '').toLowerCase();
  if (!email) throw new AuthError('Token has no email');

  const allowed = String(env.ALLOWED_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length && !allowed.includes(email)) throw new AuthError('Email not allowed');

  return email;
}

async function verifyJwt(token, team, aud) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('Malformed token');
  const [rawHeader, rawPayload, rawSig] = parts;

  let header, payload;
  try {
    header = JSON.parse(decodeText(rawHeader));
    payload = JSON.parse(decodeText(rawPayload));
  } catch {
    throw new AuthError('Malformed token');
  }
  if (header.alg !== 'RS256') throw new AuthError('Unexpected token algorithm');

  let jwk = (await getKeys(team)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await getKeys(team, true)).find((k) => k.kid === header.kid); // key rotation
  if (!jwk) throw new AuthError('Unknown signing key');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    decodeBytes(rawSig),
    new TextEncoder().encode(`${rawHeader}.${rawPayload}`),
  );
  if (!valid) throw new AuthError('Bad token signature');

  const now = Math.floor(Date.now() / 1000);
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== `https://${team}`) throw new AuthError('Bad token issuer');
  if (!auds.includes(aud)) throw new AuthError('Bad token audience');
  if (typeof payload.exp !== 'number' || payload.exp < now - 30) throw new AuthError('Token expired');
  if (typeof payload.nbf === 'number' && payload.nbf > now + 30) throw new AuthError('Token not yet valid');

  return payload;
}

async function getKeys(team, force = false) {
  if (!force && certCache.team === team && certCache.expires > Date.now()) return certCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new AuthError('Could not fetch Access signing keys');
  const { keys = [] } = await res.json();
  certCache = { team, keys, expires: Date.now() + CERT_TTL_MS };
  return keys;
}

function decodeBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function decodeText(b64url) {
  return new TextDecoder().decode(decodeBytes(b64url));
}
