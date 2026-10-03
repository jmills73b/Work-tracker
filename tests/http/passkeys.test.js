import { describe, expect, it, vi } from 'vitest';
import { list, login, loginOptions, register, registerOptions } from '../../src/http/passkeys.js';
import { hashPassword } from '../../src/infra/crypto.js';
import { takeChallenge } from '../../src/infra/passkeysRepo.js';
import { route } from '../../src/index.js';
import { fakeDb, jsonRequest } from '../helpers/fakeDb.js';

const SALT = 'ab'.repeat(16);
const USER = { id: 7, name: 'J', email: 'j@example.test', is_admin: 0 };
const CID = 'c'.repeat(32);
const fakeResponse = { id: 'cred-1', rawId: 'cred-1', type: 'public-key', response: { clientDataJSON: 'x' }, clientExtensionResults: {} };

async function userRow() {
  return { ...USER, password_salt: SALT, password_hash: await hashPassword('right-password', SALT) };
}

describe('passkey sign-in', () => {
  it('issues options for this site only, with user verification required, and stores the challenge', async () => {
    const db = fakeDb();
    const res = await loginOptions(new Request('https://tracker.test/api/auth/passkey/options', { method: 'POST' }), { DB: db });
    const body = await res.json();
    expect(body.options.rpId).toBe('tracker.test');
    expect(body.options.userVerification).toBe('required');
    expect(body.options.allowCredentials ?? []).toEqual([]);
    const insert = db.calls.find((c) => c.method === 'batch').statements.find((s) => s.sql.startsWith('INSERT INTO webauthn_challenges'));
    expect(insert.params.slice(0, 4)).toEqual([body.challenge_id, 'login', null, body.options.challenge]);
  });

  it('refuses an expired or already-used challenge before looking at the passkey', async () => {
    const db = fakeDb(); // DELETE … RETURNING finds nothing: used or never existed
    const res = await login(jsonRequest('/api/auth/passkey/login', { challenge_id: CID, response: fakeResponse }), { DB: db });
    expect([res.status, await res.text()]).toEqual([400, 'That sign-in took too long. Try again.']);
    expect(db.calls.some((c) => c.sql?.includes('FROM passkeys'))).toBe(false);
  });

  it('counts an unknown passkey as a failed attempt against the IP lockout', async () => {
    const db = fakeDb({ first: [['DELETE FROM webauthn_challenges', { challenge: 'abc', user_id: null, expires_at: new Date(Date.now() + 60000).toISOString() }]] });
    const res = await login(jsonRequest('/api/auth/passkey/login', { challenge_id: CID, response: fakeResponse }, { headers: { 'CF-Connecting-IP': '1.2.3.4' } }), { DB: db });
    expect(res.status).toBe(401);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    const failure = db.calls.find((c) => c.sql?.startsWith('INSERT INTO login_attempts'));
    expect(failure.params[0]).toBe('ip:1.2.3.4');
  });

  it('rejects a response that fails verification, with no session', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = fakeDb({ first: [
      ['DELETE FROM webauthn_challenges', { challenge: 'abc', user_id: null, expires_at: new Date(Date.now() + 60000).toISOString() }],
      ['FROM passkeys WHERE id = ?', { id: 'cred-1', user_id: 7, public_key: 'AQID', counter: 0, transports: '[]' }],
    ] });
    const res = await login(jsonRequest('/api/auth/passkey/login', { challenge_id: CID, response: fakeResponse }), { DB: db });
    expect(res.status).toBe(401);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(db.calls.some((c) => c.sql?.includes('INSERT INTO sessions'))).toBe(false);
  });

  it('is locked out like password sign-in', async () => {
    const db = fakeDb({ all: [['FROM login_attempts', [{ locked_until: new Date(Date.now() + 600000).toISOString() }]]] });
    const res = await loginOptions(new Request('https://tracker.test/api/auth/passkey/options', { method: 'POST' }), { DB: db });
    expect(res.status).toBe(429);
  });
});

describe('takeChallenge', () => {
  it('ignores ids that are not 32 hex characters, and expired rows', async () => {
    const db = fakeDb({ first: [['DELETE FROM webauthn_challenges', { challenge: 'abc', user_id: 7, expires_at: '2000-01-01T00:00:00Z' }]] });
    expect(await takeChallenge({ DB: db }, "x' OR 1=1", 'login')).toBeNull();
    expect(db.calls).toEqual([]);
    expect(await takeChallenge({ DB: db }, CID, 'register')).toBeNull();
  });
});

describe('adding a passkey', () => {
  it('needs the current password, and counts a wrong one towards the lockout', async () => {
    const db = fakeDb({ first: [['FROM users WHERE id = ?', await userRow()]] });
    const res = await registerOptions(jsonRequest('/api/auth/passkeys/options', { password: 'wrong' }), { DB: db }, USER);
    expect([res.status, await res.text()]).toEqual([400, 'Password is incorrect']);
    expect(db.calls.find((c) => c.sql?.startsWith('INSERT INTO login_attempts')).params[0]).toBe('email:j@example.test');
    expect(db.calls.some((c) => c.method === 'batch')).toBe(false);
  });

  it('with the right password, asks for a discoverable passkey with verification, excluding ones already added', async () => {
    const db = fakeDb({
      first: [['FROM users WHERE id = ?', await userRow()]],
      all: [['FROM passkeys WHERE user_id = ?', [{ id: 'existing', transports: '["internal"]' }]]],
    });
    const body = await (await registerOptions(jsonRequest('/api/auth/passkeys/options', { password: 'right-password' }), { DB: db }, USER)).json();
    expect(body.options.rp).toEqual({ name: 'mills. Tasks', id: 'tracker.test' });
    expect(body.options.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
    expect(body.options.excludeCredentials).toEqual([{ id: 'existing', type: 'public-key', transports: ['internal'] }]);
    expect(body.options.attestation).toBe('none');
    // The user handle isn't the email.
    expect(atob(body.options.user.id.replace(/-/g, '+').replace(/_/g, '/'))).toBe('mills-tasks-user-7');
    const insert = db.calls.find((c) => c.method === 'batch').statements.find((s) => s.sql.startsWith('INSERT INTO webauthn_challenges'));
    expect(insert.params.slice(1, 3)).toEqual(['register', 7]);
  });

  it("won't finish with a challenge issued to someone else", async () => {
    const db = fakeDb({ first: [['DELETE FROM webauthn_challenges', { challenge: 'abc', user_id: 8, expires_at: new Date(Date.now() + 60000).toISOString() }]] });
    const res = await register(jsonRequest('/api/auth/passkeys', { challenge_id: CID, response: fakeResponse }), { DB: db }, USER);
    expect(res.status).toBe(400);
    expect(db.calls.some((c) => c.sql?.startsWith('INSERT INTO passkeys'))).toBe(false);
  });

  it('lists passkeys without their transports or keys', async () => {
    const db = fakeDb({ all: [['FROM passkeys WHERE user_id = ?', [{ id: 'p1', name: 'iPhone', transports: '[]', created_at: 'x', last_used_at: null }]]] });
    expect(await (await list({ DB: db }, USER)).json()).toEqual({ passkeys: [{ id: 'p1', name: 'iPhone', created_at: 'x', last_used_at: null }] });
  });
});

describe('the gate', () => {
  it('lets passkey sign-in through without a session, keeps management behind one, and still checks the origin', async () => {
    const env = { DB: fakeDb() };
    const post = (path, headers = {}) => new Request(`https://t.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
    expect((await route(post('/api/auth/passkey/options'), env)).status).toBe(200);
    expect((await route(post('/api/auth/passkeys/options'), env)).status).toBe(401);
    expect((await route(new Request('https://t.test/api/auth/passkeys'), env)).status).toBe(401);
    expect((await route(post('/api/auth/passkey/login', { Origin: 'https://evil.test' }), env)).status).toBe(403);
  });
});

describe('removing a passkey', () => {
  it('only removes your own, and a malformed id is simply not found', async () => {
    const { remove } = await import('../../src/http/passkeys.js');
    const db = fakeDb({ run: [['DELETE FROM passkeys', { meta: { changes: 0 } }]] });
    expect((await remove({ DB: db }, USER, '%E0%A4%A')).status).toBe(404);
    expect(db.calls).toEqual([]);
    await remove({ DB: db }, USER, 'abc');
    expect(db.calls[0].params).toEqual(['abc', 7]);
  });
});
