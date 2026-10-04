import { describe, expect, it } from 'vitest';
import { csvField, download, toCsv } from '../../src/http/export.js';
import { route } from '../../src/index.js';
import { fakeDb } from '../helpers/fakeDb.js';

const TASK = {
  id: 't1', title: 'Board pack', description: 'Q4 "final"', status: 'blocked', priority: 'high', planned_on: '2026-10-07', target_date: '2026-10-09',
  team_name: 'Leadership', recurrence: null, created_at: '2026-10-01T09:00:00Z', completed_at: null,
  steps: [{ title: 'Draft', done: 1 }, { title: 'Send', done: 0 }],
  log: [{ kind: 'change', note: 'Task created' }, { kind: 'note', note: 'Sent to CFO' }],
};

describe('csvField', () => {
  it('quotes every field and doubles quotes inside', () => {
    expect(csvField('a "b", c')).toBe('"a ""b"", c"');
    expect(csvField(null)).toBe('""');
    expect(csvField(3)).toBe('"3"');
  });

  it('stops a spreadsheet running text as a formula', () => {
    for (const s of ['=SUM(A1)', '+1', '-1', '@x']) expect(csvField(s)).toBe(`"'${s}"`);
  });
});

describe('toCsv', () => {
  it('writes one row per task in plain words: state, High, steps done and the last log entry', () => {
    const [head, row] = toCsv([TASK]).split('\r\n');
    expect(head).toBe('"Title","Status","High","When","Deadline","Team","Repeats","Steps done","Steps","Notes","Created","Done on","Last log entry"');
    expect(row).toBe('"Board pack","Waiting","Yes","2026-10-07","2026-10-09","Leadership","","1","2","Q4 ""final""","2026-10-01","","Sent to CFO"');
  });
});

describe('GET /api/export', () => {
  const db = () => fakeDb({
    all: [
      ['FROM tasks t WHERE t.user_id', [{ ...TASK, steps: undefined, log: undefined, subtask_total: 2, last_note: 'x' }]],
      ['FROM subtasks WHERE user_id', [{ task_id: 't1', id: 's1', position: 0, title: 'Draft', done: 1, target_date: null }]],
      ['FROM task_updates WHERE user_id', [{ task_id: 't1', kind: 'note', note: 'Sent to CFO', created_at: '2026-10-02T09:00:00Z' }]],
      ['FROM teams tm', [{ id: 1, name: 'Leadership', task_count: 1 }]],
    ],
  });

  it('downloads JSON with each task carrying its steps and log, only for this user', async () => {
    const d = db();
    const res = await download({ DB: d }, { id: 7 }, 'json', new Date('2026-10-04T08:00:00Z'));
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="mills-tasks-2026-10-04.json"');
    const body = await res.json();
    expect(body.teams).toEqual([{ id: 1, name: 'Leadership' }]);
    expect(body.tasks[0]).toMatchObject({ id: 't1', steps: [{ title: 'Draft', done: 1, target_date: null }], log: [{ kind: 'note', note: 'Sent to CFO' }] });
    expect(body.tasks[0]).not.toHaveProperty('subtask_total');
    for (const c of d.calls.filter((c) => c.sql?.includes('user_id = ?'))) expect(c.params).toEqual([7]);
  });

  it('downloads CSV when asked', async () => {
    const res = await download({ DB: db() }, { id: 7 }, 'csv', new Date('2026-10-04T08:00:00Z'));
    expect(res.headers.get('Content-Type')).toMatch(/^text\/csv/);
    expect((await res.text()).split('\r\n')).toHaveLength(2);
  });

  it('is behind the session gate', async () => {
    const res = await route(new Request('https://t.test/api/export?format=csv'), { DB: fakeDb() });
    expect(res.status).toBe(401);
  });
});
