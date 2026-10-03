import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './passwordPolicy.js';

const str = (v) => (typeof v === 'string' ? v : '');

export const normalizeEmail = (email) => str(email).trim().toLowerCase();

// Invite codes are shown as XXXX-XXXX-XXXX; accept any case and stray spaces.
export const normalizeInviteCode = (code) => str(code).trim().toUpperCase().replace(/\s+/g, '');

// Checks that need no database, in the order the server reports them.
// Returns { value } or { error: { status, message } }.
export function validateRegistration(body) {
  const name = str(body?.name).trim();
  const email = normalizeEmail(body?.email);
  const password = str(body?.password);
  const confirm = str(body?.confirm_password);
  if (!name || !email || !password || !confirm) return { error: { status: 400, message: 'All fields are required' } };
  if (password !== confirm) return { error: { status: 400, message: 'Passwords do not match' } };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: { status: 400, message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` } };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { error: { status: 400, message: `Password must be at most ${MAX_PASSWORD_LENGTH} characters` } };
  }
  return { value: { name, email, password, inviteCode: normalizeInviteCode(body?.invite_code) } };
}

// Same shape for the signed-in change-password form.
export function validatePasswordChange(body) {
  const current = str(body?.current_password);
  const next = str(body?.new_password);
  const confirm = str(body?.confirm_password);
  if (!current || !next || !confirm) return { error: { status: 400, message: 'All fields are required' } };
  if (next !== confirm) return { error: { status: 400, message: 'Passwords do not match' } };
  if (next.length < MIN_PASSWORD_LENGTH) {
    return { error: { status: 400, message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` } };
  }
  if (next.length > MAX_PASSWORD_LENGTH) {
    return { error: { status: 400, message: `Password must be at most ${MAX_PASSWORD_LENGTH} characters` } };
  }
  if (next === current) return { error: { status: 400, message: 'New password must be different from the current one' } };
  return { value: { current, next } };
}
