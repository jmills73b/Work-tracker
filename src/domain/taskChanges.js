import { describeRecurrence } from './recurrence.js';
import { PRIORITY_LABELS, STATUS_LABELS } from './taskValidation.js';

// Works out what a PATCH (or a status change on an update) actually changes, plus the lines it adds
// to the task's timeline. Pure: the caller supplies `now` and does the writing.
// Returns { changes: {} , log: [] } when nothing differs.
export function planTaskChanges(existing, fields, now, { teamName = (id) => `team ${id}` } = {}) {
  const changes = {};
  for (const [k, v] of Object.entries(fields)) if (v !== existing[k]) changes[k] = v;
  if (!Object.keys(changes).length) return { changes, log: [] };

  if ('status' in changes) changes.completed_at = changes.status === 'done' ? now : null;

  const log = [];
  if ('status' in changes) log.push(`Status: ${STATUS_LABELS[existing.status]} → ${STATUS_LABELS[changes.status]}`);
  if ('priority' in changes) {
    log.push(`Priority: ${PRIORITY_LABELS[existing.priority]} → ${PRIORITY_LABELS[changes.priority]}`);
  }
  if ('team_id' in changes) {
    const name = (id) => (id == null ? 'none' : teamName(id));
    log.push(`Team: ${name(existing.team_id)} → ${name(changes.team_id)}`);
  }
  if ('target_date' in changes) {
    log.push(`Target date: ${existing.target_date || 'none'} → ${changes.target_date || 'none'}`);
  }
  if ('recurrence' in changes) {
    const say = (r) => (r ? describeRecurrence(r) : 'no');
    log.push(`Repeats: ${say(existing.recurrence)} → ${say(changes.recurrence)}`);
  }

  changes.updated_at = now;
  return { changes, log };
}

// Ticking off a subtask means work has started: a to-do task moves to in progress.
// Returns the status to move to, or null to leave it alone.
export function statusAfterSubtaskChange(task, nowDone) {
  return nowDone && task.status === 'todo' ? 'in_progress' : null;
}
