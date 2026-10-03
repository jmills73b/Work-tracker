import { templateFromTask } from '../domain/templates.js';

export async function listTemplates(env, userId) {
  const [templates, subtasks] = await Promise.all([
    env.DB.prepare(
      `SELECT tp.id, tp.name, tp.title, tp.description, tp.priority, tp.team_id, tp.created_at
       FROM templates tp WHERE tp.user_id = ? ORDER BY tp.name COLLATE NOCASE`,
    ).bind(userId).all(),
    env.DB.prepare(
      'SELECT template_id, title, offset_days FROM template_subtasks WHERE user_id = ? ORDER BY template_id, position',
    ).bind(userId).all(),
  ]);
  const byTemplate = new Map();
  for (const { template_id: id, ...st } of subtasks.results) {
    if (!byTemplate.has(id)) byTemplate.set(id, []);
    byTemplate.get(id).push(st);
  }
  return templates.results.map((t) => ({ ...t, subtasks: byTemplate.get(t.id) ?? [] }));
}

// Copies a task (and its subtasks, with dates as offsets) into a new template, atomically.
export async function createTemplateFromTask(env, userId, name, task, subtasks, at) {
  const t = templateFromTask(task, subtasks);
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO templates (id, user_id, name, title, description, priority, team_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, userId, name, t.title, t.description, t.priority, t.team_id, at),
    ...t.subtasks.map((st, position) => env.DB.prepare(
      `INSERT INTO template_subtasks (id, template_id, user_id, title, position, offset_days)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), id, userId, st.title, position, st.offset_days)),
  ]);
  return id;
}

export async function deleteTemplate(env, userId, id) {
  const results = await env.DB.batch([
    env.DB.prepare('DELETE FROM template_subtasks WHERE template_id = ? AND user_id = ?').bind(id, userId),
    env.DB.prepare('DELETE FROM templates WHERE id = ? AND user_id = ?').bind(id, userId),
  ]);
  return results[1].meta.changes > 0;
}
