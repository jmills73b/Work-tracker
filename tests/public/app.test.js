import { describe, expect, it, vi } from 'vitest';
import { addDays, addMonths, daysBetween, isDate, nextMonday, PRIORITY, STATUS } from '../../public/shared/rules.js';
import { notify } from '../../public/app/api.js';
import { daysUntil, dueInfo } from '../../public/app/dates.js';
import { computeInsights, duplicateDraft, filterTasks, isOverdue, placeDrafts, planCandidates, planWeek } from '../../public/app/model.js';
import { parseQuickAdd } from '../../public/app/parse.js';

// Saturday 3 October 2026, local time.
const TODAY = new Date(2026, 9, 3, 15, 30);
const task = (over = {}) => ({ status: 'todo', target_date: null, priority: 'medium', ...over });

describe('the shared rules', () => {
  it('has three states and a High flag, keeping the stored codes', () => {
    expect(STATUS).toEqual({ todo: 'Open', blocked: 'Waiting', done: 'Done' });
    expect(PRIORITY).toEqual({ high: 'High', medium: 'Normal' });
  });

  it('accepts only real calendar dates', () => {
    expect([isDate('2026-02-28'), isDate('2026-02-30'), isDate('2026-2-1'), isDate(null)]).toEqual([true, false, false, false]);
  });

  it('does date arithmetic in whole days, clamping month ends', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-01', '2026-10-05')).toBe(4);
    expect(daysBetween(null, '2026-10-05')).toBeNull();
  });

  it('gives next week as the coming Monday, even from a Monday or a Sunday', () => {
    expect(nextMonday('2026-10-03')).toBe('2026-10-05'); // Sat
    expect(nextMonday('2026-10-04')).toBe('2026-10-05'); // Sun
    expect(nextMonday('2026-10-05')).toBe('2026-10-12'); // Mon
  });
});

describe('daysUntil', () => {
  it('counts calendar days, ignoring the time of day', () => {
    expect(daysUntil('2026-10-04', new Date(2026, 9, 3, 23, 59))).toBe(1);
  });

  it('counts across a month boundary, and goes negative once the date has passed', () => {
    expect(daysUntil('2026-11-02', TODAY)).toBe(30);
    expect(daysUntil('2026-10-01', TODAY)).toBe(-2);
  });
});

describe('dueInfo', () => {
  it('labels today, tomorrow and overdue in words', () => {
    expect(dueInfo(task({ target_date: '2026-10-03' }), TODAY)).toMatchObject({ label: 'Today', cls: 'soon' });
    expect(dueInfo(task({ target_date: '2026-10-04' }), TODAY)).toMatchObject({ label: 'Tomorrow', cls: 'soon' });
    expect(dueInfo(task({ target_date: '2026-09-30' }), TODAY)).toMatchObject({ label: '3d overdue', cls: 'overdue' });
  });

  it('never shows a finished task as overdue', () => {
    expect(dueInfo(task({ status: 'done', target_date: '2026-09-01' }), TODAY).cls).toBe('muted');
    expect(isOverdue(task({ status: 'done', target_date: '2026-09-01' }), TODAY)).toBe(false);
  });

  it('says "No date" when there is no due date', () => {
    expect(dueInfo(task(), TODAY)).toEqual({ label: 'No date', cls: 'muted' });
    expect(isOverdue(task(), TODAY)).toBe(false);
  });
});

describe('notify', () => {
  it('shows an error toast exactly once', () => {
    // A find-and-replace once made notify() call itself: every error froze the page with
    // a stack overflow instead of showing a message. No other test exercised an error.
    const toast = vi.fn();
    notify(new Error('Save failed'), toast);
    expect(toast.mock.calls).toEqual([['Save failed', 'error']]);
  });

  it('stays quiet for a silent error, such as the redirect to the login page', () => {
    const toast = vi.fn();
    const err = new Error('Signed out');
    err.silent = true;
    notify(err, toast);
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('planWeek (the Today view)', () => {
  const ids = (items) => items.map((i) => (i.kind === 'task' ? i.task.id : `${i.task.id}/${i.step.id}`));

  it('puts open tasks and open steps into overdue, today and the next 7 days', () => {
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
    const g = planWeek(tasks, TODAY);
    expect(ids(g.overdue)).toEqual(['big/s4', 'late']);
    expect(ids(g.today)).toEqual(['now', 'big/s1']);
    expect(ids(g.week)).toEqual(['soon']);
  });

  it('places a task by its when, carrying an unfinished one over, and shows each task once', () => {
    const tasks = [
      task({ id: 'planned', planned_on: '2026-10-03', target_date: '2026-10-03' }),
      task({ id: 'carried', planned_on: '2026-10-01' }),
      task({ id: 'soon', planned_on: '2026-10-05' }),
    ];
    const g = planWeek(tasks, TODAY);
    expect(ids(g.plan)).toEqual(['carried', 'planned']); // oldest first
    expect(ids(g.today)).toEqual([]);
    expect(ids(g.week)).toEqual(['soon']);
  });

  it('keeps a task moved to a later day out of sight until then, even past its deadline', () => {
    // Moving it was a decision to look at it then; the deadline still shows red when it returns.
    const tasks = [
      task({ id: 'snoozed', planned_on: '2026-10-05', target_date: '2026-10-01' }),
      task({ id: 'far', planned_on: '2026-10-30', target_date: '2026-10-02' }),
    ];
    const g = planWeek(tasks, TODAY);
    expect(ids(g.overdue)).toEqual([]);
    expect(ids(g.week)).toEqual(['snoozed']);
    expect(Object.values(g).flat().map((i) => i.task.id)).not.toContain('far');
  });

  it('lists Waiting tasks to chase once their chase day comes, and by deadline until then', () => {
    const tasks = [
      task({ id: 'chase', status: 'blocked', planned_on: '2026-10-03', target_date: '2026-10-01' }),
      task({ id: 'later', status: 'blocked', planned_on: '2026-10-06', target_date: '2026-10-04' }),
      task({ id: 'legacy', status: 'blocked', waiting_until: '2026-10-02' }),
    ];
    const g = planWeek(tasks, TODAY);
    expect(ids(g.chase)).toEqual(['legacy', 'chase']);
    expect(ids(g.overdue)).toEqual([]);
    expect(ids(g.week)).toEqual(['later']);
  });

  it('leaves out done tasks and every step of a done task', () => {
    const g = planWeek([task({ id: 'd', status: 'done', planned_on: '2026-10-03', target_date: '2026-10-03', subtasks: [{ id: 's', done: 0, target_date: '2026-10-03' }] })], TODAY);
    expect(Object.values(g).flat()).toEqual([]);
  });

  it('orders the same day High first, then the task before its steps', () => {
    const tasks = [
      task({ id: 'normal', target_date: '2026-10-03' }),
      task({ id: 'parent', target_date: '2026-10-05', subtasks: [{ id: 's', done: 0, target_date: '2026-10-03' }] }),
      task({ id: 'high', priority: 'high', target_date: '2026-10-03' }),
    ];
    expect(ids(planWeek(tasks, TODAY).today)).toEqual(['high', 'normal', 'parent/s']);
  });
});

describe('planCandidates (the daily plan)', () => {
  it('offers open tasks planned, with a deadline by then, or High; planned first; never Waiting, done or moved later', () => {
    const tasks = [
      task({ id: 'due', target_date: '2026-10-04' }),
      task({ id: 'planned', planned_on: '2026-10-04', target_date: '2026-10-20' }),
      task({ id: 'carried', planned_on: '2026-10-02' }),
      task({ id: 'chase', status: 'blocked', planned_on: '2026-10-04' }),
      task({ id: 'high-undated', priority: 'high' }),
      task({ id: 'high-far', priority: 'high', target_date: '2026-12-01' }),
      task({ id: 'moved-later', planned_on: '2026-10-09', target_date: '2026-10-03' }),
      task({ id: 'later', target_date: '2026-10-20' }),
      task({ id: 'done', status: 'done', target_date: '2026-10-04' }),
    ];
    expect(planCandidates(tasks, '2026-10-04').map((t) => t.id)).toEqual(['planned', 'carried', 'due', 'high-undated']);
  });
});

describe('filterTasks (the Tasks view)', () => {
  const tasks = [
    task({ id: 'open-late', target_date: '2026-10-10' }),
    task({ id: 'open-soon', target_date: '2026-10-05' }),
    task({ id: 'open-high', priority: 'high', target_date: '2026-10-10' }),
    task({ id: 'open-none' }),
    task({ id: 'waiting', status: 'blocked', title: 'Supplier quote' }),
    task({ id: 'done-old', status: 'done', completed_at: '2026-09-01T10:00:00Z' }),
    task({ id: 'done-new', status: 'done', completed_at: '2026-10-02T10:00:00Z', title: 'Quote signed' }),
  ].map((t) => ({ title: t.id, description: '', updated_at: '2026-10-01T00:00:00Z', ...t }));
  const ids = (list) => list.map((t) => t.id);

  it('shows one state, by due date with High first on a tie and undated last', () => {
    expect(ids(filterTasks(tasks, { status: 'todo' }))).toEqual(['open-soon', 'open-high', 'open-late', 'open-none']);
    expect(ids(filterTasks(tasks, { status: 'todo', highOnly: true }))).toEqual(['open-high']);
  });

  it('lists Done newest first', () => {
    expect(ids(filterTasks(tasks, { status: 'done' }))).toEqual(['done-new', 'done-old']);
  });

  it('searches every task whatever the chip, with done ones last', () => {
    expect(ids(filterTasks(tasks, { status: 'todo', q: 'quote' }))).toEqual(['waiting', 'done-new']);
  });

  it('narrows by team', () => {
    expect(ids(filterTasks(tasks, { status: 'blocked', inTeam: () => false }))).toEqual([]);
  });
});

describe('duplicateDraft', () => {
  it('copies the words, flag, team and repeat, with steps unticked and their dates kept relative to the due date', () => {
    const d = duplicateDraft(
      { title: 'Payroll', description: 'Run it', priority: 'high', team_id: 2, recurrence: 'monthly:1', target_date: '2026-10-28' },
      [{ title: 'Check hours', done: 1, target_date: '2026-10-25' }, { title: 'Submit', done: 0, target_date: null }],
    );
    expect(d).toMatchObject({ title: 'Payroll', description: 'Run it', priority: 'high', team_id: 2, recurrence: 'monthly:1' });
    expect(d.steps.map((s) => [s.title, s.done, s.offset_days])).toEqual([['Check hours', 0, -3], ['Submit', 0, null]]);
    expect(placeDrafts(d.steps, '2026-11-28').map((s) => s.target_date)).toEqual(['2026-11-25', null]);
    expect(placeDrafts(d.steps, null)[0].target_date).toBeNull();
  });

  it('keeps step dates as they are when the task has no due date', () => {
    const d = duplicateDraft({ title: 'x', priority: 'medium' }, [{ title: 'a', done: 0, target_date: '2026-10-09' }]);
    expect(d.steps[0]).toMatchObject({ offset_days: null, target_date: '2026-10-09' });
  });
});

describe('parseQuickAdd', () => {
  // Saturday 3 October 2026; and Monday 5 October for the "next" rules.
  const SAT = new Date(2026, 9, 3, 15);
  const MON = new Date(2026, 9, 5, 9);

  const TEAMS = [{ id: 1, name: 'Dev Ops' }, { id: 2, name: 'RDH' }, { id: 3, name: 'GDS' }];

  it('picks out a weekday, a priority and a team, leaving the title', () => {
    expect(parseQuickAdd('Board deck fri !high #RDH', SAT, TEAMS))
      .toEqual({ title: 'Board deck', date: '2026-10-09', deadline: false, priority: 'high', team_id: 2, team_name: 'RDH' });
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
    expect(parseQuickAdd('Pay invoice 12/10', SAT).date).toBe('2026-10-12');
  });

  it('rolls a day and month that has already passed into next year', () => {
    expect(parseQuickAdd('Renew insurance 2 Jan', SAT).date).toBe('2027-01-02');
  });

  it('leaves an impossible date in the title instead of guessing', () => {
    expect(parseQuickAdd('Fix 31/02 thing', SAT)).toMatchObject({ title: 'Fix 31/02 thing', date: null });
  });

  it("does not mistake a name or a possessive for a date", () => {
    // "tom" and "today's" were the obvious false positives.
    expect(parseQuickAdd('Call Tom tomorrow', SAT)).toMatchObject({ title: 'Call Tom', date: '2026-10-04' });
    expect(parseQuickAdd("Today's standup notes", SAT)).toMatchObject({ title: "Today's standup notes", date: null });
  });

  it('reads "fri" as the coming Friday, and as today on a Friday', () => {
    expect(parseQuickAdd('x fri', MON).date).toBe('2026-10-09');
    expect(parseQuickAdd('x fri', new Date(2026, 9, 9, 8)).date).toBe('2026-10-09');
  });

  it('reads "next fri" as the Friday of next week', () => {
    expect(parseQuickAdd('x next fri', MON).date).toBe('2026-10-16');
    expect(parseQuickAdd('x next fri', SAT).date).toBe('2026-10-09');
  });

  it('understands relative phrases', () => {
    expect(parseQuickAdd('x in 2 weeks', SAT).date).toBe('2026-10-17');
    expect(parseQuickAdd('x next week', SAT).date).toBe('2026-10-05');
    expect(parseQuickAdd('x eom', SAT).date).toBe('2026-10-31');
    expect(parseQuickAdd('x eow', MON).date).toBe('2026-10-09');
  });

  it('clamps "in 1 month" from the 31st to the end of a shorter month', () => {
    expect(parseQuickAdd('x in 1 month', new Date(2026, 0, 31, 9)).date).toBe('2026-02-28');
  });

  it('uses the first date and priority it finds and leaves later ones in the title', () => {
    expect(parseQuickAdd('Move fri to mon !low !high', SAT)).toMatchObject({ title: 'Move to mon !high', date: '2026-10-09', priority: 'medium' });
  });

  it('gives an empty title for a line that is only tokens, so nothing is saved', () => {
    expect(parseQuickAdd('tomorrow !high', SAT).title).toBe('');
  });

  it('ignores #words when there are no teams at all', () => {
    expect(parseQuickAdd('Plan #RDH', SAT)).toMatchObject({ title: 'Plan #RDH', team_id: null });
  });

  it('reads a day as when to do it, and "by" or "due" a day as a deadline', () => {
    expect(parseQuickAdd('Call Sam fri', SAT)).toMatchObject({ title: 'Call Sam', date: '2026-10-09', deadline: false });
    expect(parseQuickAdd('Board pack by fri', SAT)).toMatchObject({ title: 'Board pack', date: '2026-10-09', deadline: true });
    expect(parseQuickAdd('Invoice due 12/10', SAT)).toMatchObject({ title: 'Invoice', date: '2026-10-12', deadline: true });
  });

  it('reads the old priority marks onto the High flag', () => {
    for (const mark of ['!high', '!urgent', '!!', '!!!']) expect(parseQuickAdd(`x ${mark}`, SAT).priority).toBe('high');
    for (const mark of ['!low', '!normal', '!med']) expect(parseQuickAdd(`x ${mark}`, SAT).priority).toBe('medium');
  });
});

describe('computeInsights', () => {
  // TODAY is Saturday 3 Oct 2026; its week starts Monday 28 Sep.
  const doneOn = (y, m, d, over = {}) => task({ status: 'done', completed_at: new Date(y, m - 1, d, 15).toISOString(), ...over });

  it('counts done per Monday-start week, oldest first, for the last 12 weeks', () => {
    const ins = computeInsights([doneOn(2026, 9, 28), doneOn(2026, 10, 3), doneOn(2026, 9, 27), doneOn(2026, 7, 1)], TODAY);
    expect(ins.weeks).toHaveLength(12);
    expect(ins.weeks.at(-1)).toEqual({ start: '2026-09-28', count: 2 });
    expect(ins.weeks.at(-2)).toEqual({ start: '2026-09-21', count: 1 });
    expect(ins.weeks[0].start).toBe('2026-07-13');
    expect(ins.weeks.reduce((n, w) => n + w.count, 0)).toBe(3);
  });

  it('works out on-time rate and average slip from dated tasks done in the last 90 days', () => {
    const ins = computeInsights([
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
    const ins = computeInsights([task({ target_date: '2026-09-01' })], TODAY);
    expect([ins.onTimeRate, ins.avgSlip, ins.overdue]).toEqual([null, null, 1]);
  });

  it('counts tasks waiting on someone else', () => {
    expect(computeInsights([task({ status: 'blocked' }), task()], TODAY).waiting).toBe(1);
  });

  it('breaks down open, overdue, done and on time by team, busiest first', () => {
    const ins = computeInsights([
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
