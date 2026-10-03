import { describe, expect, it, vi } from 'vitest';
import { sliceFunctions } from '../helpers/slice.js';

const dates = sliceFunctions('public/app.js', '  const dayNumber =', '  const rtf = new Intl', [
  'daysUntil', 'dueInfo', 'isOverdue', 'isDueThisWeek', 'planWeek', 'isArchived', 'computeInsights',
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

describe('parseQuickAdd', () => {
  const { parseQuickAdd } = sliceFunctions('public/app.js', '  const QA_WEEKDAYS', '  /* end quick add parser */', ['parseQuickAdd']);
  // Saturday 3 October 2026; and Monday 5 October for the "next" rules.
  const SAT = new Date(2026, 9, 3, 15);
  const MON = new Date(2026, 9, 5, 9);

  const TEAMS = [{ id: 1, name: 'Dev Ops' }, { id: 2, name: 'RDH' }, { id: 3, name: 'GDS' }];

  it('picks out a weekday, a priority and a team, leaving the title', () => {
    expect(parseQuickAdd('Board deck fri !high #RDH', SAT, TEAMS))
      .toEqual({ title: 'Board deck', target_date: '2026-10-09', priority: 'high', team_id: 2, team_name: 'RDH' });
  });

  it('finds a team however its name is typed', () => {
    for (const tag of ['#DevOps', '#devops', '#Dev_Ops', '#dev-ops']) {
      expect(parseQuickAdd(`Patch servers ${tag}`, SAT, TEAMS)).toMatchObject({ title: 'Patch servers', team_id: 1 });
    }
  });

  it('leaves a #word that names no team in the title, so the preview shows it was not understood', () => {
    expect(parseQuickAdd('Plan #Finance', SAT, TEAMS)).toMatchObject({ title: 'Plan #Finance', team_id: null });
  });

  it('reads numeric dates as day/month, the UK way', () => {
    expect(parseQuickAdd('Pay invoice 12/10', SAT).target_date).toBe('2026-10-12');
  });

  it('rolls a day and month that has already passed into next year', () => {
    expect(parseQuickAdd('Renew insurance 2 Jan', SAT).target_date).toBe('2027-01-02');
  });

  it('leaves an impossible date in the title instead of guessing', () => {
    expect(parseQuickAdd('Fix 31/02 thing', SAT)).toMatchObject({ title: 'Fix 31/02 thing', target_date: null });
  });

  it("does not mistake a name or a possessive for a date", () => {
    // "tom" and "today's" were the obvious false positives.
    expect(parseQuickAdd('Call Tom tomorrow', SAT)).toMatchObject({ title: 'Call Tom', target_date: '2026-10-04' });
    expect(parseQuickAdd("Today's standup notes", SAT)).toMatchObject({ title: "Today's standup notes", target_date: null });
  });

  it('reads "fri" as the coming Friday, and as today on a Friday', () => {
    expect(parseQuickAdd('x fri', MON).target_date).toBe('2026-10-09');
    expect(parseQuickAdd('x fri', new Date(2026, 9, 9, 8)).target_date).toBe('2026-10-09');
  });

  it('reads "next fri" as the Friday of next week', () => {
    expect(parseQuickAdd('x next fri', MON).target_date).toBe('2026-10-16');
    expect(parseQuickAdd('x next fri', SAT).target_date).toBe('2026-10-09');
  });

  it('understands relative phrases', () => {
    expect(parseQuickAdd('x in 2 weeks', SAT).target_date).toBe('2026-10-17');
    expect(parseQuickAdd('x next week', SAT).target_date).toBe('2026-10-05');
    expect(parseQuickAdd('x eom', SAT).target_date).toBe('2026-10-31');
    expect(parseQuickAdd('x eow', MON).target_date).toBe('2026-10-09');
  });

  it('clamps "in 1 month" from the 31st to the end of a shorter month', () => {
    expect(parseQuickAdd('x in 1 month', new Date(2026, 0, 31, 9)).target_date).toBe('2026-02-28');
  });

  it('uses the first date and priority it finds and leaves later ones in the title', () => {
    expect(parseQuickAdd('Move fri to mon !low !high', SAT)).toMatchObject({ title: 'Move to mon !high', target_date: '2026-10-09', priority: 'low' });
  });

  it('gives an empty title for a line that is only tokens, so nothing is saved', () => {
    expect(parseQuickAdd('tomorrow !high', SAT).title).toBe('');
  });

  it('ignores #words when there are no teams at all', () => {
    expect(parseQuickAdd('Plan #RDH', SAT)).toMatchObject({ title: 'Plan #RDH', team_id: null });
  });
});

describe('planWeek (the Today view)', () => {
  const ids = (items) => items.map((i) => (i.kind === 'task' ? i.task.id : `${i.task.id}/${i.subtask.id}`));

  it('puts open tasks and open subtasks into overdue, today and the next 7 days', () => {
    const tasks = [
      task({ id: 'late', target_date: '2026-10-01' }),
      task({ id: 'now', target_date: '2026-10-03' }),
      task({ id: 'soon', target_date: '2026-10-10' }),
      task({ id: 'later', target_date: '2026-10-11' }),
      task({ id: 'undated' }),
      task({ id: 'big', target_date: '2026-12-01', subtasks: [
        { id: 's1', done: 0, target_date: '2026-10-03' },
        { id: 's2', done: 1, target_date: '2026-10-03' },
        { id: 's3', done: 0, target_date: null },
        { id: 's4', done: 0, target_date: '2026-09-30' },
      ] }),
    ];
    const g = dates.planWeek(tasks, TODAY);
    expect(ids(g.overdue)).toEqual(['big/s4', 'late']);
    expect(ids(g.today)).toEqual(['now', 'big/s1']);
    expect(ids(g.week)).toEqual(['soon']);
  });

  it('leaves out done tasks and every subtask of a done task', () => {
    const g = dates.planWeek([task({ id: 'd', status: 'done', target_date: '2026-10-03', subtasks: [{ id: 's', done: 0, target_date: '2026-10-03' }] })], TODAY);
    expect([...g.overdue, ...g.today, ...g.week]).toEqual([]);
  });

  it('orders the same day by priority, then the task before its subtasks', () => {
    const tasks = [
      task({ id: 'low', priority: 'low', target_date: '2026-10-03' }),
      task({ id: 'urgent', priority: 'urgent', target_date: '2026-10-05', subtasks: [{ id: 's', done: 0, target_date: '2026-10-03' }] }),
      task({ id: 'high', priority: 'high', target_date: '2026-10-03' }),
    ];
    expect(ids(dates.planWeek(tasks, TODAY).today)).toEqual(['urgent/s', 'high', 'low']);
  });
});

describe('isArchived', () => {
  const at = (y, m, d) => new Date(y, m - 1, d, 12).toISOString();
  it('is a done task finished 30 or more calendar days ago', () => {
    expect(dates.isArchived(task({ status: 'done', completed_at: at(2026, 9, 3) }), TODAY)).toBe(true);
    expect(dates.isArchived(task({ status: 'done', completed_at: at(2026, 9, 4) }), TODAY)).toBe(false);
    expect(dates.isArchived(task({ status: 'todo', completed_at: at(2026, 1, 1) }), TODAY)).toBe(false);
  });
});

describe('computeInsights', () => {
  // TODAY is Saturday 3 Oct 2026; its week starts Monday 28 Sep.
  const doneOn = (y, m, d, over = {}) => task({ status: 'done', completed_at: new Date(y, m - 1, d, 15).toISOString(), ...over });

  it('counts done per Monday-start week, oldest first, for the last 12 weeks', () => {
    const ins = dates.computeInsights([doneOn(2026, 9, 28), doneOn(2026, 10, 3), doneOn(2026, 9, 27), doneOn(2026, 7, 1)], TODAY);
    expect(ins.weeks).toHaveLength(12);
    expect(ins.weeks.at(-1)).toEqual({ start: '2026-09-28', count: 2 });
    expect(ins.weeks.at(-2)).toEqual({ start: '2026-09-21', count: 1 });
    expect(ins.weeks[0].start).toBe('2026-07-13');
    expect(ins.weeks.reduce((n, w) => n + w.count, 0)).toBe(3);
  });

  it('works out on-time rate and average slip from dated tasks done in the last 90 days', () => {
    const ins = dates.computeInsights([
      doneOn(2026, 10, 1, { target_date: '2026-10-01' }), // on the day: on time
      doneOn(2026, 9, 20, { target_date: '2026-09-25' }), // early
      doneOn(2026, 9, 30, { target_date: '2026-09-26' }), // 4 days late
      doneOn(2026, 9, 10, { target_date: '2026-09-08' }), // 2 days late
      doneOn(2026, 9, 10), // no date: not counted for on-time
      doneOn(2026, 5, 1, { target_date: '2026-04-01' }), // older than 90 days: ignored
    ], TODAY);
    expect(ins.dated).toBe(4);
    expect(ins.onTimeRate).toBe(0.5);
    expect(ins.avgSlip).toBe(3);
    expect(ins.done30).toBe(5); // all but the May one are within 30 days
  });

  it('gives nulls rather than 0% when there is nothing to measure', () => {
    const ins = dates.computeInsights([task({ target_date: '2026-09-01' })], TODAY);
    expect([ins.onTimeRate, ins.avgSlip, ins.overdue]).toEqual([null, null, 1]);
  });

  it('breaks down open, overdue, done and on time by team, busiest first', () => {
    const ins = dates.computeInsights([
      task({ team_name: 'RDH', target_date: '2026-09-01' }),
      task({ team_name: 'RDH' }),
      task({ team_name: null }),
      doneOn(2026, 9, 30, { team_name: 'GDS', target_date: '2026-10-02' }),
    ], TODAY);
    expect(ins.teams).toEqual([
      { name: 'RDH', open: 2, overdue: 1, done90: 0, dated: 0, onTime: 0 },
      { name: 'No team', open: 1, overdue: 0, done90: 0, dated: 0, onTime: 0 },
      { name: 'GDS', open: 0, overdue: 0, done90: 1, dated: 1, onTime: 1 },
    ]);
  });
});
