// Teams are each person's own labels (migrations/0014): every query is scoped to the user.
export async function listTeams(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT tm.id, tm.name, (SELECT COUNT(*) FROM tasks t WHERE t.team_id = tm.id AND t.user_id = tm.user_id) AS task_count
     FROM teams tm WHERE tm.user_id = ? ORDER BY tm.position, tm.name COLLATE NOCASE`,
  ).bind(userId).all();
  return results;
}

export function findTeam(env, userId, id) {
  return env.DB.prepare('SELECT id, name FROM teams WHERE id = ? AND user_id = ?').bind(id, userId).first();
}

// null when the user already has a team of that name (ignoring case).
export async function createTeam(env, userId, name) {
  try {
    await env.DB.prepare(
      'INSERT INTO teams (user_id, name, position) VALUES (?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM teams WHERE user_id = ?))',
    ).bind(userId, name, userId).run();
    return true;
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) return null;
    throw e;
  }
}

// false when no such team of theirs; null when the new name is taken.
export async function renameTeam(env, userId, id, name) {
  try {
    const { meta } = await env.DB.prepare('UPDATE teams SET name = ? WHERE id = ? AND user_id = ?').bind(name, id, userId).run();
    return meta.changes > 0;
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) return null;
    throw e;
  }
}

// Their tasks on the team become "no team", then the team goes, atomically.
export async function deleteTeam(env, userId, id) {
  const results = await env.DB.batch([
    env.DB.prepare('UPDATE tasks SET team_id = NULL WHERE team_id = ? AND user_id = ?').bind(id, userId),
    env.DB.prepare('DELETE FROM teams WHERE id = ? AND user_id = ?').bind(id, userId),
  ]);
  return results[1].meta.changes > 0;
}
