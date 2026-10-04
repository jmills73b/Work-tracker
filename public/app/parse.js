// Quick add: one line in, task fields out — "Board deck fri !high #RDH". Recognised words
// are taken out of the title; the preview shows what was understood before anything is
// saved. Pure: "today" and the team list are arguments.
import { HIGH, NORMAL } from '../shared/rules.js';

const QA_WEEKDAYS = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const QA_MONTHS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
// A High flag: !high (and the old !urgent, !! and !!!) set it; !low, !med and !normal are
// accepted and mean normal, so habits from before the flag still read cleanly.
const QA_PRIORITY = { '!!!': HIGH, '!urgent': HIGH, '!u': HIGH, '!!': HIGH, '!high': HIGH, '!h': HIGH, '!normal': NORMAL, '!medium': NORMAL, '!med': NORMAL, '!m': NORMAL, '!low': NORMAL, '!l': NORMAL };
const QA_DAY = '(?:(?:by|on|due)\\s+)?';
const QA_WEEKDAY_RE = Object.keys(QA_WEEKDAYS).sort((a, b) => b.length - a.length).join('|');
const QA_MONTH_RE = Object.keys(QA_MONTHS).sort((a, b) => b.length - a.length).join('|');

// A real calendar date or null (31 Feb is refused rather than rolled into March).
function qaIso(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null;
}

const qaPlusDays = (today, n) => qaIso(today.getFullYear(), today.getMonth() + 1, today.getDate()) && new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + n)).toISOString().slice(0, 10);

// A day and month with no year: this year, or next year once that date has passed.
function qaNextYearly(today, m, d) {
  const thisYear = qaIso(today.getFullYear(), m, d);
  if (!thisYear) return null;
  return thisYear < qaPlusDays(today, 0) ? qaIso(today.getFullYear() + 1, m, d) : thisYear;
}

// `teams` is [{ id, name }]: "#RDH", "#devops" or "#Dev_Ops" pick a team; a #word that
// names no team is left in the title, where the preview shows it wasn't understood.
// A date is the task's "when" (the day you'll act), unless it follows "by" or "due":
// "Report by fri" sets a deadline instead (deadline: true).
export function parseQuickAdd(text, today = new Date(), teams = []) {
  const out = { title: '', date: null, deadline: false, priority: null, team_id: null, team_name: null };
  const qaKey = (name) => String(name).toLowerCase().replace(/[\s_-]+/g, '');
  let rest = ` ${String(text).replace(/\s+/g, ' ')} `;
  const take = (re, fn) => {
    rest = rest.replace(re, (...m) => {
      const kept = fn(...m);
      return kept === false ? m[0] : ' ';
    });
  };
  const date = (re, fn) => take(re, (...m) => {
    if (out.date) return false;
    const iso = fn(...m);
    if (!iso) return false;
    out.date = iso;
    out.deadline = /^\s(?:by|due)\s/i.test(m[0]);
    return true;
  });

  take(/\s(!!!|!!|!(?:urgent|high|normal|medium|med|low|u|h|m|l))(?=\s)/i, (_, p) => {
    if (out.priority) return false;
    out.priority = QA_PRIORITY[p.toLowerCase()];
    return true;
  });
  take(/\s#([\p{L}\p{N}_-]+)(?=\s)/u, (_, c) => {
    if (out.team_id) return false;
    const team = teams.find((tm) => qaKey(tm.name) === qaKey(c));
    if (!team) return false;
    out.team_id = team.id;
    out.team_name = team.name;
    return true;
  });

  const y4 = (y) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  date(new RegExp(`\\s${QA_DAY}(\\d{1,2})/(\\d{1,2})(?:/(\\d{2}|\\d{4}))?(?=\\s)`, 'i'),
    (_, d, m, y) => (y ? qaIso(y4(y), Number(m), Number(d)) : qaNextYearly(today, Number(m), Number(d))));
  date(new RegExp(`\\s${QA_DAY}(\\d{1,2})(?:st|nd|rd|th)?\\s+(${QA_MONTH_RE})(?:\\s+(\\d{4}))?(?=\\s)`, 'i'),
    (_, d, mon, y) => (y ? qaIso(Number(y), QA_MONTHS[mon.toLowerCase()], Number(d)) : qaNextYearly(today, QA_MONTHS[mon.toLowerCase()], Number(d))));
  date(new RegExp(`\\s${QA_DAY}(${QA_MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?=\\s)`, 'i'),
    (_, mon, d, y) => (y ? qaIso(Number(y), QA_MONTHS[mon.toLowerCase()], Number(d)) : qaNextYearly(today, QA_MONTHS[mon.toLowerCase()], Number(d))));
  date(new RegExp(`\\s${QA_DAY}(today|tonight)(?=\\s)`, 'i'), () => qaPlusDays(today, 0));
  date(new RegExp(`\\s${QA_DAY}(tomorrow|tmrw|tmr)(?=\\s)`, 'i'), () => qaPlusDays(today, 1));
  date(new RegExp(`\\s${QA_DAY}in\\s+(\\d{1,3})\\s+(days?|weeks?|months?)(?=\\s)`, 'i'), (_, n, unit) => {
    const k = Number(n);
    if (/^day/i.test(unit)) return qaPlusDays(today, k);
    if (/^week/i.test(unit)) return qaPlusDays(today, 7 * k);
    const m0 = today.getMonth() + k; // same day k months on, clamped to the month's last day
    const last = new Date(Date.UTC(today.getFullYear(), m0 + 1, 0)).getUTCDate();
    return new Date(Date.UTC(today.getFullYear(), m0, Math.min(today.getDate(), last))).toISOString().slice(0, 10);
  });
  date(new RegExp(`\\s${QA_DAY}next\\s+week(?=\\s)`, 'i'), () => qaPlusDays(today, ((1 - today.getDay() + 7) % 7) || 7));
  date(new RegExp(`\\s${QA_DAY}(?:eow|end\\s+of\\s+(?:the\\s+)?week)(?=\\s)`, 'i'), () => qaPlusDays(today, (5 - today.getDay() + 7) % 7));
  date(new RegExp(`\\s${QA_DAY}(?:eom|end\\s+of\\s+(?:the\\s+)?month)(?=\\s)`, 'i'),
    () => new Date(Date.UTC(today.getFullYear(), today.getMonth() + 1, 0)).toISOString().slice(0, 10));
  // "fri" = the coming Friday (today if it is Friday). "next fri" = the Friday of next
  // week (Monday-start): from a Saturday that is the coming one, from a Monday a week later.
  date(new RegExp(`\\s${QA_DAY}(next\\s+)?(${QA_WEEKDAY_RE})(?=\\s)`, 'i'), (_, next, name) => {
    const dow = today.getDay();
    let diff = (QA_WEEKDAYS[name.toLowerCase()] - dow + 7) % 7;
    if (next) {
      const daysToSunday = (7 - dow) % 7;
      if (diff <= daysToSunday) diff += 7;
    }
    return qaPlusDays(today, diff);
  });

  out.title = rest.replace(/\s+/g, ' ').trim();
  return out;
}
