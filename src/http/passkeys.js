// Passkeys: Face ID / Touch ID sign-in (WebAuthn). The cryptographic checks are
// @simplewebauthn/server's; this file binds them to our sessions, lockout and storage.
//
// Sign-in is usernameless: the device offers its passkeys for this site and the one
// chosen identifies the account. Adding a passkey needs the current password, so a
// borrowed session alone can't plant a lasting way in. Password sign-in stays.
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { createSession, sessionCookie } from '../infra/auth.js';
import { hashPassword, timingSafeEqual } from '../infra/crypto.js';
import { clearFailures, EMAIL_MAX_FAILURES, IP_MAX_FAILURES, lockedUntil, recordFailure } from '../infra/loginAttempts.js';
import * as repo from '../infra/passkeysRepo.js';
import * as usersRepo from '../infra/usersRepo.js';
import { b64urlDecode, b64urlEncode } from '../infra/webpush.js';
import { json, noContent, text } from './respond.js';

const RP_NAME = 'mills. Tasks';
const TIMEOUT_MS = 60_000;

// The site itself is the relying party: its hostname is the RP ID, its origin the only
// origin accepted. Nothing here comes from the request body.
const site = (request) => {
  const url = new URL(request.url);
  return { rpID: url.hostname, origin: url.origin };
};
const ipKey = (request) => `ip:${request.headers.get('CF-Connecting-IP') || 'unknown'}`;
const lockedMessage = (until) => {
  const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60000));
  return `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
};
const isResponse = (r) => r && typeof r === 'object' && typeof r.id === 'string' && r.id.length <= 1024 && r.response && typeof r.response === 'object';
const parseTransports = (t) => {
  try {
    const v = JSON.parse(t || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

// ---------- sign in (no session yet) ----------

export async function loginOptions(request, env) {
  const until = await lockedUntil(env, [ipKey(request)]);
  if (until) return text(lockedMessage(until), 429);
  const options = await generateAuthenticationOptions({ rpID: site(request).rpID, userVerification: 'required', timeout: TIMEOUT_MS });
  const challengeId = await repo.saveChallenge(env, { kind: 'login', challenge: options.challenge });
  return json({ challenge_id: challengeId, options });
}

export async function login(request, env) {
  const body = await request.json();
  const key = ipKey(request);
  const until = await lockedUntil(env, [key]);
  if (until) return text(lockedMessage(until), 429);
  if (!isResponse(body?.response)) return text('Invalid passkey response', 400);

  const ceremony = await repo.takeChallenge(env, body.challenge_id, 'login');
  if (!ceremony) return text('That sign-in took too long. Try again.', 400);

  const fail = async (message = "That passkey didn't work. Use your password, or try again.") => {
    await recordFailure(env, key, IP_MAX_FAILURES);
    return text(message, 401);
  };
  const stored = await repo.findPasskey(env, body.response.id);
  if (!stored) return fail("That passkey isn't set up for this site. Sign in with your password, then add it.");

  const { rpID, origin } = site(request);
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: stored.id,
        publicKey: b64urlDecode(stored.public_key),
        counter: stored.counter,
        transports: parseTransports(stored.transports),
      },
    });
  } catch (e) {
    console.warn('passkey sign-in rejected:', e.message);
    return fail();
  }
  if (!result.verified) return fail();

  const user = await usersRepo.findById(env, stored.user_id);
  if (!user) return fail();
  await repo.markUsed(env, stored.id, result.authenticationInfo.newCounter, new Date().toISOString());
  const token = await createSession(env, user.id);
  return json({ id: user.id, name: user.name, email: user.email, is_admin: user.is_admin }, 200, { 'Set-Cookie': sessionCookie(token) });
}

// ---------- managing passkeys (signed in) ----------

export async function list(env, user) {
  const passkeys = await repo.listPasskeys(env, user.id);
  return json({ passkeys: passkeys.map(({ transports: _t, ...p }) => p) });
}

// Body: { password }. The password is checked (with the same lockout as changing it)
// before a challenge bound to this user is issued.
export async function registerOptions(request, env, user) {
  const body = await request.json();
  const password = typeof body?.password === 'string' ? body.password : '';
  const emailKey = `email:${user.email}`;
  if (await lockedUntil(env, [emailKey])) return text('Too many failed attempts. Try again later.', 429);
  const row = await usersRepo.findById(env, user.id);
  if (!password || !row || !timingSafeEqual(await hashPassword(password, row.password_salt), row.password_hash)) {
    await recordFailure(env, emailKey, EMAIL_MAX_FAILURES);
    return text('Password is incorrect', 400);
  }
  await clearFailures(env, emailKey);

  const existing = await repo.listPasskeys(env, user.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: site(request).rpID,
    userName: user.email,
    userDisplayName: user.name,
    // A stable handle that isn't the email, so it means nothing outside this site.
    userID: new TextEncoder().encode(`mills-tasks-user-${user.id}`),
    attestationType: 'none',
    timeout: TIMEOUT_MS,
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: parseTransports(p.transports) })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  const challengeId = await repo.saveChallenge(env, { kind: 'register', userId: user.id, challenge: options.challenge });
  return json({ challenge_id: challengeId, options });
}

// Body: { challenge_id, response, name }.
export async function register(request, env, user) {
  const body = await request.json();
  if (!isResponse(body?.response)) return text('Invalid passkey response', 400);
  const ceremony = await repo.takeChallenge(env, body.challenge_id, 'register');
  if (!ceremony || ceremony.user_id !== user.id) return text('That took too long. Try adding the passkey again.', 400);

  const { rpID, origin } = site(request);
  let result;
  try {
    result = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    console.warn('passkey registration rejected:', e.message);
    return text("Couldn't add that passkey. Try again.", 400);
  }
  if (!result.verified) return text("Couldn't add that passkey. Try again.", 400);

  const { credential } = result.registrationInfo;
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 60) : 'Passkey';
  try {
    await repo.addPasskey(env, user.id, {
      id: credential.id,
      publicKey: b64urlEncode(credential.publicKey),
      counter: credential.counter,
      transports: JSON.stringify(credential.transports ?? []),
      name,
    }, new Date().toISOString());
  } catch (e) {
    if (/UNIQUE|PRIMARY/i.test(String(e.message))) return text('That passkey is already added', 409);
    throw e;
  }
  return list(env, user);
}

export async function remove(env, user, rawId) {
  let id;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    id = null; // malformed escape: can't name any passkey
  }
  return id && (await repo.deletePasskey(env, user.id, id)) ? noContent() : json({ error: 'Passkey not found' }, 404);
}
