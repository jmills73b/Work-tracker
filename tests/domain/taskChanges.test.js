import { describe, expect, it } from 'vitest';
import { planTaskChanges, statusAfterSubtaskChange } from '../../src/domain/taskChanges.js';

const NOW = '2026-10-03T12:00:00.000Z';
const task = (over = {}) => ({
  id: 't1', title: 'T', status: 'todo', priority: 'medium', target_date: null, completed_at: null, ...over,
});

describe('planTaskChanges', () => {
  it('changes nothing, not even updated_at, when every field already matches', () => {
    expect(planTaskChanges(task(), { status: 'todo', priority: 'medium' }, NOW)).toEqual({ changes: {}, log: [] });
  });

  it('stamps completed_at when a task is marked done, and nothing else', () => {
    const { changes } = planTaskChanges(task({ status: 'in_progress' }), { status: 'done' }, NOW);
    expect(changes).toEqual({ status: 'done', completed_at: NOW, updated_at: NOW });
  });

  it('clears completed_at when a done task is reopened', () => {
    const { changes } = planTaskChanges(task({ status: 'done', completed_at: NOW }), { status: 'in_progress' }, NOW);
    expect(changes.completed_at).toBeNull();
  });

  it('writes the timeline lines the drawer shows, in order', () => {
    const { log } = planTaskChanges(task(), { status: 'done', priority: 'urgent', target_date: '2026-10-10' }, NOW);
    expect(log).toEqual([
      'Status: To do → Done',
      'Priority: Medium → Urgent',
      'Target date: none → 2026-10-10',
    ]);
  });

  it('logs a cleared target date as "none", not as "null"', () => {
    expect(planTaskChanges(task({ target_date: '2026-10-10' }), { target_date: null }, NOW).log)
      .toEqual(['Target date: 2026-10-10 → none']);
  });

  it('does not log title or description edits to the timeline', () => {
    expect(planTaskChanges(task(), { title: 'New', description: 'More' }, NOW).log).toEqual([]);
  });
});

describe('statusAfterSubtaskChange', () => {
  it('starts a to-do task when one of its subtasks is ticked off', () => {
    expect(statusAfterSubtaskChange({ status: 'todo' }, true)).toBe('in_progress');
  });

  it('leaves a blocked or finished task alone when a subtask is ticked', () => {
    // Ticking the last subtask of a blocked task must not quietly unblock it.
    expect(statusAfterSubtaskChange({ status: 'blocked' }, true)).toBeNull();
    expect(statusAfterSubtaskChange({ status: 'done' }, true)).toBeNull();
  });

  it('does not move anything when a subtask is un-ticked', () => {
    expect(statusAfterSubtaskChange({ status: 'todo' }, false)).toBeNull();
  });
});
