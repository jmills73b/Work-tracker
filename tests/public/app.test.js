import { describe, expect, it, vi } from 'vitest';
import { sliceFunctions } from '../helpers/slice.js';

const dates = sliceFunctions('public/app.js', '  const dayNumber =', '  const rtf = new Intl', [
  'daysUntil', 'dueInfo', 'isOverdue', 'isDueThisWeek',
]);

const sorting = sliceFunctions('public/app.js', '  const byDue =', '  const STATUS_FILTERS', ['SORTS'], {
  prelude: "const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };",
});

// Saturday 3 October 2026, local time.
const TODAY = new Date(2026, 9, 3, 15, 30);
const task = (over = {}) => ({ status: 'todo', target_date: null, priority: 'medium', ...over });

describe('daysUntil', () => {
  it('counts calendar days, ignoring the time of day', () => {
    expect(dates.daysUntil('2026-10-04', new Date(2026, 9, 3, 23, 59))).toBe(1);
  });

  it('counts across a month boundary', () => {
    expect(dates.daysUntil('2026-11-02', TODAY)).toBe(30);
  });

  it('goes negative once the date has passed', () => {
    expect(dates.daysUntil('2026-10-01', TODAY)).toBe(-2);
  });
});

describe('dueInfo', () => {
  it('labels today, tomorrow and overdue in words', () => {
    expect(dates.dueInfo(task({ target_date: '2026-10-03' }), TODAY)).toMatchObject({ label: 'Today', cls: 'soon' });
    expect(dates.dueInfo(task({ target_date: '2026-10-04' }), TODAY)).toMatchObject({ label: 'Tomorrow', cls: 'soon' });
    expect(dates.dueInfo(task({ target_date: '2026-09-30' }), TODAY)).toMatchObject({ label: '3d overdue', cls: 'overdue' });
  });

  it('never shows a finished task as overdue', () => {
    expect(dates.dueInfo(task({ status: 'done', target_date: '2026-09-01' }), TODAY).cls).toBe('muted');
  });

  it('says "No date" when there is no target date', () => {
    expect(dates.dueInfo(task(), TODAY)).toEqual({ label: 'No date', cls: 'muted' });
  });
});

describe('isDueThisWeek / isOverdue', () => {
  it('includes today and the seventh day, but not the eighth', () => {
    expect(dates.isDueThisWeek(task({ target_date: '2026-10-03' }), TODAY)).toBe(true);
    expect(dates.isDueThisWeek(task({ target_date: '2026-10-10' }), TODAY)).toBe(true);
    expect(dates.isDueThisWeek(task({ target_date: '2026-10-11' }), TODAY)).toBe(false);
  });

  it('does not count an overdue task as due this week', () => {
    expect(dates.isDueThisWeek(task({ target_date: '2026-10-02' }), TODAY)).toBe(false);
    expect(dates.isOverdue(task({ target_date: '2026-10-02' }), TODAY)).toBe(true);
  });

  it('returns a real boolean for a task with no date, so tile counts stay numeric', () => {
    expect(dates.isOverdue(task(), TODAY)).toBe(false);
    expect(dates.isDueThisWeek(task(), TODAY)).toBe(false);
  });
});

describe('sorting', () => {
  const tasks = [
    { id: 'none-low', target_date: null, priority: 'low' },
    { id: 'oct10-low', target_date: '2026-10-10', priority: 'low' },
    { id: 'oct10-urgent', target_date: '2026-10-10', priority: 'urgent' },
    { id: 'oct05-medium', target_date: '2026-10-05', priority: 'medium' },
    { id: 'none-urgent', target_date: null, priority: 'urgent' },
  ];

  it('orders by target date, puts undated tasks last, and breaks ties by priority', () => {
    expect([...tasks].sort(sorting.SORTS.due).map((t) => t.id))
      .toEqual(['oct05-medium', 'oct10-urgent', 'oct10-low', 'none-urgent', 'none-low']);
  });

  it('orders by priority first, then by target date', () => {
    expect([...tasks].sort(sorting.SORTS.priority).map((t) => t.id))
      .toEqual(['oct10-urgent', 'none-urgent', 'oct05-medium', 'oct10-low', 'none-low']);
  });
});

describe('notify', () => {
  const load = (toast) => sliceFunctions('public/app.js', '  function notify(err) {', '  /* ---------- Dates', ['notify'], { inject: { toast } });

  it('shows an error toast exactly once', () => {
    // A find-and-replace once made notify() call itself: every error froze the page with
    // a stack overflow instead of showing a message. No other test exercised an error.
    const toast = vi.fn();
    load(toast).notify(new Error('Save failed'));
    expect(toast.mock.calls).toEqual([['Save failed', 'error']]);
  });

  it('stays quiet for a silent error, such as the redirect to the login page', () => {
    const toast = vi.fn();
    const err = new Error('Signed out');
    err.silent = true;
    load(toast).notify(err);
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('templates on the page', () => {
  const tpl = sliceFunctions('public/app.js', '  // The date `days` after an ISO date', '  /* end templates helpers */', ['shiftDate', 'placeDrafts']);

  it('shifts a date by whole days, backwards across a month start', () => {
    expect(tpl.shiftDate('2026-11-02', -3)).toBe('2026-10-30');
  });

  it('keeps an offset of zero as the task date itself', () => {
    expect(tpl.shiftDate('2026-11-02', 0)).toBe('2026-11-02');
  });

  it('places template subtasks against the task date and leaves hand-dated ones alone', () => {
    const drafts = [
      { title: 'Draft', offset_days: -7, target_date: null },
      { title: 'Hand-picked', offset_days: null, target_date: '2026-12-01' },
    ];
    expect(tpl.placeDrafts(drafts, '2026-11-20').map((d) => d.target_date)).toEqual(['2026-11-13', '2026-12-01']);
  });

  it('clears template dates again when the task date is cleared', () => {
    expect(tpl.placeDrafts([{ title: 'Draft', offset_days: -7, target_date: '2026-11-13' }], null)[0].target_date).toBeNull();
  });
});
