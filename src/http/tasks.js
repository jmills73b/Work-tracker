import { statusAfterSubtaskChange } from '../domain/taskChanges.js';
import { validateSubtaskCreate, validateSubtaskPatch, validateTask, validateUpdate } from '../domain/taskValidation.js';
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
  const t = { description: '', status: 'todo', priority: 'medium', target_date: null, category: '', subtasks: [], ...value };
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

// A progress update can also move the task's status.
export async function postUpdate(request, env, user, id) {
  const { value, error } = validateUpdate(await request.json());
  if (error) return bad(error);
  const existing = await tasksRepo.getTask(env, user.id, id);
  if (!existing) return notFound();

  const at = now();
  const fields = value.status !== null ? { status: value.status } : {};
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

// ---------- Subtasks: each change saves immediately and returns the whole task ----------

export async function addSubtask(request, env, user, id) {
  const { value, error } = validateSubtaskCreate(await request.json());
  if (error) return bad(error);
  if (!(await tasksRepo.getTask(env, user.id, id))) return notFound();
  const at = now();
  await env.DB.batch([
    tasksRepo.insertSubtask(env, { userId: user.id, taskId: id, title: value.title, at }),
    tasksRepo.touchTask(env, user.id, id, at),
  ]);
  return json(await tasksRepo.taskDetail(env, user.id, id), 201);
}

export async function patchSubtask(request, env, user, id, subtaskId) {
  const { value, error } = validateSubtaskPatch(await request.json());
  if (error) return bad(error);
  const [task, subtask] = await Promise.all([
    tasksRepo.getTask(env, user.id, id),
    tasksRepo.getSubtask(env, user.id, id, subtaskId),
  ]);
  if (!task) return notFound();
  if (!subtask) return notFound('Subtask');

  const at = now();
  const stmts = [tasksRepo.updateSubtask(env, user.id, id, subtaskId, value, at)];
  const doneChanged = value.done !== undefined && value.done !== Boolean(subtask.done);
  if (doneChanged) {
    const title = value.title ?? subtask.title;
    stmts.push(tasksRepo.insertUpdate(env, {
      userId: user.id, taskId: id, kind: 'change', note: `${value.done ? 'Completed' : 'Reopened'}: ${title}`, at,
    }));
  }
  const nextStatus = doneChanged ? statusAfterSubtaskChange(task, value.done) : null;
  const statusStmts = nextStatus ? tasksRepo.changeStatements(env, user.id, task, { status: nextStatus }, at) : [];
  stmts.push(...(statusStmts.length ? statusStmts : [tasksRepo.touchTask(env, user.id, id, at)]));
  await env.DB.batch(stmts);
  return json(await tasksRepo.taskDetail(env, user.id, id));
}

export async function removeSubtask(env, user, id, subtaskId) {
  if (!(await tasksRepo.deleteSubtask(env, user.id, id, subtaskId))) return notFound('Subtask');
  return json(await tasksRepo.taskDetail(env, user.id, id));
}
