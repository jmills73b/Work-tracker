import { NORMAL, OPEN } from '../../public/shared/rules.js';
import { nextOccurrence, shouldRecur } from '../domain/recurrence.js';
import { localNow } from '../domain/reminders.js';
import { validateSubtaskCreate, validateSubtaskPatch, validateTask, validateUpdate } from '../domain/taskValidation.js';
import * as tasksRepo from '../infra/tasksRepo.js';
import { getSettings } from '../infra/remindersRepo.js';
import { findTeam } from '../infra/teamsRepo.js';
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
  if (value.team_id != null && !(await findTeam(env, value.team_id))) return bad('Unknown team');
  const t = { description: '', status: OPEN, priority: NORMAL, target_date: null, team_id: null, subtasks: [], ...value };
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
  const team = value.team_id != null ? await findTeam(env, value.team_id) : null;
  if (value.team_id != null && !team) return bad('Unknown team');
  const at = now();
  const stmts = tasksRepo.changeStatements(env, user.id, existing, value, at, {
    teamName: (tid) => (tid === existing.team_id ? existing.team_name : team?.name) ?? `team ${tid}`,
  });
  const next = await recurStatements(env, user, existing, value, at);
  if (stmts.length) await env.DB.batch([...stmts, ...next.statements]);
  return detailWithNext(env, user, id, stmts.length ? next.id : null);
}

// Marking a recurring task done creates the next occurrence, in the same batch as the
// status change. Dates are worked out in the person's own time zone (their reminder
// setting, London by default).
async function recurStatements(env, user, existing, fields, at) {
  if (!shouldRecur(existing, fields)) return { id: null, statements: [] };
  const [settings, subtasks] = await Promise.all([getSettings(env, user.id), tasksRepo.listSubtasks(env, user.id, existing.id)]);
  const task = { ...existing, ...fields };
  const next = nextOccurrence(task, subtasks, localNow(new Date(at), settings.time_zone).date);
  return tasksRepo.nextOccurrenceStatements(env, user.id, existing, next, at);
}

// The task's detail, plus the new occurrence (with its subtasks) when one was made, so
// the page can show it straight away.
async function detailWithNext(env, user, id, nextId, status = 200) {
  const detail = await tasksRepo.taskDetail(env, user.id, id);
  const next = nextId ? await tasksRepo.taskDetail(env, user.id, nextId) : null;
  return json(next ? { ...detail, next_task: next.task } : detail, status);
}

export async function remove(env, user, id) {
  return (await tasksRepo.deleteTask(env, user.id, id)) ? json({ ok: true }) : notFound();
}

// A log entry: words only.
export async function postUpdate(request, env, user, id) {
  const { value, error } = validateUpdate(await request.json());
  if (error) return bad(error);
  if (!(await tasksRepo.getTask(env, user.id, id))) return notFound();
  const at = now();
  await env.DB.batch([
    tasksRepo.touchTask(env, user.id, id, at),
    tasksRepo.insertUpdate(env, { userId: user.id, taskId: id, kind: 'note', ...value, at }),
  ]);
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
    tasksRepo.insertSubtask(env, { userId: user.id, taskId: id, ...value, at }),
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
  stmts.push(tasksRepo.touchTask(env, user.id, id, at));
  await env.DB.batch(stmts);
  return json(await tasksRepo.taskDetail(env, user.id, id));
}

export async function removeSubtask(env, user, id, subtaskId) {
  if (!(await tasksRepo.deleteSubtask(env, user.id, id, subtaskId))) return notFound('Subtask');
  return json(await tasksRepo.taskDetail(env, user.id, id));
}
