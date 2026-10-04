// Teams are one shared list of labels; each person sees only how many of their own
// tasks carry each one.
export async function listTeams(env, userId = null) {
  const { results } = await env.DB.prepare(
    `SELECT tm.id, tm.name, (SELECT COUNT(*) FROM tasks t WHERE t.team_id = tm.id AND t.user_id = ?) AS task_count
     FROM teams tm ORDER BY tm.position, tm.name COLLATE NOCASE`,
  ).bind(userId).all();
  return results;
}

export function findTeam(env, id) {
  return env.DB.prepare('SELECT id, name FROM teams WHERE id = ?').bind(id).first();
}

// null when the name is taken (names are unique, ignoring case).
export async function createTeam(env, name) {
  try {
    await env.DB.prepare(
      'INSERT INTO teams (name, position) VALUES (?, (SELECT COALESCE(MAX(position) + 1, 0) FROM teams))',
    ).bind(name).run();
    return true;
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) return null;
    throw e;
  }
}

// false when no such team; null when the new name is taken.
export async function renameTeam(env, id, name) {
  try {
    const { meta } = await env.DB.prepare('UPDATE teams SET name = ? WHERE id = ?').bind(name, id).run();
    return meta.changes > 0;
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) return null;
    throw e;
  }
}

// Tasks and templates on the team become "no team", then the team goes, atomically.
export async function deleteTeam(env, id) {
  const results = await env.DB.batch([
    env.DB.prepare('UPDATE tasks SET team_id = NULL WHERE team_id = ?').bind(id),
    env.DB.prepare('UPDATE templates SET team_id = NULL WHERE team_id = ?').bind(id),
    env.DB.prepare('DELETE FROM teams WHERE id = ?').bind(id),
  ]);
  return results[2].meta.changes > 0;
}
