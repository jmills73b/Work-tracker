// Dates as the person sees them: their local calendar day. Pure; "today" is an argument.

export const dayNumber = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;

// The local calendar date as YYYY-MM-DD.
export const localIso = (date = new Date()) => new Date(dayNumber(date) * 86400000).toISOString().slice(0, 10);

// Whole days from `today` to an ISO date (YYYY-MM-DD); negative once it has passed.
export function daysUntil(iso, today = new Date()) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000 - dayNumber(today));
}

export function shortDate(iso, today = new Date()) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

export const weekdayDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

export function dueInfo(t, today = new Date()) {
  if (!t.target_date) return { label: 'No date', cls: 'muted' };
  const n = daysUntil(t.target_date, today);
  const date = shortDate(t.target_date, today);
  if (t.status === 'done') return { label: date, cls: 'muted' };
  if (n < 0) return { label: `${-n}d overdue`, cls: 'overdue', title: `Due ${date}` };
  if (n === 0) return { label: 'Today', cls: 'soon', title: date };
  if (n === 1) return { label: 'Tomorrow', cls: 'soon', title: date };
  if (n <= 7) return { label: `${date} · ${n}d`, cls: 'soon' };
  return { label: date, cls: '' };
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function relTime(iso) {
  const secs = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(secs);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(secs / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(secs / 3600), 'hour');
  if (abs < 7 * 86400) return rtf.format(Math.round(secs / 86400), 'day');
  return shortDate(iso);
}

export const fullTime = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
