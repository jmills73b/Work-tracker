import * as admin from './http/admin.js';
import * as assist from './http/assist.js';
import * as auth from './http/auth.js';
import { json, redirect, text, withSecurityHeaders } from './http/respond.js';
import * as push from './http/push.js';
import * as tasks from './http/tasks.js';
import * as teams from './http/teams.js';
import * as templates from './http/templates.js';
import { getSessionUser } from './infra/auth.js';
import { runDigests } from './reminders.js';

// Reachable without a session. Everything else is denied by default: a new page is
// protected the moment it exists, with no list to remember to update.
export const PUBLIC_PATHS = new Set([
  '/login', '/login.html', '/login.js', '/app.css', '/favicon.svg',
  '/manifest.webmanifest', '/icon-180.png', '/icon-512.png', '/robots.txt',
  // The service worker holds no data; keeping it public lets the browser update it even
  // after the session cookie has expired.
  '/sw.js',
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

  // Cron Trigger (wrangler.toml): the morning digest.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDigests(env, new Date(event.scheduledTime)));
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
  if (method === 'GET' && path === '/api/auth/me') return user ? auth.me(user, env) : text('Unauthorized', 401);

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

  if (path === '/api/assist' && method === 'POST') return assist.suggest(request, env, user);
  if (path === '/api/assist/subtask' && method === 'POST') return assist.suggestSubtask(request, env, user);
  if (path === '/api/assist/update' && method === 'POST') return assist.suggestUpdate(request, env, user);

  if (path === '/api/teams' && method === 'GET') return teams.get(env);
  if (path === '/api/admin/teams' && method === 'POST') return teams.create(request, env);
  const adminTeam = path.match(/^\/api\/admin\/teams\/([^/]+)$/);
  if (adminTeam) {
    if (method === 'PATCH') return teams.rename(request, env, adminTeam[1]);
    if (method === 'DELETE') return teams.remove(env, adminTeam[1]);
  }

  if (path === '/api/admin/invites') {
    if (method === 'GET') return admin.listInvites(env, user);
    if (method === 'POST') return admin.createInvite(env, user);
  }

  if (path === '/api/push/config' && method === 'GET') return push.config(env, user);
  if (path === '/api/push/settings' && method === 'PUT') return push.putSettings(request, env, user);
  if (path === '/api/push/subscriptions') {
    if (method === 'POST') return push.subscribe(request, env, user);
    if (method === 'DELETE') return push.unsubscribe(request, env, user);
  }
  if (path === '/api/push/test' && method === 'POST') return push.test(env, user);

  if (path === '/api/templates') {
    if (method === 'GET') return templates.list(env, user);
    if (method === 'POST') return templates.create(request, env, user);
  }
  const tpl = path.match(/^\/api\/templates\/([^/]+)$/);
  if (tpl && method === 'DELETE') return templates.remove(env, user, tpl[1]);

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
