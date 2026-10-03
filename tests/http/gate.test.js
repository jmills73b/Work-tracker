import { describe, expect, it } from 'vitest';
import worker, { route } from '../../src/index.js';
import { fakeDb, jsonRequest } from '../helpers/fakeDb.js';

const TOKEN = 'b'.repeat(64);
const ASSETS = { fetch: async (req) => new Response(`asset:${new URL(req.url).pathname}`) };
const signedIn = (user = { is_admin: 0 }) => fakeDb({
  first: [['FROM sessions', { expires_at: '2999-01-01T00:00:00Z', id: 1, name: 'J', email: 'j@x.com', ...user }]],
});
const get = (path, cookie) => new Request(`https://tracker.test${path}`, { headers: cookie ? { Cookie: `session=${TOKEN}` } : {} });

describe('page gate', () => {
  it('sends a visitor without a session from the app to the login page', async () => {
    const res = await route(get('/'), { DB: fakeDb(), ASSETS });
    expect([res.status, res.headers.get('Location')]).toEqual([302, 'https://tracker.test/login']);
  });

  it('protects a page nobody remembered to list, because the gate is default-deny', async () => {
    // In the other app a new page was public until added to a Set; here it is protected from birth.
    const res = await route(get('/some-new-page.html'), { DB: fakeDb(), ASSETS });
    expect(res.status).toBe(302);
  });

  it('serves the login page and its script without a session', async () => {
    for (const path of ['/login', '/login.js', '/app.css']) {
      expect(await (await route(get(path), { DB: fakeDb(), ASSETS })).text()).toBe(`asset:${path}`);
    }
  });

  it('sends a signed-in user away from the login page to the app', async () => {
    const res = await route(get('/login', true), { DB: signedIn(), ASSETS });
    expect([res.status, res.headers.get('Location')]).toEqual([302, 'https://tracker.test/']);
  });

  it('serves the app to a signed-in user', async () => {
    expect(await (await route(get('/', true), { DB: signedIn(), ASSETS })).text()).toBe('asset:/');
  });
});

describe('API gate', () => {
  it('answers 401 in plain text without a session', async () => {
    const res = await route(get('/api/tasks'), { DB: fakeDb(), ASSETS });
    expect([res.status, await res.text()]).toEqual([401, 'Unauthorized']);
  });

  it('keeps admin routes from signed-in users who are not admins', async () => {
    const res = await route(get('/api/admin/invites', true), { DB: signedIn({ is_admin: 0 }), ASSETS });
    expect([res.status, await res.text()]).toEqual([403, 'Forbidden']);
  });

  it('blocks a state-changing request from another origin', async () => {
    const req = jsonRequest('/api/auth/login', { email: 'a@b.c', password: 'x' }, { headers: { Origin: 'https://evil.test' } });
    expect((await route(req, { DB: fakeDb(), ASSETS })).status).toBe(403);
  });

  it('refuses a form-encoded POST, which a cross-site form could send without a preflight', async () => {
    const req = new Request('https://tracker.test/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=a',
    });
    expect((await route(req, { DB: fakeDb(), ASSETS })).status).toBe(415);
  });

  it('lets logout through without a session, since there may be none left', async () => {
    const req = jsonRequest('/api/auth/logout', {});
    expect((await route(req, { DB: fakeDb(), ASSETS })).status).toBe(204);
  });
});

describe('fetch wrapper', () => {
  it("turns a malformed JSON body into a 400 with a readable message", async () => {
    const res = await worker.fetch(jsonRequest('/api/auth/login', '{not json'), { DB: fakeDb(), ASSETS });
    expect([res.status, await res.text()]).toEqual([400, "That request body wasn't valid JSON."]);
  });

  it('adds the security headers to every response, pages included', async () => {
    const res = await worker.fetch(get('/login'), { DB: fakeDb(), ASSETS });
    expect(res.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });
});
