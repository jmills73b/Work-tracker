import { describe, expect, it } from 'vitest';
import { route } from '../../src/index.js';
import { fakeDb, jsonRequest } from '../helpers/fakeDb.js';

const TOKEN = 'c'.repeat(64);
const session = (isAdmin) => ['FROM sessions', { expires_at: '2999-01-01T00:00:00Z', id: 1, name: 'J', email: 'j@x.com', is_admin: isAdmin }];
const req = (path, body, method = 'POST') => jsonRequest(path, body, { method, headers: { Cookie: `session=${TOKEN}` } });

describe('team labels', () => {
  it('lets any signed-in user add a team, and refuses anyone signed out', async () => {
    const db = fakeDb({ first: [session(0)], all: [['FROM teams tm', [{ id: 1, name: 'Platform', task_count: 0 }]]] });
    const res = await route(req('/api/teams', { name: 'Platform' }), { DB: db });
    expect(res.status).toBe(201);
    expect(db.calls.some((c) => c.sql?.startsWith('INSERT INTO teams'))).toBe(true);
    const anon = await route(jsonRequest('/api/teams', { name: 'X' }), { DB: fakeDb() });
    expect(anon.status).toBe(401);
  });

  it('retires the admin-only routes', async () => {
    const res = await route(req('/api/admin/teams', { name: 'Platform' }), { DB: fakeDb({ first: [session(1)] }) });
    expect(res.status).toBe(404);
  });

  it('reports a duplicate name (any case) as a conflict', async () => {
    const db = fakeDb({ first: [session(0)], run: [['INSERT INTO teams', () => { throw new Error('D1_ERROR: UNIQUE constraint failed: teams.name'); }]] });
    const res = await route(req('/api/teams', { name: 'rdh' }), { DB: db });
    expect([res.status, (await res.json()).error]).toEqual([409, 'There is already a team with that name']);
  });

  it('moves tasks (and any old templates) to "no team" and deletes the team in one batch', async () => {
    const db = fakeDb({ first: [session(0)] });
    await route(req('/api/teams/2', undefined, 'DELETE'), { DB: db });
    const batch = db.calls.find((c) => c.method === 'batch').statements.map((s) => [s.sql, s.params]);
    expect(batch).toEqual([
      ['UPDATE tasks SET team_id = NULL WHERE team_id = ?', [2]],
      ['UPDATE templates SET team_id = NULL WHERE team_id = ?', [2]],
      ['DELETE FROM teams WHERE id = ?', [2]],
    ]);
  });

  it('answers 404 for a team id that is not a number, without touching the database', async () => {
    const db = fakeDb({ first: [session(0)] });
    expect((await route(req('/api/teams/abc', undefined, 'DELETE'), { DB: db })).status).toBe(404);
    expect(db.calls.some((c) => c.method === 'batch')).toBe(false);
  });

  it("counts only the signed-in user's tasks on each team", async () => {
    const db = fakeDb({ first: [session(0)], all: [['FROM teams tm', [{ id: 1, name: 'Dev Ops', task_count: 0 }]]] });
    const res = await route(new Request('https://tracker.test/api/teams', { headers: { Cookie: `session=${TOKEN}` } }), { DB: db });
    expect((await res.json()).teams.map((t) => t.name)).toEqual(['Dev Ops']);
    const list = db.calls.find((c) => c.sql?.includes('FROM teams tm'));
    expect(list.sql).toMatch(/t\.user_id = \?/);
    expect(list.params).toEqual([1]);
  });
});

describe('tasks and teams', () => {
  it('refuses a task on a team that does not exist', async () => {
    const res = await route(req('/api/tasks', { title: 'T', team_id: 99 }), { DB: fakeDb({ first: [session(0)] }) });
    expect([res.status, (await res.json()).error]).toEqual([400, 'Unknown team']);
  });
});
