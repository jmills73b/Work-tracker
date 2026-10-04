import { STATUS, WAITING } from '../../public/shared/rules.js';
import { describeRecurrence } from './recurrence.js';

// Works out what a PATCH actually changes, plus the lines it adds to the task's log. Pure: the caller supplies `now` and does the writing.
// Returns { changes: {} , log: [] } when nothing differs.
// `chased: true` is not a column: it records that you followed up, alongside the new
// chase day (planned_on), so the log shows how often you have asked.
export function planTaskChanges(existing, fields, now, { teamName = (id) => `team ${id}` } = {}) {
  const { chased = false, ...rest } = fields;
  const changes = {};
  for (const [k, v] of Object.entries(rest)) if (v !== existing[k]) changes[k] = v;
  if (!Object.keys(changes).length && !chased) return { changes, log: [] };

  if ('status' in changes) changes.completed_at = changes.status === 'done' ? now : null;

  const log = [];
  const when = 'planned_on' in changes ? changes.planned_on : existing.planned_on;
  if ('status' in changes) log.push(`Status: ${label(STATUS, existing.status)} → ${label(STATUS, changes.status)}`);
  if (chased) log.push(when ? `Chased · next chase ${when}` : 'Chased');
  else if (changes.status === WAITING && when) log.push(`Chase on ${when}`);
  if ('priority' in changes) {
    log.push(changes.priority === 'high' ? 'Marked High' : 'High removed');
  }
  if ('team_id' in changes) {
    const name = (id) => (id == null ? 'none' : teamName(id));
    log.push(`Team: ${name(existing.team_id)} → ${name(changes.team_id)}`);
  }
  if ('target_date' in changes) {
    log.push(`Deadline: ${existing.target_date || 'none'} → ${changes.target_date || 'none'}`);
  }
  if ('recurrence' in changes) {
    const say = (r) => (r ? describeRecurrence(r) : 'no');
    log.push(`Repeats: ${say(existing.recurrence)} → ${say(changes.recurrence)}`);
  }

  changes.updated_at = now;
  return { changes, log };
}

// Older rows may hold a code from before the three states ('in_progress', 'urgent').
function label(map, code) {
  return map[code] ?? (code === 'in_progress' ? STATUS.todo : code);
}
