import { planTaskChanges } from '../domain/taskChanges.js';

const TASK_COLUMNS = `
  t.id, t.title, t.description, t.status, t.priority, t.target_date,
  t.team_id, (SELECT tm.name FROM teams tm WHERE tm.id = t.team_id) AS team_name, t.recurrence, t.next_task_id, t.waiting_until, t.planned_on,
  t.created_at, t.updated_at, t.completed_at,
  (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id) AS subtask_total,
  (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.done = 1) AS subtask_done,
  (SELECT u.note FROM task_updates u WHERE u.task_id = t.id AND u.kind = 'note'
     ORDER BY u.created_at DESC, u.rowid DESC LIMIT 1) AS last_note,
  (SELECT MAX(u.created_at) FROM task_updates u WHERE u.task_id = t.id AND u.kind = 'note') AS last_note_at`;

// "Progress: 30% → 60%" lines were logged before percentages were retired. They stay in
// the database (history is never rewritten) but are no longer shown.
export const RETIRED_PROGRESS_LINE = "(kind = 'change' AND note LIKE 'Progress: %')";

const SUBTASK_COLUMNS = 'id, task_id, title, done, position, target_date, completed_at';

// Every task with its subtasks attached, from two queries rather than one per task.
export async function listTasks(env, userId) {
  const [tasks, subtasks] = await Promise.all([
    env.DB.prepare(`SELECT ${TASK_COLUMNS} FROM tasks t WHERE t.user_id = ? ORDER BY t.created_at DESC`).bind(userId).all(),
    env.DB.prepare(`SELECT ${SUBTASK_COLUMNS} FROM subtasks WHERE user_id = ? ORDER BY task_id, position, created_at`).bind(userId).all(),
  ]);
  return attachSubtasks(tasks.results, subtasks.results);
}

export function attachSubtasks(tasks, subtasks) {
  const byTask = new Map();
  for (const { task_id: taskId, ...st } of subtasks) {
    if (!byTask.has(taskId)) byTask.set(taskId, []);
    byTask.get(taskId).push(st);
  }
  return tasks.map((t) => ({ ...t, subtasks: byTask.get(t.id) ?? [] }));
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
       WHERE task_id = ? AND user_id = ? AND NOT ${RETIRED_PROGRESS_LINE}
       ORDER BY created_at DESC, rowid DESC LIMIT 500`,
    ).bind(id, userId).all(),
    env.DB.prepare(
      `SELECT ${SUBTASK_COLUMNS} FROM subtasks
       WHERE task_id = ? AND user_id = ? ORDER BY position, created_at`,
    ).bind(id, userId).all(),
  ]);
  const list = subtasks.results.map(({ task_id: _taskId, ...st }) => st);
  return { task: { ...task, subtasks: list }, updates: updates.results, subtasks: list };
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
                          team_id, recurrence, waiting_until, planned_on, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, userId, t.title, t.description, t.status, t.priority, t.target_date,
      t.team_id, t.recurrence ?? null, t.waiting_until ?? null, t.planned_on ?? null, at, at, t.status === 'done' ? at : null),
    insertUpdate(env, { userId, taskId: id, kind: 'change', note: 'Task created', at }),
    ...(t.subtasks || []).map((st, position) => insertSubtask(env, { userId, taskId: id, ...st, position, at })),
  ]);
  return id;
}

// Marking a recurring task done: the statements that create the next occurrence (same
// batch as the status change) and point the done task at it. Returns { id, statements }.
export function nextOccurrenceStatements(env, userId, existing, next, at) {
  const id = crypto.randomUUID();
  return {
    id,
    statements: [
      env.DB.prepare(
        `INSERT INTO tasks (id, user_id, title, description, status, priority, target_date,
                            team_id, recurrence, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?, NULL)`,
      ).bind(id, userId, next.title, next.description, next.priority, next.target_date, next.team_id, next.recurrence, at, at),
      insertUpdate(env, { userId, taskId: id, kind: 'change', note: 'Created from the previous occurrence', at }),
      ...next.subtasks.map((st, position) => insertSubtask(env, { userId, taskId: id, ...st, position, at })),
      env.DB.prepare('UPDATE tasks SET next_task_id = ? WHERE id = ? AND user_id = ?').bind(id, existing.id, userId),
      insertUpdate(env, { userId, taskId: existing.id, kind: 'change', note: `Next occurrence created, due ${next.target_date}`, at }),
    ],
  };
}

export async function listSubtasks(env, userId, taskId) {
  const { results } = await env.DB.prepare(
    `SELECT ${SUBTASK_COLUMNS} FROM subtasks WHERE task_id = ? AND user_id = ? ORDER BY position, created_at`,
  ).bind(taskId, userId).all();
  return results;
}

// Statements for an UPDATE plus change-log lines; [] when nothing actually changed.
// Column names come from validateTask's whitelist and planTaskChanges, never from input.
export function changeStatements(env, userId, existing, fields, at, options) {
  const { changes, log } = planTaskChanges(existing, fields, at, options);
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
export function insertSubtask(env, { userId, taskId, title, target_date: targetDate = null, position = null, at }) {
  return env.DB.prepare(
    `INSERT INTO subtasks (id, task_id, user_id, title, done, position, target_date, created_at)
     VALUES (?, ?, ?, ?, 0, COALESCE(?, (SELECT COALESCE(MAX(position) + 1, 0) FROM subtasks WHERE task_id = ?)), ?, ?)`,
  ).bind(crypto.randomUUID(), taskId, userId, title, position, taskId, targetDate, at);
}

export function getSubtask(env, userId, taskId, subtaskId) {
  return env.DB.prepare('SELECT id, title, done FROM subtasks WHERE id = ? AND task_id = ? AND user_id = ?')
    .bind(subtaskId, taskId, userId).first();
}

export function updateSubtask(env, userId, taskId, subtaskId, fields, at) {
  const { title, done } = fields;
  const sets = [];
  const params = [];
  if (title !== undefined) { sets.push('title = ?'); params.push(title); }
  // `in`, not `!== undefined`: a null target_date is a request to clear it.
  if ('target_date' in fields) { sets.push('target_date = ?'); params.push(fields.target_date); }
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

// Every task of one user with its steps and whole log (oldest first): the export.
export async function exportRows(env, userId) {
  const [tasks, steps, log] = await Promise.all([
    env.DB.prepare(`SELECT ${TASK_COLUMNS} FROM tasks t WHERE t.user_id = ? ORDER BY t.created_at`).bind(userId).all(),
    env.DB.prepare(`SELECT ${SUBTASK_COLUMNS} FROM subtasks WHERE user_id = ? ORDER BY task_id, position, created_at`).bind(userId).all(),
    env.DB.prepare(
      `SELECT task_id, kind, note, created_at FROM task_updates WHERE user_id = ? AND NOT ${RETIRED_PROGRESS_LINE}
       ORDER BY created_at, rowid`,
    ).bind(userId).all(),
  ]);
  const group = (rows) => {
    const by = new Map();
    for (const { task_id: taskId, ...r } of rows) {
      if (!by.has(taskId)) by.set(taskId, []);
      by.get(taskId).push(r);
    }
    return by;
  };
  const stepsBy = group(steps.results);
  const logBy = group(log.results);
  return tasks.results.map(({ subtask_total: _a, subtask_done: _b, last_note: _c, last_note_at: _d, next_task_id: _e, ...t }) => ({
    ...t,
    steps: (stepsBy.get(t.id) ?? []).map(({ id: _id, position: _p, ...st }) => st),
    log: logBy.get(t.id) ?? [],
  }));
}
