// The morning digest: when it is due, and what it says. Pure: callers pass "now".

export const DEFAULT_SETTINGS = { enabled: true, digest_time: '07:45', time_zone: 'Europe/London', include_tomorrow: true };
// A digest missed by more than this (the Worker was down, the time was changed) waits
// for tomorrow rather than arriving in the evening.
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

export function digestDue(settings, now) {
  if (!settings.enabled) return null;
  const local = localNow(now, settings.time_zone);
  if (settings.last_digest_date === local.date) return null;
  const late = local.minutes - toMinutes(settings.digest_time);
  return late >= 0 && late < LATE_LIMIT_MINUTES ? local.date : null;
}

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// What needs attention on `today` (the user's local date). Tasks come with their subtasks
// attached, as listTasks returns them. Done tasks and done subtasks never count.
export function collectDue(tasks, today, { includeTomorrow = true } = {}) {
  const overdue = [];
  const dueToday = [];
  const tomorrow = [];
  const tomorrowDate = addDays(today, 1);
  for (const t of tasks) {
    if (t.status === 'done') continue;
    const items = [{ title: t.title, date: t.target_date, priority: t.priority }];
    for (const st of t.subtasks || []) {
      if (!st.done) items.push({ title: `${st.title} (${t.title})`, date: st.target_date, priority: t.priority, subtask: true });
    }
    for (const item of items) {
      if (!item.date) continue;
      if (item.date < today) overdue.push({ ...item, daysLate: daysBetween(item.date, today) });
      else if (item.date === today) dueToday.push(item);
      else if (includeTomorrow && item.date === tomorrowDate && !item.subtask && (item.priority === 'urgent' || item.priority === 'high')) tomorrow.push(item);
    }
  }
  overdue.sort((a, b) => b.daysLate - a.daysLate || a.title.localeCompare(b.title));
  return { overdue, dueToday, tomorrow };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The notification, or null when there is nothing to say (no news is no notification).
export function buildDigest(due, today) {
  const { overdue, dueToday, tomorrow } = due;
  if (!overdue.length && !dueToday.length && !tomorrow.length) return null;

  const counts = [];
  if (overdue.length) counts.push(`${overdue.length} overdue`);
  if (dueToday.length) counts.push(`${dueToday.length} due today`);
  if (tomorrow.length) counts.push(`${plural(tomorrow.length, 'priority task')} due tomorrow`);

  const lines = [
    ...overdue.map((i) => `• ${i.title}, ${i.daysLate}d overdue`),
    ...dueToday.map((i) => `• ${i.title}, today`),
    ...tomorrow.map((i) => `• ${i.title}, tomorrow`),
  ];
  const shown = lines.slice(0, MAX_LINES);
  if (lines.length > shown.length) shown.push(`+${lines.length - shown.length} more`);

  return { title: counts.join(' · '), body: shown.join('\n'), tag: `digest-${today}`, url: '/' };
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

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
  if ('digest_time' in input) {
    if (!TIME_RE.test(input.digest_time)) return { error: 'Digest time must be HH:MM' };
    out.digest_time = input.digest_time;
  }
  if ('time_zone' in input) {
    if (!isTimeZone(input.time_zone)) return { error: 'Unknown time zone' };
    out.time_zone = input.time_zone;
  }
  return { value: out };
}
