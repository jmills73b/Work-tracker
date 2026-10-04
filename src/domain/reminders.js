import { addDays, daysBetween, DONE, HIGH, WAITING } from '../../public/shared/rules.js';

// Reminder digests: when one is due, and what it says. Pure: callers pass "now".
// Up to three times a day. A time from 17:00 on is an evening digest, which also looks
// ahead to everything due tomorrow.

export const DEFAULT_SETTINGS = { enabled: true, digest_times: ['07:30', '10:00', '20:00'], time_zone: 'Europe/London', include_tomorrow: true };
export const MAX_TIMES = 3;
export const EVENING_FROM = '17:00';
// A digest missed by more than this (the Worker was down, the time was changed) is
// skipped rather than arriving hours later.
const LATE_LIMIT_MINUTES = 180;
const MAX_LINES = 4;

export function isTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// The wall-clock date and minute of the day in a time zone.
export function localNow(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// The reminder to send now, as { date, time, slot }, or null. The latest time that has
// passed within the late limit wins (if 07:30 was missed and it's 10:05, only the 10:00
// one goes), and a slot is sent once: `slot` ('YYYY-MM-DD HH:MM') must be later than the
// last one handled.
export function digestDue(settings, now) {
  if (!settings.enabled) return null;
  const local = localNow(now, settings.time_zone);
  const passed = settings.digest_times.filter((t) => {
    const late = local.minutes - toMinutes(t);
    return late >= 0 && late < LATE_LIMIT_MINUTES;
  });
  if (!passed.length) return null;
  const time = passed[passed.length - 1];
  const slot = `${local.date} ${time}`;
  if (settings.last_digest_slot && settings.last_digest_slot >= slot) return null;
  return { date: local.date, time, slot };
}

export const isEvening = (time) => time >= EVENING_FROM;


// What needs attention on `today` (the user's local date). Tasks come with their subtasks
// attached, as listTasks returns them. Done tasks and done subtasks never count.
// In the evening, `allTomorrow` lists everything due tomorrow (steps too), not just High
// tasks. A Waiting task whose chase day (planned_on) has come is listed to chase.
// An open task's "when" (planned_on) decides its day: planned for today (or carried over)
// counts as today unless its deadline is already today or past; moved to a later day, it
// keeps quiet until then, whatever its deadline.
export function collectDue(tasks, today, { includeTomorrow = true, allTomorrow = false } = {}) {
  const overdue = [];
  const dueToday = [];
  const tomorrow = [];
  const chase = [];
  const tomorrowDate = addDays(today, 1);
  for (const t of tasks) {
    if (t.status === DONE) continue;
    let date = t.target_date;
    if (t.status === WAITING) {
      const chaseDay = t.planned_on ?? t.waiting_until;
      if (chaseDay && chaseDay <= today) chase.push({ title: t.title, date: chaseDay });
    } else if (t.planned_on && t.planned_on > today) {
      date = t.planned_on === tomorrowDate ? tomorrowDate : null;
    } else if (t.planned_on && !(date && date <= today)) {
      date = today;
    }
    const items = [{ title: t.title, date, priority: t.priority }];
    for (const st of t.subtasks || []) {
      if (!st.done) items.push({ title: `${st.title} (${t.title})`, date: st.target_date, priority: t.priority, subtask: true });
    }
    for (const item of items) {
      if (!item.date) continue;
      if (item.date < today) overdue.push({ ...item, daysLate: daysBetween(item.date, today) });
      else if (item.date === today) dueToday.push(item);
      else if (item.date === tomorrowDate && (allTomorrow
        || (includeTomorrow && !item.subtask && item.priority === HIGH))) tomorrow.push(item);
    }
  }
  overdue.sort((a, b) => b.daysLate - a.daysLate || a.title.localeCompare(b.title));
  return { overdue, dueToday, tomorrow, chase };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The notification, or null when there is nothing to say (no news is no notification).
// Each digest replaces the last one on the device (same tag), so the phone shows only
// the latest picture.
// The evening one opens the "plan tomorrow" screen when tapped.
export function buildDigest(due, today, { evening = false } = {}) {
  const { overdue, dueToday, tomorrow, chase = [] } = due;
  if (!overdue.length && !dueToday.length && !tomorrow.length && !chase.length) return null;

  const counts = [];
  if (overdue.length) counts.push(`${overdue.length} overdue`);
  if (dueToday.length) counts.push(`${dueToday.length} ${evening ? 'still due today' : 'due today'}`);
  if (tomorrow.length) counts.push(evening ? `${tomorrow.length} due tomorrow` : `${plural(tomorrow.length, 'High task')} due tomorrow`);
  if (chase.length) counts.push(`${chase.length} to chase`);

  const lines = [
    ...overdue.map((i) => `• ${i.title}, ${i.daysLate}d overdue`),
    ...dueToday.map((i) => `• ${i.title}, today`),
    ...chase.map((i) => `• Chase: ${i.title}`),
    ...tomorrow.map((i) => `• ${i.title}, tomorrow`),
  ];
  const shown = lines.slice(0, MAX_LINES);
  if (lines.length > shown.length) shown.push(`+${lines.length - shown.length} more`);

  return { title: counts.join(' · '), body: shown.join('\n'), tag: `digest-${today}`, url: evening ? '/?plan=tomorrow' : '/' };
}

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Stored as 'HH:MM,HH:MM'; anything unreadable falls back to the default times.
export function parseTimes(raw) {
  const times = String(raw || '').split(',').filter((t) => TIME_RE.test(t));
  return times.length ? [...new Set(times)].sort().slice(0, MAX_TIMES) : [...DEFAULT_SETTINGS.digest_times];
}

// PUT body for the settings form. Missing keys keep their current value.
export function validateSettings(input, current = DEFAULT_SETTINGS) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Invalid request body' };
  const out = { ...current };
  if ('enabled' in input) {
    if (typeof input.enabled !== 'boolean') return { error: 'enabled must be true or false' };
    out.enabled = input.enabled;
  }
  if ('include_tomorrow' in input) {
    if (typeof input.include_tomorrow !== 'boolean') return { error: 'include_tomorrow must be true or false' };
    out.include_tomorrow = input.include_tomorrow;
  }
  if ('digest_times' in input) {
    const times = input.digest_times;
    if (!Array.isArray(times) || !times.length || times.length > MAX_TIMES || !times.every((t) => typeof t === 'string' && TIME_RE.test(t))) {
      return { error: `Choose between 1 and ${MAX_TIMES} reminder times (HH:MM)` };
    }
    out.digest_times = [...new Set(times)].sort();
  }
  if ('time_zone' in input) {
    if (!isTimeZone(input.time_zone)) return { error: 'Unknown time zone' };
    out.time_zone = input.time_zone;
  }
  return { value: out };
}
