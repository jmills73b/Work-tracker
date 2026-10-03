import { describe, expect, it } from 'vitest';
import { changePassword, login, register } from '../../src/http/auth.js';
import { hashPassword } from '../../src/infra/crypto.js';
import { fakeDb, jsonRequest } from '../helpers/fakeDb.js';

const SALT = '0123456789abcdef0123456789abcdef';
const signup = { name: 'Eve', email: 'taken@x.com', password: 'longenough', confirm_password: 'longenough' };

async function storedUser(password = 'right-password') {
  return { id: 7, name: 'Jamie', email: 'j@x.com', is_admin: 0, password_salt: SALT, password_hash: await hashPassword(password, SALT) };
}

describe('login', () => {
  it('answers an unknown email and a wrong password with the same status and words', async () => {
    // Different answers would turn the form into a list of who has an account here.
    const unknown = await login(jsonRequest('/api/auth/login', { email: 'nobody@x.com', password: 'whatever1' }), { DB: fakeDb() });
    const user = await storedUser();
    const wrong = await login(
      jsonRequest('/api/auth/login', { email: 'j@x.com', password: 'wrong-password' }),
      { DB: fakeDb({ first: [['FROM users WHERE email', user]] }) },
    );
    expect([unknown.status, await unknown.text()]).toEqual([401, 'Invalid email or password']);
    expect([wrong.status, await wrong.text()]).toEqual([401, 'Invalid email or password']);
  });

  it('records a failure against both the address and the IP when the password is wrong', async () => {
    const db = fakeDb({ first: [['FROM users WHERE email', await storedUser()]] });
    await login(jsonRequest('/api/auth/login', { email: 'j@x.com', password: 'nope-nope' }, { headers: { 'CF-Connecting-IP': '1.2.3.4' } }), { DB: db });
    const counted = db.calls.filter((c) => c.sql?.startsWith('INSERT INTO login_attempts')).map((c) => c.params[0]);
    expect(counted).toEqual(['ip:1.2.3.4', 'email:j@x.com']);
  });

  it('refuses a locked-out address without looking up the user or hashing anything', async () => {
    const lockedUntil = new Date(Date.now() + 10 * 60000).toISOString();
    const db = fakeDb({ all: [['FROM login_attempts', [{ locked_until: lockedUntil }]]] });
    const res = await login(jsonRequest('/api/auth/login', { email: 'j@x.com', password: 'right-password' }), { DB: db });
    expect(res.status).toBe(429);
    expect(await res.text()).toBe('Too many failed attempts. Try again in 10 minutes.');
    expect(db.sqlRun().some((sql) => sql.includes('FROM users'))).toBe(false);
  });

  it('signs in with the right password and sets the session cookie', async () => {
    const db = fakeDb({ first: [['FROM users WHERE email', await storedUser()]] });
    const res = await login(jsonRequest('/api/auth/login', { email: ' J@X.com ', password: 'right-password' }), { DB: db });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 7, name: 'Jamie', email: 'j@x.com', is_admin: 0 });
    expect(res.headers.get('Set-Cookie')).toMatch(/^session=[0-9a-f]{64}; HttpOnly; Secure; SameSite=Lax/);
  });

  it('asks for both fields when either is missing', async () => {
    const res = await login(jsonRequest('/api/auth/login', { email: 'j@x.com' }), { DB: fakeDb() });
    expect([res.status, await res.text()]).toEqual([400, 'email and password are required']);
  });
});

describe('register', () => {
  it('asks a stranger for an invite code before saying whether their email is taken', async () => {
    // Checking the email first would let anyone confirm an address has an account here.
    const db = fakeDb({
      first: [['COUNT(*)', { n: 1 }], ['FROM users WHERE email', { id: 1 }]],
    });
    const res = await register(jsonRequest('/api/auth/register', signup), { DB: db });
    expect([res.status, await res.text()]).toEqual([400, 'Invite code is required not first user']);
  });

  it('refuses a code that does not exist or was already used', async () => {
    const db = fakeDb({ first: [['COUNT(*)', { n: 1 }]] });
    const res = await register(jsonRequest('/api/auth/register', { ...signup, invite_code: 'AAAA-BBBB-CCCC' }), { DB: db });
    expect([res.status, await res.text()]).toEqual([400, 'Invalid or already-used invite code']);
  });

  it('reports a duplicate email to someone holding a valid code', async () => {
    const db = fakeDb({
      first: [['COUNT(*)', { n: 1 }], ['FROM invite_codes', { code: 'AAAA-BBBB-CCCC' }], ['FROM users WHERE email', { id: 1 }]],
    });
    const res = await register(jsonRequest('/api/auth/register', { ...signup, invite_code: 'aaaa-bbbb-cccc' }), { DB: db });
    expect([res.status, await res.text()]).toEqual([409, 'An account with that email already exists']);
  });

  it('makes the first user an admin without an invite code', async () => {
    const db = fakeDb({
      first: [['COUNT(*)', { n: 0 }], ['SELECT id, name, email, is_admin FROM users WHERE email', { id: 1, name: 'Eve', email: 'taken@x.com', is_admin: 1 }]],
    });
    const res = await register(jsonRequest('/api/auth/register', signup), { DB: db });
    expect(res.status).toBe(201);
    const insert = db.calls.find((c) => c.method === 'batch').statements[0];
    expect(insert.sql).toContain('WHERE NOT EXISTS (SELECT 1 FROM users)');
    expect(db.sqlRun().some((sql) => sql.includes('FROM invite_codes'))).toBe(false);
  });

  it('creates an invited user and spends their code in one atomic batch', async () => {
    // Two separate statements could leave a user created with their code still unused.
    const db = fakeDb({
      first: [
        ['COUNT(*)', { n: 1 }],
        ['FROM invite_codes', { code: 'AAAA-BBBB-CCCC' }],
        ['SELECT id, name, email, is_admin FROM users WHERE email', { id: 2, name: 'Eve', email: 'taken@x.com', is_admin: 0 }],
      ],
    });
    await register(jsonRequest('/api/auth/register', { ...signup, invite_code: 'AAAA-BBBB-CCCC' }), { DB: db });
    const [batch] = db.calls.filter((c) => c.method === 'batch');
    expect(batch.statements.map((s) => s.sql.trim().split(/\s+/).slice(0, 2).join(' '))).toEqual(['INSERT INTO', 'UPDATE invite_codes']);
  });

  it('refuses when another registration took the first-user slot in the meantime', async () => {
    const db = fakeDb({ first: [['COUNT(*)', { n: 0 }]], batch: (stmts) => stmts.map(() => ({ meta: { changes: 0 } })) });
    const res = await register(jsonRequest('/api/auth/register', signup), { DB: db });
    expect([res.status, await res.text()]).toEqual([400, 'Invite code is required not first user']);
  });

  it('never stores the password, only its hash and salt', async () => {
    const db = fakeDb({ first: [['COUNT(*)', { n: 0 }], ['SELECT id, name, email, is_admin FROM users WHERE email', { id: 1 }]] });
    await register(jsonRequest('/api/auth/register', signup), { DB: db });
    const params = db.calls.find((c) => c.method === 'batch').statements[0].params;
    expect(params).not.toContain('longenough');
    expect(params[2]).toMatch(/^[0-9a-f]{64}$/);
    expect(params[3]).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('changePassword', () => {
  const sessionUser = { id: 7, email: 'j@x.com', tokenHash: 'keep-me' };

  it('refuses a wrong current password and changes nothing', async () => {
    const db = fakeDb({ first: [['FROM users WHERE id', await storedUser()]] });
    const res = await changePassword(
      jsonRequest('/api/auth/password', { current_password: 'wrong-one', new_password: 'brand-new-1', confirm_password: 'brand-new-1' }),
      { DB: db }, sessionUser,
    );
    expect([res.status, await res.text()]).toEqual([400, 'Current password is incorrect']);
    expect(db.sqlRun().some((sql) => sql.startsWith('UPDATE users'))).toBe(false);
  });

  it('updates the hash and signs out every other session but this one', async () => {
    const db = fakeDb({ first: [['FROM users WHERE id', await storedUser()]] });
    const res = await changePassword(
      jsonRequest('/api/auth/password', { current_password: 'right-password', new_password: 'brand-new-1', confirm_password: 'brand-new-1' }),
      { DB: db }, sessionUser,
    );
    expect(res.status).toBe(204);
    const [, signOut] = db.calls.find((c) => c.method === 'batch').statements;
    expect(signOut.params).toEqual([7, 'keep-me']);
  });
});
