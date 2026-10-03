import { authenticate, AuthError, ConfigError } from '../../lib/auth.js';
import { error } from '../../lib/http.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    // CSRF defence: same-origin only, and JSON bodies only.
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return error(403, 'Cross-origin request blocked');
    const type = request.headers.get('Content-Type') || '';
    if (['POST', 'PUT', 'PATCH'].includes(request.method) && !type.startsWith('application/json')) {
      return error(415, 'Expected application/json');
    }
  }

  try {
    context.data.user = await authenticate(request, env);
  } catch (e) {
    if (e instanceof ConfigError) return error(500, e.message);
    if (e instanceof AuthError) return error(401, 'Not signed in');
    console.error('auth failure', e);
    return error(401, 'Not signed in');
  }

  if (!env.DB) return error(500, 'Database binding "DB" is missing');

  try {
    return await context.next();
  } catch (e) {
    console.error(e);
    return error(500, 'Something went wrong');
  }
}
