import { validateTask, validateUpdate } from '../domain/taskValidation.js';
import * as tasksRepo from '../infra/tasksRepo.js';
import { json } from './respond.js';

const now = () => new Date().toISOString();
const notFound = (what = 'Task') => json({ error: `${what} not found` }, 404);
const bad = (message) => json({ error: message }, 400);

export async function list(env, user) {
  return json({ tasks: await tasksRepo.listTasks(env, user.id) });
}

export async function create(request, env, user) {
  const { value, error } = validateTask(await request.json());
  if (error) return bad(error);
  const t = { description: '', status: 'todo', priority: 'medium', progress: 0, target_date: null, category: '', ...value };
  if (t.status === 'done') t.progress = 100;
  const id = await tasksRepo.createTask(env, user.id, t, now());
  return json(await tasksRepo.taskDetail(env, user.id, id), 201);
}

export async function get(env, user, id) {
  const detail = await tasksRepo.taskDetail(env, user.id, id);
  return detail ? json(detail) : notFound();
}

export async function patch(request, env, user, id) {
  const { value, error } = validateTask(await request.json(), { partial: true });
  if (error) return bad(error);
  const existing = await tasksRepo.getTask(env, user.id, id);
  if (!existing) return notFound();
  const stmts = tasksRepo.changeStatements(env, user.id, existing, value, now());
  if (stmts.length) await env.DB.batch(stmts);
  return json(await tasksRepo.taskDetail(env, user.id, id));
}

export async function remove(env, user, id) {
  return (await tasksRepo.deleteTask(env, user.id, id)) ? json({ ok: true }) : notFound();
}

// A progress update can also move the task's progress and/or status.
export async function postUpdate(request, env, user, id) {
  const { value, error } = validateUpdate(await request.json());
  if (error) return bad(error);
  const existing = await tasksRepo.getTask(env, user.id, id);
  if (!existing) return notFound();

  const at = now();
  const fields = {};
  if (value.progress !== null) fields.progress = value.progress;
  if (value.status !== null) fields.status = value.status;
  const stmts = tasksRepo.changeStatements(env, user.id, existing, fields, at);
  if (!stmts.length) stmts.push(tasksRepo.touchTask(env, user.id, id, at));
  stmts.push(tasksRepo.insertUpdate(env, { userId: user.id, taskId: id, kind: 'note', ...value, at }));
  await env.DB.batch(stmts);
  return json(await tasksRepo.taskDetail(env, user.id, id), 201);
}

export async function removeUpdate(env, user, id, updateId) {
  if (!(await tasksRepo.deleteNote(env, user.id, id, updateId))) return notFound('Update');
  return json(await tasksRepo.taskDetail(env, user.id, id));
}
