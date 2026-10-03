import { MAX_PASSWORD_LENGTH } from '../domain/passwordPolicy.js';
import { normalizeEmail, validatePasswordChange, validateRegistration } from '../domain/registration.js';
import { clearedCookie, createSession, destroySession, sessionCookie } from '../infra/auth.js';
import { hashPassword, randomHex, timingSafeEqual } from '../infra/crypto.js';
import { clearFailures, EMAIL_MAX_FAILURES, IP_MAX_FAILURES, lockedUntil, recordFailure } from '../infra/loginAttempts.js';
import * as usersRepo from '../infra/usersRepo.js';
import { json, noContent, text } from './respond.js';
import { isEnabled } from './assist.js';

// Hashed against when the email is unknown, so that path costs the same as a wrong password.
const DUMMY_SALT = '00000000000000000000000000000000';
const DUMMY_HASH = '0'.repeat(64);

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, is_admin: u.is_admin });

export async function register(request, env) {
  const { value, error } = validateRegistration(await request.json());
  if (error) return text(error.message, error.status);
  const { name, email, password, inviteCode } = value;

  // Gate first, duplicate-email check second: a stranger without a valid code learns
  // nothing about which addresses have accounts.
  const isFirst = (await usersRepo.countAll(env)) === 0;
  if (!isFirst) {
    if (!inviteCode) return text('Invite code is required not first user', 400);
    if (!(await usersRepo.findUnusedInviteCode(env, inviteCode))) return text('Invalid or already-used invite code', 400);
  }
  if (await usersRepo.findByEmail(env, email)) return text('An account with that email already exists', 409);

  const passwordSalt = randomHex(16);
  const passwordHash = await hashPassword(password, passwordSalt);
  let user;
  try {
    user = await usersRepo.create(env, { name, email, passwordHash, passwordSalt, inviteCode: isFirst ? null : inviteCode });
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) return text('An account with that email already exists', 409);
    throw e;
  }
  // Lost a race: someone else became the first user, or used the code, in between.
  if (!user) return text(isFirst ? 'Invite code is required not first user' : 'Invalid or already-used invite code', 400);

  const token = await createSession(env, user.id);
  return json(publicUser(user), 201, { 'Set-Cookie': sessionCookie(token) });
}

export async function login(request, env) {
  const body = await request.json();
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!email || !password) return text('email and password are required', 400);

  const ipKey = `ip:${request.headers.get('CF-Connecting-IP') || 'unknown'}`;
  const emailKey = `email:${email}`;
  const until = await lockedUntil(env, [ipKey, emailKey]);
  if (until) {
    const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60000));
    return text(`Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, 429);
  }

  // Unknown email and wrong password share one status, one message and one hash's worth of time.
  const user = await usersRepo.findByEmail(env, email);
  const tooLong = password.length > MAX_PASSWORD_LENGTH;
  const hash = await hashPassword(tooLong ? '' : password, user ? user.password_salt : DUMMY_SALT);
  const valid = !tooLong && timingSafeEqual(hash, user ? user.password_hash : DUMMY_HASH) && Boolean(user);
  if (!valid) {
    await recordFailure(env, ipKey, IP_MAX_FAILURES);
    await recordFailure(env, emailKey, EMAIL_MAX_FAILURES);
    return text('Invalid email or password', 401);
  }

  await clearFailures(env, emailKey);
  const token = await createSession(env, user.id);
  return json(publicUser(user), 200, { 'Set-Cookie': sessionCookie(token) });
}

export async function logout(request, env) {
  await destroySession(env, request);
  return noContent({ 'Set-Cookie': clearedCookie() });
}

// `assistant`: whether the page should offer the task assistant (its API key is set).
export function me(user, env = {}) {
  return json({ ...publicUser(user), assistant: isEnabled(env) });
}

export async function changePassword(request, env, user) {
  const { value, error } = validatePasswordChange(await request.json());
  if (error) return text(error.message, error.status);

  const emailKey = `email:${user.email}`;
  if (await lockedUntil(env, [emailKey])) return text('Too many failed attempts. Try again later.', 429);
  const row = await usersRepo.findById(env, user.id);
  if (!row || !timingSafeEqual(await hashPassword(value.current, row.password_salt), row.password_hash)) {
    await recordFailure(env, emailKey, EMAIL_MAX_FAILURES);
    return text('Current password is incorrect', 400);
  }
  await clearFailures(env, emailKey);

  const passwordSalt = randomHex(16);
  await usersRepo.updatePassword(env, user.id, {
    passwordHash: await hashPassword(value.next, passwordSalt),
    passwordSalt,
    keepTokenHash: user.tokenHash,
  });
  return noContent();
}
