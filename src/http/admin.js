import { createInviteCode, listInviteCodes } from '../infra/usersRepo.js';
import { json } from './respond.js';

export async function createInvite(env, user) {
  return json({ code: await createInviteCode(env, user.id) }, 201);
}

export async function listInvites(env, user) {
  return json({ invites: await listInviteCodes(env, user.id) });
}
