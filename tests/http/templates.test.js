import { describe, expect, it } from 'vitest';
import { create } from '../../src/http/templates.js';
import { fakeDb, jsonRequest } from '../helpers/fakeDb.js';

const USER = { id: 7 };

describe('create template', () => {
  it("answers 404 for a task that isn't this user's, and writes nothing", async () => {
    const db = fakeDb();
    const res = await create(jsonRequest('/api/templates', { task_id: 'not-mine', name: 'Copy' }), { DB: db }, USER);
    expect([res.status, (await res.json()).error]).toEqual([404, 'Task not found']);
    expect(db.calls.some((c) => c.method === 'batch')).toBe(false);
  });

  it('writes the template and its subtasks in one batch, with offsets', async () => {
    const db = fakeDb({
      first: [['FROM tasks t WHERE t.id', { id: 't1', title: 'Board pack', description: '', priority: 'high', category: '', target_date: '2026-11-20' }]],
      all: [['FROM subtasks', [{ task_id: 't1', id: 's1', title: 'Draft', done: 0, target_date: '2026-11-13' }]]],
    });
    const res = await create(jsonRequest('/api/templates', { task_id: 't1', name: ' Board pack ' }), { DB: db }, USER);
    expect(res.status).toBe(201);
    const [batch] = db.calls.filter((c) => c.method === 'batch');
    expect(batch.statements.map((s) => s.sql.trim().split(/\s+/).slice(0, 3).join(' '))).toEqual(['INSERT INTO templates', 'INSERT INTO template_subtasks']);
    expect(batch.statements[0].params.slice(1, 3)).toEqual([7, 'Board pack']);
    expect(batch.statements[1].params.slice(3)).toEqual(['Draft', 0, -7]);
  });

  it('refuses a blank name before looking anything up', async () => {
    const db = fakeDb();
    const res = await create(jsonRequest('/api/templates', { task_id: 't1', name: '' }), { DB: db }, USER);
    expect(res.status).toBe(400);
    expect(db.calls).toEqual([]);
  });
});
