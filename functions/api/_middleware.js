import { error } from '../../lib/http.js';
import { getSession } from '../../lib/session.js';

// Routes reachable without a session.
const PUBLIC = new Set(['POST /api/auth/login']);

export async function onRequest(context) {
  const { request, env } = context;

  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    // CSRF defence on top of SameSite=Strict cookies: same-origin only, and JSON bodies only.
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return error(403, 'Cross-origin request blocked');
    const type = request.headers.get('Content-Type') || '';
    if (['POST', 'PUT', 'PATCH'].includes(request.method) && !type.startsWith('application/json')) {
      return error(415, 'Expected application/json');
    }
  }

  if (!env.DB) return error(500, 'Database binding "DB" is missing');

  try {
    if (!PUBLIC.has(`${request.method} ${new URL(request.url).pathname}`)) {
      const session = await getSession(env.DB, request);
      if (!session) return error(401, 'Not signed in');
      context.data.user = session.userId;
      context.data.username = session.username;
      context.data.sessionHash = session.sessionHash;
    }
    return await context.next();
  } catch (e) {
    console.error(e);
    return error(500, 'Something went wrong');
  }
}
