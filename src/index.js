import * as admin from './http/admin.js';
import * as auth from './http/auth.js';
import { json, redirect, text, withSecurityHeaders } from './http/respond.js';
import * as tasks from './http/tasks.js';
import { getSessionUser } from './infra/auth.js';

// Reachable without a session. Everything else is denied by default: a new page is
// protected the moment it exists, with no list to remember to update.
export const PUBLIC_PATHS = new Set([
  '/login', '/login.html', '/login.js', '/app.css', '/favicon.svg',
  '/manifest.webmanifest', '/icon-180.png', '/icon-512.png', '/robots.txt',
]);
const LOGIN_PAGES = new Set(['/login', '/login.html']);

export default {
  async fetch(request, env) {
    try {
      return withSecurityHeaders(await route(request, env));
    } catch (e) {
      if (e instanceof SyntaxError) return withSecurityHeaders(text("That request body wasn't valid JSON.", 400));
      console.error(e);
      return withSecurityHeaders(text('Something went wrong', 500));
    }
  },
};

// The order of these steps is the security property.
export async function route(request, env) {
  const url = new URL(request.url);
  const { pathname: path } = url;
  const { method } = request;

  // 0. CSRF: anything that changes state must come from this origin, as JSON.
  if (path.startsWith('/api/') && !['GET', 'HEAD'].includes(method)) {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return text('Cross-origin request blocked', 403);
    if (['POST', 'PUT', 'PATCH'].includes(method) && !(request.headers.get('Content-Type') || '').startsWith('application/json')) {
      return text('Expected application/json', 415);
    }
  }

  // 1. Public auth routes, before any session lookup: there is no cookie yet.
  if (method === 'POST' && path === '/api/auth/register') return auth.register(request, env);
  if (method === 'POST' && path === '/api/auth/login') return auth.login(request, env);

  // 2. Resolve the session once; everything below reuses it.
  const user = await getSessionUser(env, request);

  // 3. Session-optional routes.
  if (method === 'POST' && path === '/api/auth/logout') return auth.logout(request, env);
  if (method === 'GET' && path === '/api/auth/me') return user ? auth.me(user) : text('Unauthorized', 401);

  // 4. Everything else under /api/ needs a session; /api/admin/ also needs is_admin.
  if (path.startsWith('/api/')) {
    if (!user) return text('Unauthorized', 401);
    if (path.startsWith('/api/admin/') && !user.is_admin) return text('Forbidden', 403);
    return (await api(request, env, user, method, path)) ?? json({ error: 'Not found' }, 404);
  }

  // 5. Page gate, default-deny.
  if (!user && !PUBLIC_PATHS.has(path)) return redirect(url, '/login');
  if (user && LOGIN_PAGES.has(path)) return redirect(url, '/');
  return env.ASSETS.fetch(request);
}

async function api(request, env, user, method, path) {
  if (path === '/api/auth/password' && method === 'POST') return auth.changePassword(request, env, user);

  if (path === '/api/admin/invites') {
    if (method === 'GET') return admin.listInvites(env, user);
    if (method === 'POST') return admin.createInvite(env, user);
  }

  if (path === '/api/tasks') {
    if (method === 'GET') return tasks.list(env, user);
    if (method === 'POST') return tasks.create(request, env, user);
  }

  const sub = path.match(/^\/api\/tasks\/([^/]+)\/subtasks(?:\/([^/]+))?$/);
  if (sub) {
    const [, id, subtaskId] = sub;
    if (!subtaskId && method === 'POST') return tasks.addSubtask(request, env, user, id);
    if (subtaskId && method === 'PATCH') return tasks.patchSubtask(request, env, user, id, subtaskId);
    if (subtaskId && method === 'DELETE') return tasks.removeSubtask(env, user, id, subtaskId);
    return null;
  }

  const m = path.match(/^\/api\/tasks\/([^/]+)(?:\/updates(?:\/([^/]+))?)?$/);
  if (m) {
    const [, id, updateId] = m;
    const isUpdates = path.includes('/updates');
    if (!isUpdates) {
      if (method === 'GET') return tasks.get(env, user, id);
      if (method === 'PATCH') return tasks.patch(request, env, user, id);
      if (method === 'DELETE') return tasks.remove(env, user, id);
    } else if (!updateId && method === 'POST') {
      return tasks.postUpdate(request, env, user, id);
    } else if (updateId && method === 'DELETE') {
      return tasks.removeUpdate(env, user, id, updateId);
    }
  }
  return null;
}
