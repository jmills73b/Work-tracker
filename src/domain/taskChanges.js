import { PRIORITY_LABELS, STATUS_LABELS } from './taskValidation.js';

// Works out what a PATCH (or a progress update) actually changes, plus the lines it adds
// to the task's timeline. Pure: the caller supplies `now` and does the writing.
// Returns { changes: {} , log: [] } when nothing differs.
export function planTaskChanges(existing, fields, now) {
  const changes = {};
  for (const [k, v] of Object.entries(fields)) if (v !== existing[k]) changes[k] = v;
  if (!Object.keys(changes).length) return { changes, log: [] };

  if (changes.status === 'done' && !('progress' in changes) && existing.progress < 100) changes.progress = 100;
  if (changes.progress > 0 && !('status' in changes) && existing.status === 'todo') changes.status = 'in_progress';
  if ('status' in changes) changes.completed_at = changes.status === 'done' ? now : null;

  const log = [];
  if ('status' in changes) log.push(`Status: ${STATUS_LABELS[existing.status]} → ${STATUS_LABELS[changes.status]}`);
  if ('progress' in changes) log.push(`Progress: ${existing.progress}% → ${changes.progress}%`);
  if ('priority' in changes) {
    log.push(`Priority: ${PRIORITY_LABELS[existing.priority]} → ${PRIORITY_LABELS[changes.priority]}`);
  }
  if ('target_date' in changes) {
    log.push(`Target date: ${existing.target_date || 'none'} → ${changes.target_date || 'none'}`);
  }

  changes.updated_at = now;
  return { changes, log };
}
