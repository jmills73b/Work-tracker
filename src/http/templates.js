import { validateTemplateName } from '../domain/templates.js';
import * as tasksRepo from '../infra/tasksRepo.js';
import * as templatesRepo from '../infra/templatesRepo.js';
import { json } from './respond.js';

export async function list(env, user) {
  return json({ templates: await templatesRepo.listTemplates(env, user.id) });
}

// Body: { task_id, name }. The template is built from the task as it stands now.
export async function create(request, env, user) {
  const body = await request.json();
  const { value: name, error } = validateTemplateName(body?.name);
  if (error) return json({ error }, 400);
  const detail = typeof body?.task_id === 'string' ? await tasksRepo.taskDetail(env, user.id, body.task_id) : null;
  if (!detail) return json({ error: 'Task not found' }, 404);
  await templatesRepo.createTemplateFromTask(env, user.id, name, detail.task, detail.subtasks, new Date().toISOString());
  return json({ templates: await templatesRepo.listTemplates(env, user.id) }, 201);
}

export async function remove(env, user, id) {
  if (!(await templatesRepo.deleteTemplate(env, user.id, id))) return json({ error: 'Template not found' }, 404);
  return json({ templates: await templatesRepo.listTemplates(env, user.id) });
}
