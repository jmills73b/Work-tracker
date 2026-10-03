import { describe, expect, it } from 'vitest';
import { getSessionUser, hashToken, parseCookies, sessionCookie } from '../../src/infra/auth.js';
import { fakeDb } from '../helpers/fakeDb.js';

const TOKEN = 'a'.repeat(64);
const withCookie = (cookie) => new Request('https://tracker.test/', { headers: { Cookie: cookie } });

describe('parseCookies', () => {
  it('splits each pair at the first "=" only, so a value containing "=" survives intact', () => {
    expect(parseCookies('session=abc=def; theme=dark')).toEqual({ session: 'abc=def', theme: 'dark' });
  });

  it('trims names and values', () => {
    expect(parseCookies('  session = xyz ;other=1')).toEqual({ session: 'xyz', other: '1' });
  });

  it('returns an empty object for a missing header', () => {
    expect(parseCookies(null)).toEqual({});
  });
});

describe('sessionCookie', () => {
  it('is HttpOnly, Secure and SameSite=Lax for thirty days', () => {
    expect(sessionCookie('t')).toBe('session=t; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000');
  });
});

describe('getSessionUser', () => {
  const NOW = new Date('2026-10-03T12:00:00Z');
  const row = (expires_at) => ({ expires_at, id: 1, name: 'Jamie', email: 'j@x.com', is_admin: 1 });

  it('looks the session up by the hash of the token, never the token itself', async () => {
    const db = fakeDb({ first: [['FROM sessions', row('2026-11-01T00:00:00Z')]] });
    await getSessionUser({ DB: db }, withCookie(`session=${TOKEN}`), NOW);
    expect(db.calls[0].params).toEqual([await hashToken(TOKEN)]);
  });

  it('rejects a session row that is found but has expired', async () => {
    const db = fakeDb({ first: [['FROM sessions', row('2026-10-03T11:59:59Z')]] });
    expect(await getSessionUser({ DB: db }, withCookie(`session=${TOKEN}`), NOW)).toBeNull();
  });

  it('accepts a session that has not expired', async () => {
    const db = fakeDb({ first: [['FROM sessions', row('2026-10-03T12:00:01Z')]] });
    expect(await getSessionUser({ DB: db }, withCookie(`session=${TOKEN}`), NOW)).toMatchObject({ id: 1, email: 'j@x.com' });
  });

  it('does not touch the database for a cookie that cannot be a token', async () => {
    const db = fakeDb();
    expect(await getSessionUser({ DB: db }, withCookie("session=' OR 1=1 --"), NOW)).toBeNull();
    expect(db.calls).toEqual([]);
  });
});
