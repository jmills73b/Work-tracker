// Rules shared by the browser and the Worker: one definition of each, loaded by both
// (the page imports this file as a module; the Worker bundles it). No DOM, no clock:
// anything that depends on "today" takes it as an argument.

// ---------- States ----------
// Three states. The stored codes predate the three-state model (the database only allows
// the old four), so 'todo' means Open and 'blocked' means Waiting. Only labels change.
export const STATUS = { todo: 'Open', blocked: 'Waiting', done: 'Done' };
export const STATUSES = Object.keys(STATUS);
export const OPEN = 'todo';
export const WAITING = 'blocked';
export const DONE = 'done';

// ---------- Priority ----------
// A High flag; everything else is normal. Stored as 'high' / 'medium' for the same reason.
export const PRIORITY = { high: 'High', medium: 'Normal' };
export const PRIORITIES = Object.keys(PRIORITY);
export const HIGH = 'high';
export const NORMAL = 'medium';

// ---------- Dates (YYYY-MM-DD strings, calendar arithmetic in UTC) ----------
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;
const toDay = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

export function isDate(v) {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function addDays(iso, n) {
  return new Date((toDay(iso) + n) * DAY_MS).toISOString().slice(0, 10);
}

// Same day of the month, n months on; a day that month doesn't have becomes its last
// day (31 Jan + 1 month = 28 or 29 Feb).
export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return first.toISOString().slice(0, 10);
}

// Whole days from `from` to `to`: negative when `to` is earlier; null when either is missing.
export function daysBetween(from, to) {
  if (!from || !to) return null;
  return Math.round(toDay(to) - toDay(from));
}

// The Monday on or after `iso` +1 day: "next week" when rescheduling.
export function nextMonday(iso) {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, ((8 - dow) % 7) || 7);
}
