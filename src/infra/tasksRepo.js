import { planTaskChanges } from '../domain/taskChanges.js';

const TASK_COLUMNS = `
  t.id, t.title, t.description, t.status, t.priority, t.target_date,
  t.category, t.created_at, t.updated_at, t.completed_at,
  (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id) AS subtask_total,
  (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.done = 1) AS subtask_done,
  (SELECT u.note FROM task_updates u WHERE u.task_id = t.id AND u.kind = 'note'
     ORDER BY u.created_at DESC, u.rowid DESC LIMIT 1) AS last_note,
  (SELECT MAX(u.created_at) FROM task_updates u WHERE u.task_id = t.id AND u.kind = 'note') AS last_note_at`;

export async function listTasks(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT ${TASK_COLUMNS} FROM tasks t WHERE t.user_id = ? ORDER BY t.created_at DESC`,
  ).bind(userId).all();
  return results;
}

export function getTask(env, userId, id) {
  return env.DB.prepare(`SELECT ${TASK_COLUMNS} FROM tasks t WHERE t.id = ? AND t.user_id = ?`).bind(id, userId).first();
}

export async function taskDetail(env, userId, id) {
  const task = await getTask(env, userId, id);
  if (!task) return null;
  const [updates, subtasks] = await Promise.all([
    env.DB.prepare(
      `SELECT id, kind, note, status, created_at FROM task_updates
       WHERE task_id = ? AND user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 500`,
    ).bind(id, userId).all(),
    env.DB.prepare(
      `SELECT id, title, done, position, completed_at FROM subtasks
       WHERE task_id = ? AND user_id = ? ORDER BY position, created_at`,
    ).bind(id, userId).all(),
  ]);
  return { task, updates: updates.results, subtasks: subtasks.results };
}

export function insertUpdate(env, { userId, taskId, kind, note, status = null, at }) {
  return env.DB.prepare(
    `INSERT INTO task_updates (id, task_id, user_id, kind, note, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), taskId, userId, kind, note, status, at);
}

export async function createTask(env, userId, t, at) {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tasks (id, user_id, title, description, status, priority, target_date,
                          category, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, userId, t.title, t.description, t.status, t.priority, t.target_date,
      t.category, at, at, t.status === 'done' ? at : null),
    insertUpdate(env, { userId, taskId: id, kind: 'change', note: 'Task created', at }),
    ...(t.subtasks || []).map((title, position) => insertSubtask(env, { userId, taskId: id, title, position, at })),
  ]);
  return id;
}

// Statements for an UPDATE plus change-log lines; [] when nothing actually changed.
// Column names come from validateTask's whitelist and planTaskChanges, never from input.
export function changeStatements(env, userId, existing, fields, at) {
  const { changes, log } = planTaskChanges(existing, fields, at);
  const keys = Object.keys(changes);
  if (!keys.length) return [];
  return [
    env.DB.prepare(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND user_id = ?`)
      .bind(...keys.map((k) => changes[k]), existing.id, userId),
    ...log.map((note) => insertUpdate(env, { userId, taskId: existing.id, kind: 'change', note, at })),
  ];
}

export function touchTask(env, userId, id, at) {
  return env.DB.prepare('UPDATE tasks SET updated_at = ? WHERE id = ? AND user_id = ?').bind(at, id, userId);
}

export async function deleteTask(env, userId, id) {
  const results = await env.DB.batch([
    env.DB.prepare('DELETE FROM task_updates WHERE task_id = ? AND user_id = ?').bind(id, userId),
    env.DB.prepare('DELETE FROM subtasks WHERE task_id = ? AND user_id = ?').bind(id, userId),
    env.DB.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').bind(id, userId),
  ]);
  return results[2].meta.changes > 0;
}

export async function deleteNote(env, userId, taskId, updateId) {
  const { meta } = await env.DB.prepare(
    `DELETE FROM task_updates WHERE id = ? AND task_id = ? AND user_id = ? AND kind = 'note'`,
  ).bind(updateId, taskId, userId).run();
  return meta.changes > 0;
}

// ---------- Subtasks ----------

// position is passed explicitly when creating a task's first batch; otherwise it goes last.
export function insertSubtask(env, { userId, taskId, title, position = null, at }) {
  return env.DB.prepare(
    `INSERT INTO subtasks (id, task_id, user_id, title, done, position, created_at)
     VALUES (?, ?, ?, ?, 0, COALESCE(?, (SELECT COALESCE(MAX(position) + 1, 0) FROM subtasks WHERE task_id = ?)), ?)`,
  ).bind(crypto.randomUUID(), taskId, userId, title, position, taskId, at);
}

export function getSubtask(env, userId, taskId, subtaskId) {
  return env.DB.prepare('SELECT id, title, done FROM subtasks WHERE id = ? AND task_id = ? AND user_id = ?')
    .bind(subtaskId, taskId, userId).first();
}

export function updateSubtask(env, userId, taskId, subtaskId, { title, done }, at) {
  const sets = [];
  const params = [];
  if (title !== undefined) { sets.push('title = ?'); params.push(title); }
  if (done !== undefined) {
    sets.push('done = ?', 'completed_at = ?');
    params.push(done ? 1 : 0, done ? at : null);
  }
  return env.DB.prepare(`UPDATE subtasks SET ${sets.join(', ')} WHERE id = ? AND task_id = ? AND user_id = ?`)
    .bind(...params, subtaskId, taskId, userId);
}

export async function deleteSubtask(env, userId, taskId, subtaskId) {
  const { meta } = await env.DB.prepare('DELETE FROM subtasks WHERE id = ? AND task_id = ? AND user_id = ?')
    .bind(subtaskId, taskId, userId).run();
  return meta.changes > 0;
}
