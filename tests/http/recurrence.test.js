import { describe, expect, it } from 'vitest';
import { patch, postUpdate } from '../../src/http/tasks.js';
import { fakeDb, jsonRequest } from '../helpers/fakeDb.js';

const USER = { id: 7 };
const TASK = {
  id: 't1', title: 'Weekly check-in', description: '', status: 'in_progress', priority: 'medium',
  target_date: '2999-01-04', team_id: null, team_name: null, recurrence: 'weekly:1', next_task_id: null,
};

function db(task = TASK) {
  return fakeDb({
    first: [['FROM tasks t WHERE t.id = ?', (params) => (params[0] === 't1' ? task : { ...task, id: params[0], status: 'todo' })]],
    all: [['FROM subtasks WHERE task_id = ?', [{ id: 's1', title: 'Prep notes', done: 1, target_date: '2999-01-03' }]]],
    batch: async () => [],
  });
}

const batched = (d) => d.calls.filter((c) => c.method === 'batch').flatMap((c) => c.statements);

describe('marking a recurring task done', () => {
  it('creates the next occurrence in the same batch, with its subtasks moved on, and returns it', async () => {
    const d = db();
    const res = await patch(jsonRequest('/api/tasks/t1', { status: 'done' }, { method: 'PATCH' }), { DB: d }, USER, 't1');
    const body = await res.json();
    expect(body.task.id).toBe('t1');
    expect(body.next_task).toBeTruthy();

    const stmts = batched(d);
    const insert = stmts.find((s) => s.sql.includes('INSERT INTO tasks'));
    // title, description, priority, deadline, when, team, repeat
    expect(insert.params.slice(2, 9)).toEqual(['Weekly check-in', '', 'medium', '2999-01-11', null, null, 'weekly:1']);
    const sub = stmts.find((s) => s.sql.includes('INSERT INTO subtasks'));
    expect(sub.params).toContain('Prep notes');
    expect(sub.params).toContain('2999-01-10');
    expect(stmts.find((s) => s.sql.startsWith('UPDATE tasks SET next_task_id')).params).toEqual([insert.params[0], 't1', 7]);
    expect(stmts.some((s) => s.params?.includes('Next occurrence created, for 2999-01-11'))).toBe(true);
  });

  it('a log entry never changes status, so it never creates the next one', async () => {
    const d = db();
    const res = await postUpdate(jsonRequest('/api/tasks/t1/updates', { note: 'All sorted', status: 'done' }), { DB: d }, USER, 't1');
    expect(res.status).toBe(201);
    expect(batched(d).some((s) => s.sql.includes('INSERT INTO tasks'))).toBe(false);
    expect(batched(d).some((s) => /UPDATE tasks SET[^]*status/.test(s.sql))).toBe(false);
  });

  it('creates nothing for a task that does not repeat, or that already made its next one', async () => {
    for (const task of [{ ...TASK, recurrence: null }, { ...TASK, next_task_id: 'already' }]) {
      const d = db(task);
      const body = await (await patch(jsonRequest('/api/tasks/t1', { status: 'done' }, { method: 'PATCH' }), { DB: d }, USER, 't1')).json();
      expect(body.next_task).toBeUndefined();
      expect(batched(d).some((s) => s.sql.includes('INSERT INTO tasks'))).toBe(false);
    }
  });
});
