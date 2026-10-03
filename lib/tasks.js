import { PRIORITY_LABELS, STATUS_LABELS } from './validate.js';

const TASK_COLUMNS = `
  t.id, t.title, t.description, t.status, t.priority, t.progress, t.target_date,
  t.category, t.created_at, t.updated_at, t.completed_at,
  (SELECT u.note FROM task_updates u WHERE u.task_id = t.id AND u.kind = 'note'
     ORDER BY u.created_at DESC, u.rowid DESC LIMIT 1) AS last_note,
  (SELECT MAX(u.created_at) FROM task_updates u WHERE u.task_id = t.id AND u.kind = 'note') AS last_note_at`;

export const now = () => new Date().toISOString();

export async function listTasks(db, owner) {
  const { results } = await db
    .prepare(`SELECT ${TASK_COLUMNS} FROM tasks t WHERE t.owner = ? ORDER BY t.created_at DESC`)
    .bind(owner)
    .all();
  return results;
}

export function getTask(db, owner, id) {
  return db.prepare(`SELECT ${TASK_COLUMNS} FROM tasks t WHERE t.id = ? AND t.owner = ?`).bind(id, owner).first();
}

export async function taskDetail(db, owner, id) {
  const task = await getTask(db, owner, id);
  if (!task) return null;
  const { results } = await db
    .prepare(
      `SELECT id, kind, note, progress, status, created_at FROM task_updates
       WHERE task_id = ? AND owner = ? ORDER BY created_at DESC, rowid DESC LIMIT 500`,
    )
    .bind(id, owner)
    .all();
  return { task, updates: results };
}

export function insertUpdate(db, { owner, taskId, kind, note, progress = null, status = null, at }) {
  return db
    .prepare(
      `INSERT INTO task_updates (id, task_id, owner, kind, note, progress, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), taskId, owner, kind, note, progress, status, at);
}

// Builds an UPDATE for the given (already validated) fields plus change-log entries.
// Returns [] when nothing actually changed. Keeps completed_at in sync with status and bumps progress to 100 when marked done.
export function applyChanges(db, owner, existing, fields, at) {
  const changes = {};
  for (const [k, v] of Object.entries(fields)) if (v !== existing[k]) changes[k] = v;
  if (!Object.keys(changes).length) return [];

  if (changes.status === 'done' && !('progress' in changes) && existing.progress < 100) changes.progress = 100;
  if (changes.progress > 0 && !('status' in changes) && existing.status === 'todo') changes.status = 'in_progress';
  if ('status' in changes) changes.completed_at = changes.status === 'done' ? at : null;

  const log = [];
  if ('status' in changes) {
    log.push(`Status: ${STATUS_LABELS[existing.status]} → ${STATUS_LABELS[changes.status]}`);
  }
  if ('progress' in changes) log.push(`Progress: ${existing.progress}% → ${changes.progress}%`);
  if ('priority' in changes) {
    log.push(`Priority: ${PRIORITY_LABELS[existing.priority]} → ${PRIORITY_LABELS[changes.priority]}`);
  }
  if ('target_date' in changes) {
    log.push(`Target date: ${existing.target_date || 'none'} → ${changes.target_date || 'none'}`);
  }

  changes.updated_at = at;
  const keys = Object.keys(changes); // whitelisted by validateTask / this function
  const stmts = [
    db
      .prepare(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND owner = ?`)
      .bind(...keys.map((k) => changes[k]), existing.id, owner),
  ];
  for (const note of log) stmts.push(insertUpdate(db, { owner, taskId: existing.id, kind: 'change', note, at }));
  return stmts;
}
