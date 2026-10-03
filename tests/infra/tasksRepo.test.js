import { describe, expect, it } from 'vitest';
import { attachSubtasks, updateSubtask } from '../../src/infra/tasksRepo.js';
import { fakeDb } from '../helpers/fakeDb.js';

describe('attachSubtasks', () => {
  it("gives each task its own subtasks, in order, and an empty list when it has none", () => {
    const tasks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const subtasks = [
      { task_id: 'a', id: 's1', title: 'one' },
      { task_id: 'c', id: 's3', title: 'three' },
      { task_id: 'a', id: 's2', title: 'two' },
    ];
    expect(attachSubtasks(tasks, subtasks)).toEqual([
      { id: 'a', subtasks: [{ id: 's1', title: 'one' }, { id: 's2', title: 'two' }] },
      { id: 'b', subtasks: [] },
      { id: 'c', subtasks: [{ id: 's3', title: 'three' }] },
    ]);
  });
});

describe('updateSubtask', () => {
  const run = (fields) => updateSubtask({ DB: fakeDb() }, 7, 't1', 's1', fields, '2026-10-03T12:00:00Z');

  it('writes a null target_date, which clears the date', () => {
    const stmt = run({ target_date: null });
    expect(stmt.sql).toMatch(/^UPDATE subtasks SET target_date = \? WHERE/);
    expect(stmt.params).toEqual([null, 's1', 't1', 7]);
  });

  it('does not touch the date when the change does not mention it', () => {
    expect(run({ title: 'Renamed' }).sql).not.toContain('target_date');
  });
});

describe('the task timeline', () => {
  it('leaves out the retired "Progress: x% → y%" lines but keeps everything else', async () => {
    const { taskDetail } = await import('../../src/infra/tasksRepo.js');
    const db = fakeDb({ first: [['FROM tasks t WHERE t.id', { id: 't1' }]] });
    await taskDetail({ DB: db }, 7, 't1');
    const sql = db.calls.find((c) => c.sql?.includes('LIMIT 500') && c.sql.includes('FROM task_updates')).sql;
    expect(sql).toContain("AND NOT (kind = 'change' AND note LIKE 'Progress: %')");
  });
});
