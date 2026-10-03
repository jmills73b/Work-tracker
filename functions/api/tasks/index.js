import { error, json, readJson } from '../../../lib/http.js';
import { insertUpdate, listTasks, now, taskDetail } from '../../../lib/tasks.js';
import { validateTask } from '../../../lib/validate.js';

export async function onRequestGet({ env, data }) {
  return json({ tasks: await listTasks(env.DB, data.user) });
}

export async function onRequestPost({ request, env, data }) {
  const { value, error: message } = validateTask(await readJson(request));
  if (message) return error(400, message);

  const owner = data.user;
  const id = crypto.randomUUID();
  const at = now();
  const t = {
    description: '',
    status: 'todo',
    priority: 'medium',
    progress: 0,
    target_date: null,
    category: '',
    ...value,
  };
  if (t.status === 'done') t.progress = 100;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tasks (id, owner, title, description, status, priority, progress, target_date,
                          category, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, owner, t.title, t.description, t.status, t.priority, t.progress, t.target_date,
      t.category, at, at, t.status === 'done' ? at : null),
    insertUpdate(env.DB, { owner, taskId: id, kind: 'change', note: 'Task created', at }),
  ]);

  return json(await taskDetail(env.DB, owner, id), 201);
}
