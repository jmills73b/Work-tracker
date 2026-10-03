import { describe, expect, it } from 'vitest';
import { planTaskChanges } from '../../src/domain/taskChanges.js';

const NOW = '2026-10-03T12:00:00.000Z';
const task = (over = {}) => ({
  id: 't1', title: 'T', status: 'todo', priority: 'medium', progress: 0, target_date: null, completed_at: null, ...over,
});

describe('planTaskChanges', () => {
  it('changes nothing, not even updated_at, when every field already matches', () => {
    expect(planTaskChanges(task(), { status: 'todo', progress: 0 }, NOW)).toEqual({ changes: {}, log: [] });
  });

  it('completes progress and stamps completed_at when a task is marked done', () => {
    const { changes } = planTaskChanges(task({ status: 'in_progress', progress: 40 }), { status: 'done' }, NOW);
    expect(changes).toEqual({ status: 'done', progress: 100, completed_at: NOW, updated_at: NOW });
  });

  it('clears completed_at when a done task is reopened', () => {
    const { changes } = planTaskChanges(task({ status: 'done', progress: 100, completed_at: NOW }), { status: 'in_progress' }, NOW);
    expect(changes.completed_at).toBeNull();
  });

  it('starts a to-do task when progress moves above zero', () => {
    expect(planTaskChanges(task(), { progress: 10 }, NOW).changes.status).toBe('in_progress');
  });

  it('leaves a to-do task alone when progress is set to zero', () => {
    const { changes } = planTaskChanges(task({ progress: 30 }), { progress: 0 }, NOW);
    expect(changes).toEqual({ progress: 0, updated_at: NOW });
  });

  it('does not override a status the user chose in the same change', () => {
    expect(planTaskChanges(task(), { progress: 10, status: 'blocked' }, NOW).changes.status).toBe('blocked');
  });

  it('writes the timeline lines the drawer shows, in order', () => {
    const { log } = planTaskChanges(task(), { status: 'done', priority: 'urgent', target_date: '2026-10-10' }, NOW);
    expect(log).toEqual([
      'Status: To do → Done',
      'Progress: 0% → 100%',
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
