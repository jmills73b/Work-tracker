import { describe, expect, it } from 'vitest';
import { planTaskChanges } from '../../src/domain/taskChanges.js';

const NOW = '2026-10-03T12:00:00.000Z';
const task = (over = {}) => ({
  id: 't1', title: 'T', status: 'todo', priority: 'medium', target_date: null, completed_at: null, ...over,
});

describe('planTaskChanges', () => {
  it('changes nothing, not even updated_at, when every field already matches', () => {
    expect(planTaskChanges(task(), { status: 'todo', priority: 'medium' }, NOW)).toEqual({ changes: {}, log: [] });
  });

  it('stamps completed_at when a task is marked done, and nothing else', () => {
    const { changes } = planTaskChanges(task({ status: 'blocked' }), { status: 'done' }, NOW);
    expect(changes).toEqual({ status: 'done', completed_at: NOW, updated_at: NOW });
  });

  it('clears completed_at when a done task is reopened', () => {
    const { changes } = planTaskChanges(task({ status: 'done', completed_at: NOW }), { status: 'todo' }, NOW);
    expect(changes.completed_at).toBeNull();
  });

  it('writes the timeline lines the drawer shows, in order', () => {
    const { log } = planTaskChanges(task(), { status: 'done', priority: 'high', target_date: '2026-10-10' }, NOW);
    expect(log).toEqual([
      'Status: Open → Done',
      'Marked High',
      'Due: none → 2026-10-10',
    ]);
    expect(planTaskChanges(task({ priority: 'high' }), { priority: 'medium' }, NOW).log).toEqual(['High removed']);
  });

  it('logs a cleared due date as "none", not as "null"', () => {
    expect(planTaskChanges(task({ target_date: '2026-10-10' }), { target_date: null }, NOW).log)
      .toEqual(['Due: 2026-10-10 → none']);
  });

  it('does not log title or description edits to the timeline', () => {
    expect(planTaskChanges(task(), { title: 'New', description: 'More' }, NOW).log).toEqual([]);
  });
});

describe('Waiting and its chase date', () => {
  it('logs the chase date when a task starts waiting', () => {
    const { changes, log } = planTaskChanges(task(), { status: 'blocked', waiting_until: '2026-10-05' }, NOW);
    expect(changes).toMatchObject({ status: 'blocked', waiting_until: '2026-10-05' });
    expect(log[0]).toBe('Status: Open → Waiting');
    expect(log.join('\n')).toMatch(/Chase on/);
  });

  it('clears the chase date when the task stops waiting', () => {
    const { changes } = planTaskChanges(task({ status: 'blocked', waiting_until: '2026-10-05' }), { status: 'todo' }, NOW);
    expect(changes.waiting_until).toBeNull();
  });

  it('reads an old In progress status as Open in the log', () => {
    expect(planTaskChanges(task({ status: 'in_progress' }), { status: 'done' }, NOW).log).toEqual(['Status: Open → Done']);
  });
});
