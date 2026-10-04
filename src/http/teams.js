import { validateTeamName } from '../domain/teams.js';
import * as teamsRepo from '../infra/teamsRepo.js';
import { json } from './respond.js';

const list = async (env, user, status = 200) => json({ teams: await teamsRepo.listTeams(env, user.id) }, status);
const teamId = (raw) => (/^\d{1,9}$/.test(raw) ? Number(raw) : null);

export const get = (env, user) => list(env, user);

export async function create(request, env, user) {
  const { value, error } = validateTeamName((await request.json())?.name);
  if (error) return json({ error }, 400);
  if ((await teamsRepo.createTeam(env, value)) === null) return json({ error: 'There is already a team with that name' }, 409);
  return list(env, user, 201);
}

export async function rename(request, env, user, rawId) {
  const id = teamId(rawId);
  const { value, error } = validateTeamName((await request.json())?.name);
  if (error) return json({ error }, 400);
  const outcome = id === null ? false : await teamsRepo.renameTeam(env, id, value);
  if (outcome === null) return json({ error: 'There is already a team with that name' }, 409);
  if (!outcome) return json({ error: 'Team not found' }, 404);
  return list(env, user);
}

export async function remove(env, user, rawId) {
  const id = teamId(rawId);
  if (id === null || !(await teamsRepo.deleteTeam(env, id))) return json({ error: 'Team not found' }, 404);
  return list(env, user);
}
