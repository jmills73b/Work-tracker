import { error, json } from '../../../../../lib/http.js';
import { taskDetail } from '../../../../../lib/tasks.js';

export async function onRequestDelete({ env, data, params }) {
  const { meta } = await env.DB
    .prepare(`DELETE FROM task_updates WHERE id = ? AND task_id = ? AND owner = ? AND kind = 'note'`)
    .bind(params.updateId, params.id, data.user)
    .run();
  if (!meta.changes) return error(404, 'Update not found');
  return json(await taskDetail(env.DB, data.user, params.id));
}
