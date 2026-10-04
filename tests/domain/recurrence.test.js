import { describe, expect, it } from 'vitest';
import {
  addMonths, describeRecurrence, nextOccurrence, nextTargetDate, shouldRecur, validateRecurrence,
} from '../../src/domain/recurrence.js';

describe('validateRecurrence', () => {
  it.each(['weekly:1', 'weekly:4', 'monthly:1', 'monthly:3', 'monthly:12', 'after:1', 'after:99', 'after:365'])('accepts %s', (v) => {
    expect(validateRecurrence(v)).toEqual({ value: v });
  });
  it.each(['weekly:5', 'monthly:4', 'after:0', 'after:366', 'daily', 'weekly:1 ', 7])('refuses %j', (v) => {
    expect(validateRecurrence(v)).toEqual({ error: 'Invalid repeat setting' });
  });
  it('treats null and empty as no repeat', () => {
    expect([validateRecurrence(null), validateRecurrence('')]).toEqual([{ value: null }, { value: null }]);
  });
});

describe('describeRecurrence', () => {
  it('says it in words', () => {
    expect(['weekly:1', 'weekly:2', 'monthly:1', 'monthly:3', 'monthly:6', 'monthly:12', 'after:1', 'after:7'].map(describeRecurrence)).toEqual([
      'every week', 'every 2 weeks', 'every month', 'every quarter', 'every 6 months', 'every year', '1 day after done', '7 days after done',
    ]);
  });
});

describe('addMonths', () => {
  it('keeps the day of the month, or uses the last day when the month is shorter', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });
});

describe('nextTargetDate', () => {
  const t = (recurrence, target_date) => ({ recurrence, target_date });

  it('moves on one period from the target date when done on time', () => {
    expect(nextTargetDate(t('weekly:1', '2026-10-05'), '2026-10-05')).toBe('2026-10-12');
    expect(nextTargetDate(t('weekly:2', '2026-10-05'), '2026-10-02')).toBe('2026-10-19');
    expect(nextTargetDate(t('monthly:1', '2026-10-31'), '2026-10-30')).toBe('2026-11-30');
  });

  it('skips dates already past, so a late finish does not come back overdue', () => {
    expect(nextTargetDate(t('weekly:1', '2026-09-07'), '2026-10-03')).toBe('2026-10-05');
    // Exactly on a cycle date counts as past: the next one is a period later.
    expect(nextTargetDate(t('weekly:1', '2026-09-26'), '2026-10-03')).toBe('2026-10-10');
  });

  it('keeps the month-end rhythm rather than drifting: 31 Jan → 28 Feb → 31 Mar', () => {
    expect(nextTargetDate(t('monthly:1', '2026-01-31'), '2026-03-01')).toBe('2026-03-31');
  });

  it('counts "after done" from the day it was done, whatever the target date', () => {
    expect(nextTargetDate(t('after:10', '2026-01-01'), '2026-10-03')).toBe('2026-10-13');
  });

  it('starts from the day it was done when there is no target date', () => {
    expect(nextTargetDate(t('weekly:1', null), '2026-10-03')).toBe('2026-10-10');
  });
});

describe('nextOccurrence', () => {
  it('copies the task, unticked, with subtask dates moved as far as the task moved', () => {
    const task = { title: 'Board pack', description: 'd', priority: 'high', team_id: 2, recurrence: 'monthly:1', target_date: '2026-10-30', status: 'done' };
    const subtasks = [
      { title: 'Collect figures', done: 1, target_date: '2026-10-23' },
      { title: 'Send', done: 0, target_date: null },
    ];
    expect(nextOccurrence(task, subtasks, '2026-10-29')).toEqual({
      title: 'Board pack', description: 'd', priority: 'high', team_id: 2, recurrence: 'monthly:1', status: 'todo',
      target_date: '2026-11-30', planned_on: null,
      subtasks: [{ title: 'Collect figures', target_date: '2026-11-23' }, { title: 'Send', target_date: null }],
    });
  });

  it('repeats from the "when" of a task with no deadline, and lands the new date there too', () => {
    const task = { title: '1:1 prep', priority: 'medium', recurrence: 'weekly:1', target_date: null, planned_on: '2026-10-05', status: 'done' };
    expect(nextOccurrence(task, [], '2026-10-05')).toMatchObject({ target_date: null, planned_on: '2026-10-12' });
  });
});

describe('shouldRecur', () => {
  const rec = { status: 'in_progress', recurrence: 'weekly:1', next_task_id: null };
  it('only when a repeating task becomes done for the first time', () => {
    expect(shouldRecur(rec, { status: 'done' })).toBe(true);
    expect(shouldRecur(rec, { status: 'blocked' })).toBe(false);
    expect(shouldRecur({ ...rec, status: 'done' }, { status: 'done' })).toBe(false);
    expect(shouldRecur({ ...rec, recurrence: null }, { status: 'done' })).toBe(false);
    // Reopened and done again: the next one already exists.
    expect(shouldRecur({ ...rec, next_task_id: 'abc' }, { status: 'done' })).toBe(false);
  });
  it('uses a repeat set in the same change', () => {
    expect(shouldRecur({ ...rec, recurrence: null }, { status: 'done', recurrence: 'after:3' })).toBe(true);
    expect(shouldRecur(rec, { status: 'done', recurrence: null })).toBe(false);
  });
});
