import { error, json, readJson } from '../../../lib/http.js';
import { applyChanges, getTask, now, taskDetail } from '../../../lib/tasks.js';
import { validateTask } from '../../../lib/validate.js';

export async function onRequestGet({ env, data, params }) {
  const detail = await taskDetail(env.DB, data.user, params.id);
  return detail ? json(detail) : error(404, 'Task not found');
}

export async function onRequestPatch({ request, env, data, params }) {
  const { value, error: message } = validateTask(await readJson(request), { partial: true });
  if (message) return error(400, message);

  const existing = await getTask(env.DB, data.user, params.id);
  if (!existing) return error(404, 'Task not found');

  const stmts = applyChanges(env.DB, data.user, existing, value, now());
  if (stmts.length) await env.DB.batch(stmts);

  return json(await taskDetail(env.DB, data.user, params.id));
}

export async function onRequestDelete({ env, data, params }) {
  const owner = data.user;
  const results = await env.DB.batch([
    env.DB.prepare('DELETE FROM task_updates WHERE task_id = ? AND owner = ?').bind(params.id, owner),
    env.DB.prepare('DELETE FROM tasks WHERE id = ? AND owner = ?').bind(params.id, owner),
  ]);
  if (!results[1].meta.changes) return error(404, 'Task not found');
  return json({ ok: true });
}
