// What the views show, worked out from the loaded tasks. Pure: no DOM, "today" is an
// argument, so all of it is unit-tested directly.
import { addDays, daysBetween, DONE, HIGH, OPEN, WAITING } from '../shared/rules.js';
import { dayNumber, daysUntil, localIso } from './dates.js';

export const isOpen = (t) => t.status !== DONE;
export const isOverdue = (t, today = new Date()) => isOpen(t) && Boolean(t.target_date) && daysUntil(t.target_date, today) < 0;

// ---------- Today ----------
// Each item is { kind: 'task' | 'step', task, step?, date }. A task appears once, by its
// "when" (planned_on) if it has one, else by its deadline (target_date):
//   - Waiting: to chase once its chase day (its when) has come; until then, by deadline.
//   - Open with a when: today's plan once it comes (unfinished ones carry over), in the
//     next 7 days before that, and out of sight further off, whatever its deadline: moving
//     a task to a later day is a decision to look at it then.
//   - Open with no when: overdue, due today or the next 7 days, by deadline.
// Steps are listed by their own dates, so a step due today shows even when its task is
// due next month.
export const TODAY_GROUPS = [
  { key: 'plan', label: 'Planned for today' },
  { key: 'chase', label: 'To chase' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Due today' },
  { key: 'week', label: 'Next 7 days' },
];

const byDate = (n) => (n < 0 ? 'overdue' : n === 0 ? 'today' : n <= 7 ? 'week' : null);

export function planWeek(tasks, today = new Date()) {
  const todayIso = localIso(today);
  const groups = Object.fromEntries(TODAY_GROUPS.map((g) => [g.key, []]));
  for (const task of tasks) {
    if (!isOpen(task)) continue;
    const chaseDay = task.status === WAITING ? task.planned_on ?? task.waiting_until : null;
    const when = task.status === WAITING ? null : task.planned_on;
    if (chaseDay && chaseDay <= todayIso) groups.chase.push({ kind: 'task', task, date: chaseDay });
    else if (when && when <= todayIso) groups.plan.push({ kind: 'task', task, date: task.target_date || when });
    else if (when) {
      if (byDate(daysUntil(when, today)) === 'week') groups.week.push({ kind: 'task', task, date: when });
    } else if (task.target_date) {
      const g = byDate(daysUntil(task.target_date, today));
      if (g) groups[g].push({ kind: 'task', task, date: task.target_date });
    }
    for (const step of task.subtasks || []) {
      if (step.done || !step.target_date) continue;
      const g = byDate(daysUntil(step.target_date, today));
      if (g) groups[g].push({ kind: 'step', task, step, date: step.target_date });
    }
  }
  const high = (i) => (i.task.priority === HIGH ? 0 : 1);
  for (const list of Object.values(groups)) {
    list.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || high(a) - high(b)
      || (a.kind === 'task' ? 0 : 1) - (b.kind === 'task' ? 0 : 1));
  }
  return groups;
}

// ---------- The daily plan ----------
// What is worth considering for `day`: open tasks (not Waiting: chasing has its own place)
// already planned for it or earlier, with a deadline by then, or flagged High with a
// deadline within a week or none. Tasks moved to a later day stay out. Planned first.
export function planCandidates(tasks, day) {
  const soon = addDays(day, 7);
  return tasks
    .filter((t) => t.status === OPEN && !(t.planned_on && t.planned_on > day) && ((t.planned_on && t.planned_on <= day)
      || (t.target_date && t.target_date <= day)
      || (t.priority === HIGH && (!t.target_date || t.target_date <= soon))))
    .sort((a, b) => Number(b.planned_on === day) - Number(a.planned_on === day)
      || (a.target_date || a.planned_on || '9999').localeCompare(b.target_date || b.planned_on || '9999')
      || (a.priority === HIGH ? 0 : 1) - (b.priority === HIGH ? 0 : 1));
}

// ---------- Tasks ----------
// Open / Waiting / Done (newest first), narrowed by team and the High toggle. A search
// looks through every task whatever the chip says.
export function filterTasks(tasks, { status = OPEN, q = '', highOnly = false, sort = 'due', inTeam = () => true } = {}) {
  const query = q.trim().toLowerCase();
  const out = tasks.filter((t) => {
    if (!inTeam(t)) return false;
    if (highOnly && t.priority !== HIGH) return false;
    if (query) return `${t.title}\n${t.description}\n${t.team_name || ''}\n${t.last_note || ''}`.toLowerCase().includes(query);
    return t.status === status;
  });
  // By the nearer of deadline and when; undated last.
  const day = (t) => [t.target_date, t.planned_on].filter(Boolean).sort()[0] || '9999-99-99';
  const due = (a, b) => day(a).localeCompare(day(b))
    || (a.priority === HIGH ? 0 : 1) - (b.priority === HIGH ? 0 : 1);
  const doneLast = (a, b) => (a.status === DONE) - (b.status === DONE);
  if (!query && status === DONE) return out.sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
  return out.sort((a, b) => doneLast(a, b) || (sort === 'updated' ? b.updated_at.localeCompare(a.updated_at) : due(a, b)));
}

// ---------- Duplicate ----------
// A copy to start a new task from: the same words, flag, team and repeat, with its steps
// unticked. Step dates are kept as offsets from the due date, so they follow whatever
// due date the copy is given; with no due date, steps keep their own dates.
export function duplicateDraft(task, steps) {
  return {
    title: task.title,
    description: task.description || '',
    priority: task.priority,
    team_id: task.team_id ?? null,
    recurrence: task.recurrence ?? null,
    steps: steps.map((st, i) => ({
      id: `draft-${i}`,
      title: st.title,
      done: 0,
      offset_days: task.target_date ? daysBetween(task.target_date, st.target_date) : null,
      target_date: task.target_date ? null : st.target_date ?? null,
    })),
  };
}

// Draft steps with an offset follow the task's due date; ones dated by hand stay.
export function placeDrafts(drafts, dueDate) {
  return drafts.map((st) => (st.offset_days == null ? st : { ...st, target_date: dueDate ? addDays(dueDate, st.offset_days) : null }));
}

// ---------- Review ----------
// Weeks start on Monday; "on time" means done on or before the due date (local time).
export const REVIEW_WEEKS = 12;

export function computeInsights(tasks, today = new Date()) {
  const todayN = dayNumber(today);
  const isoOf = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
  const mondayN = (n) => n - ((new Date(n * 86400000).getUTCDay() + 6) % 7);
  const thisMonday = mondayN(todayN);
  const weeks = Array.from({ length: REVIEW_WEEKS }, (_, i) => ({ start: isoOf(thisMonday - 7 * (REVIEW_WEEKS - 1 - i)), count: 0 }));
  const teams = new Map();
  const team = (t) => {
    const key = t.team_name || 'No team';
    if (!teams.has(key)) teams.set(key, { name: key, open: 0, overdue: 0, done90: 0, dated: 0, onTime: 0 });
    return teams.get(key);
  };
  let done30 = 0;
  let dated = 0;
  let onTime = 0;
  let slipTotal = 0;
  let late = 0;
  let overdue = 0;
  let waiting = 0;
  for (const t of tasks) {
    if (t.status !== DONE) {
      team(t).open += 1;
      if (t.status === WAITING) waiting += 1;
      if (isOverdue(t, today)) { overdue += 1; team(t).overdue += 1; }
      continue;
    }
    if (!t.completed_at) continue;
    const doneN = dayNumber(new Date(t.completed_at));
    const age = todayN - doneN;
    if (age < 30) done30 += 1;
    const w = Math.floor((thisMonday - mondayN(doneN)) / 7);
    if (w >= 0 && w < REVIEW_WEEKS) weeks[REVIEW_WEEKS - 1 - w].count += 1;
    if (age >= 90) continue;
    team(t).done90 += 1;
    if (!t.target_date) continue;
    const [y, m, d] = t.target_date.split('-').map(Number);
    const slip = doneN - Date.UTC(y, m - 1, d) / 86400000; // days late; 0 or less is on time
    dated += 1;
    team(t).dated += 1;
    if (slip <= 0) { onTime += 1; team(t).onTime += 1; } else { late += 1; slipTotal += slip; }
  }
  return {
    done30,
    overdue,
    waiting,
    onTimeRate: dated ? onTime / dated : null,
    dated,
    avgSlip: late ? slipTotal / late : null,
    weeks,
    teams: [...teams.values()].sort((a, b) => b.open - a.open || b.done90 - a.done90 || a.name.localeCompare(b.name)),
  };
}

// ---------- Repeats ----------
export function describeRepeat(r) {
  if (!r) return '';
  const [kind, raw] = r.split(':');
  const n = Number(raw);
  if (kind === 'weekly') return n === 1 ? 'Every week' : `Every ${n} weeks`;
  if (kind === 'monthly') return { 1: 'Every month', 3: 'Every quarter', 12: 'Every year' }[n] || `Every ${n} months`;
  return `${n} day${n === 1 ? '' : 's'} after done`;
}
