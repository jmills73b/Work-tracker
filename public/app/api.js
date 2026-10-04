import { toast } from './dom.js';
import { state } from './state.js';

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Connection problem. Check your internet and try again.');
  }
  if (res.status === 401) {
    // Session gone or expired: the page gate on /login takes it from here.
    state.dirty = false;
    location.href = '/login';
    const err = new Error('Signed out');
    err.silent = true;
    throw err;
  }
  if (res.status === 204) return null;
  const isJson = (res.headers.get('Content-Type') || '').includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    // Auth endpoints answer in plain text, the task API in { error }; show either verbatim.
    const err = new Error((isJson ? data?.error : data) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Once, and never for a silent error (the redirect to sign in). `show` is for tests.
export function notify(err, show = toast) {
  if (!err.silent) show(err.message, 'error');
}
