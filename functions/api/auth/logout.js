import { json } from '../../../lib/http.js';
import { clearedCookie, deleteSession } from '../../../lib/session.js';

export async function onRequestPost({ env, data }) {
  await deleteSession(env.DB, data.sessionHash);
  return json({ ok: true }, 200, { 'Set-Cookie': clearedCookie() });
}
