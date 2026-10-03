import { describe, expect, it } from 'vitest';
import { dayOffset, templateFromTask, validateTemplateName } from '../../src/domain/templates.js';

describe('dayOffset', () => {
  it('counts days before the task date as negative', () => {
    expect(dayOffset('2026-10-10', '2026-10-07')).toBe(-3);
  });

  it('counts across a month end, and across the UK clock change at the end of October', () => {
    expect(dayOffset('2026-10-20', '2026-11-02')).toBe(13);
  });

  it('is zero, not null, for a subtask due the same day as its task', () => {
    // Zero is a real offset; treating it as "no date" would drop the subtask's date.
    expect(dayOffset('2026-10-10', '2026-10-10')).toBe(0);
  });

  it('is null when either date is missing', () => {
    expect(dayOffset(null, '2026-10-10')).toBeNull();
    expect(dayOffset('2026-10-10', null)).toBeNull();
  });
});

describe('templateFromTask', () => {
  const task = { title: 'Board pack', description: 'Q4', priority: 'high', team_id: 2, target_date: '2026-11-20', status: 'done', id: 'x' };

  it('keeps the parts worth reusing and drops status, ids and dates', () => {
    expect(templateFromTask(task, [])).toEqual({ title: 'Board pack', description: 'Q4', priority: 'high', team_id: 2, subtasks: [] });
  });

  it('turns subtask dates into offsets from the task date, keeping order', () => {
    const subtasks = [
      { title: 'Draft', target_date: '2026-11-13' },
      { title: 'Review', target_date: '2026-11-18' },
      { title: 'Print', target_date: null },
    ];
    expect(templateFromTask(task, subtasks).subtasks).toEqual([
      { title: 'Draft', offset_days: -7 },
      { title: 'Review', offset_days: -2 },
      { title: 'Print', offset_days: null },
    ]);
  });

  it('gives every subtask a null offset when the task itself has no date', () => {
    const t = templateFromTask({ ...task, target_date: null }, [{ title: 'Draft', target_date: '2026-11-13' }]);
    expect(t.subtasks).toEqual([{ title: 'Draft', offset_days: null }]);
  });
});

describe('validateTemplateName', () => {
  it('trims and requires a name', () => {
    expect(validateTemplateName('  Board pack ').value).toBe('Board pack');
    expect(validateTemplateName('   ').error).toBe('Template name is required');
    expect(validateTemplateName(null).error).toBe('Template name is required');
  });
});
