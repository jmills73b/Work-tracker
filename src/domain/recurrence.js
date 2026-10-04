// Recurring tasks. A task's `recurrence` is null or one of:
//   weekly:N   every N weeks (N = 1–4), from the task's target date
//   monthly:N  every N months (N = 1, 2, 3, 6 or 12), from the target date, same day of month
//   after:N    N days (1–365) after the day it was marked done
// Marking a recurring task done creates the next one; the done task keeps its history.
import { addDays, addMonths, daysBetween } from '../../public/shared/rules.js';

export { addDays, addMonths };

const PATTERN = /^(?:weekly:[1-4]|monthly:(?:1|2|3|6|12)|after:(?:[1-9]\d?|[1-2]\d\d|3[0-5]\d|36[0-5]))$/;

// null / '' → no repeat. Returns { value } or { error }.
export function validateRecurrence(v) {
  if (v === null || v === '') return { value: null };
  if (typeof v === 'string' && PATTERN.test(v)) return { value: v };
  return { error: 'Invalid repeat setting' };
}

export function describeRecurrence(r) {
  if (!r) return 'does not repeat';
  const [kind, raw] = r.split(':');
  const n = Number(raw);
  if (kind === 'weekly') return n === 1 ? 'every week' : `every ${n} weeks`;
  if (kind === 'monthly') return { 1: 'every month', 3: 'every quarter', 12: 'every year' }[n] ?? `every ${n} months`;
  return n === 1 ? '1 day after done' : `${n} days after done`;
}

// The next target date. `today` is the person's local date when they marked it done.
// Weekly and monthly keep their rhythm from the original date (always counted from it,
// so 31 Jan → 28 Feb → 31 Mar, not 28 Mar) and skip any dates already past, so a task
// finished late doesn't come back already overdue.
export function nextTargetDate(task, today) {
  const [kind, raw] = task.recurrence.split(':');
  const n = Number(raw);
  if (kind === 'after') return addDays(today, n);
  const base = task.target_date || today;
  const step = (k) => (kind === 'weekly' ? addDays(base, 7 * n * k) : addMonths(base, n * k));
  let k = 1;
  while (step(k) <= today) k += 1;
  return step(k);
}

// The next occurrence: the same task with the new date, not done, and its subtasks
// (none ticked) moved by however far the task moved. Subtasks without a date stay without.
export function nextOccurrence(task, subtasks, today) {
  const target = nextTargetDate(task, today);
  const shift = daysBetween(task.target_date || today, target);
  return {
    title: task.title,
    description: task.description || '',
    priority: task.priority,
    team_id: task.team_id ?? null,
    recurrence: task.recurrence,
    status: 'todo',
    target_date: target,
    subtasks: subtasks.map((st) => ({ title: st.title, target_date: st.target_date ? addDays(st.target_date, shift) : null })),
  };
}

// Whether this change should create the next occurrence: it is being marked done, it
// repeats, and it hasn't already made one (so done → reopened → done makes only one).
export function shouldRecur(existing, fields) {
  const recurrence = 'recurrence' in fields ? fields.recurrence : existing.recurrence;
  return fields.status === 'done' && existing.status !== 'done' && Boolean(recurrence) && !existing.next_task_id;
}
