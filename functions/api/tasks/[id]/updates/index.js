import { error, json, readJson } from '../../../../../lib/http.js';
import { applyChanges, getTask, insertUpdate, now, taskDetail } from '../../../../../lib/tasks.js';
import { validateUpdate } from '../../../../../lib/validate.js';

// Post a progress update, optionally moving the task's progress and/or status at the same time.
export async function onRequestPost({ request, env, data, params }) {
  const { value, error: message } = validateUpdate(await readJson(request));
  if (message) return error(400, message);

  const owner = data.user;
  const existing = await getTask(env.DB, owner, params.id);
  if (!existing) return error(404, 'Task not found');

  const at = now();
  const fields = {};
  if (value.progress !== null) fields.progress = value.progress;
  if (value.status !== null) fields.status = value.status;

  const stmts = applyChanges(env.DB, owner, existing, fields, at);
  if (!stmts.length) {
    stmts.push(env.DB.prepare('UPDATE tasks SET updated_at = ? WHERE id = ? AND owner = ?').bind(at, existing.id, owner));
  }
  stmts.push(insertUpdate(env.DB, { owner, taskId: existing.id, kind: 'note', ...value, at }));
  await env.DB.batch(stmts);

  return json(await taskDetail(env.DB, owner, existing.id), 201);
}
