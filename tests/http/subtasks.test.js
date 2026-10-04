import { describe, expect, it } from 'vitest';
import { patchSubtask } from '../../src/http/tasks.js';
import { fakeDb, jsonRequest } from '../helpers/fakeDb.js';

const USER = { id: 7 };
const patch = (body) => jsonRequest('/api/tasks/t1/subtasks/s1', body, { method: 'PATCH' });

function db({ task = { id: 't1', status: 'todo', priority: 'medium', target_date: null }, subtask = { id: 's1', title: 'Draft', done: 0 } } = {}) {
  return fakeDb({
    first: [
      ['FROM subtasks WHERE id', subtask],
      ['FROM tasks t WHERE t.id', task],
    ],
  });
}

const batchSql = (d) => d.calls.find((c) => c.method === 'batch').statements;

describe('patchSubtask', () => {
  it('ticking a step logs it and leaves the task status alone', async () => {
    const d = db();
    expect((await patchSubtask(patch({ done: true }), { DB: d }, USER, 't1', 's1')).status).toBe(200);
    const stmts = batchSql(d);
    expect(stmts[0].sql).toMatch(/^UPDATE subtasks SET done = \?, completed_at = \?/);
    expect(stmts[0].params.slice(0, 1)).toEqual([1]);
    const notes = stmts.filter((s) => s.sql.includes('INSERT INTO task_updates')).map((s) => s.params[4]);
    expect(notes).toEqual(['Completed: Draft']);
    expect(stmts.some((s) => s.sql.startsWith('UPDATE tasks SET status'))).toBe(false);
  });

  it('un-ticking logs a reopen and leaves the task status alone', async () => {
    const d = db({ task: { id: 't1', status: 'todo' }, subtask: { id: 's1', title: 'Draft', done: 1 } });
    await patchSubtask(patch({ done: false }), { DB: d }, USER, 't1', 's1');
    const stmts = batchSql(d);
    expect(stmts[0].params.slice(0, 2)).toEqual([0, null]);
    expect(stmts.filter((s) => s.sql.includes('INSERT INTO task_updates')).map((s) => s.params[4])).toEqual(['Reopened: Draft']);
    expect(stmts.some((s) => s.sql.startsWith('UPDATE tasks SET status'))).toBe(false);
  });

  it('renaming without changing done adds nothing to the timeline', async () => {
    const d = db();
    await patchSubtask(patch({ title: 'Final draft' }), { DB: d }, USER, 't1', 's1');
    expect(batchSql(d).some((s) => s.sql.includes('INSERT INTO task_updates'))).toBe(false);
  });

  it("answers 404 for a subtask that isn't this user's, and writes nothing", async () => {
    // Every subtask query is scoped by user_id, so another user's id finds no row.
    const d = db({ subtask: null });
    const res = await patchSubtask(patch({ done: true }), { DB: d }, USER, 't1', 's1');
    expect([res.status, (await res.json()).error]).toEqual([404, 'Subtask not found']);
    expect(d.calls.some((c) => c.method === 'batch')).toBe(false);
  });

  it('scopes the subtask lookup to the signed-in user', async () => {
    const d = db();
    await patchSubtask(patch({ done: true }), { DB: d }, USER, 't1', 's1');
    expect(d.calls.find((c) => c.sql?.includes('FROM subtasks WHERE id')).params).toEqual(['s1', 't1', 7]);
  });
});
