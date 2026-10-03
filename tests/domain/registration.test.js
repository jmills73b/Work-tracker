import { describe, expect, it } from 'vitest';
import { MIN_PASSWORD_LENGTH } from '../../src/domain/passwordPolicy.js';
import { normalizeInviteCode, validatePasswordChange, validateRegistration } from '../../src/domain/registration.js';

const valid = { name: 'Jamie', email: 'jamie@example.com', password: 'longenough', confirm_password: 'longenough' };

describe('validateRegistration', () => {
  it('folds email case and whitespace so John@x.com and john@x.com are one account', () => {
    expect(validateRegistration({ ...valid, email: '  Jamie@Example.COM ' }).value.email).toBe('jamie@example.com');
  });

  it('reports a missing field before a password mismatch', () => {
    // The page shows exactly one message; the empty field is the one to fix first.
    expect(validateRegistration({ ...valid, name: '', confirm_password: 'different' }).error)
      .toEqual({ status: 400, message: 'All fields are required' });
  });

  it('treats null fields as missing rather than as the string "null"', () => {
    expect(validateRegistration({ ...valid, name: null }).error.message).toBe('All fields are required');
  });

  it('treats a whitespace-only name as missing', () => {
    expect(validateRegistration({ ...valid, name: '   ' }).error.message).toBe('All fields are required');
  });

  it('refuses mismatched passwords before checking their length', () => {
    expect(validateRegistration({ ...valid, password: 'short', confirm_password: 'other' }).error.message)
      .toBe('Passwords do not match');
  });

  it('states the minimum length from the policy constant, so the number lives in one place', () => {
    const pw = 'x'.repeat(MIN_PASSWORD_LENGTH - 1);
    expect(validateRegistration({ ...valid, password: pw, confirm_password: pw }).error.message)
      .toBe(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  });

  it('accepts a password of exactly the minimum length', () => {
    const pw = 'x'.repeat(MIN_PASSWORD_LENGTH);
    expect(validateRegistration({ ...valid, password: pw, confirm_password: pw }).value.password).toBe(pw);
  });

  it('does not trim passwords, because a leading space is part of what the user typed', () => {
    const pw = ' spaced out ';
    expect(validateRegistration({ ...valid, password: pw, confirm_password: pw }).value.password).toBe(pw);
  });

  it('handles a body that is not an object at all', () => {
    expect(validateRegistration(null).error.message).toBe('All fields are required');
  });
});

describe('normalizeInviteCode', () => {
  it('accepts a code typed in lower case with stray spaces', () => {
    expect(normalizeInviteCode(' ab12-cd34-ef56 ')).toBe('AB12-CD34-EF56');
  });

  it('returns an empty string for a missing code instead of "UNDEFINED"', () => {
    expect(normalizeInviteCode(undefined)).toBe('');
  });
});

describe('validatePasswordChange', () => {
  const body = { current_password: 'old-password', new_password: 'new-password', confirm_password: 'new-password' };

  it('refuses a new password identical to the current one', () => {
    expect(validatePasswordChange({ ...body, new_password: 'old-password', confirm_password: 'old-password' }).error.message)
      .toBe('New password must be different from the current one');
  });

  it('refuses a confirmation that does not match', () => {
    expect(validatePasswordChange({ ...body, confirm_password: 'nope-nope' }).error.message).toBe('Passwords do not match');
  });

  it('passes through a valid change', () => {
    expect(validatePasswordChange(body).value).toEqual({ current: 'old-password', next: 'new-password' });
  });
});
