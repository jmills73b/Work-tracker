// The account menu and its dialogs: reminders, teams, Face ID & passkeys, export,
// password, invites, theme and sign out.
import { api, notify } from './api.js';
import { relTime, shortDate } from './dates.js';
import { $, h, icon, showFormError, toast } from './dom.js';
import { fillTeamPicker } from './panel.js';
import { app, state, store } from './state.js';

/* ---------- Menu ---------- */

function toggleMenu(open) {
  const menu = $('#user-dropdown');
  const show = open ?? menu.hidden;
  menu.hidden = !show;
  $('#user-button').setAttribute('aria-expanded', String(show));
  if (show) menu.querySelector('button:not([hidden])').focus();
}
const closeMenu = () => toggleMenu(false);

export function setUser(user) {
  state.user = user;
  $('#user-menu').hidden = false;
  $('#user-name').textContent = user.name;
  $('#user-avatar').textContent = user.name.slice(0, 1);
  $('#user-button').title = `Signed in as ${user.email}`;
  $('#invite-btn').hidden = !user.is_admin;
  state.assistant = Boolean(user.assistant);
  $('#assist-btn').hidden = !state.assistant;
  $('#log-assist').hidden = !state.assistant;
}

async function signOut() {
  closeMenu();
  if (state.dirty && !confirm('Discard the new task and sign out?')) return;
  try {
    await api('/auth/logout', { method: 'POST', body: {} });
  } catch (err) {
    if (!err.silent) return notify(err);
  }
  state.dirty = false;
  location.href = '/login';
}

/* ---------- Theme ---------- */

export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function toggleTheme() {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  applyTheme(next);
  store.set('wt.theme', next);
}

/* ---------- Export ---------- */

// A plain navigation: the server answers with a download, so the page stays put.
function exportAs(format) {
  closeMenu();
  location.href = `/api/export?format=${format}`;
}

/* ---------- Teams ---------- */

export function setTeams(teams) {
  state.teams = teams;
  if (/^\d+$/.test(state.team) && !teams.some((t) => String(t.id) === state.team)) {
    state.team = 'all';
    store.set('wt.team', 'all');
  }
  $('#team-filter').replaceChildren(
    h('option', { value: 'all', text: 'All teams' }),
    h('option', { value: 'none', text: 'No team' }),
    ...teams.map((t) => h('option', { value: String(t.id), text: t.name })));
  $('#team-filter').value = state.team;
  fillTeamPicker();
  renderTeamList();
}

// From the task's team picker ("New team…"). Returns the team, or null.
export async function addTeamNamed(name) {
  try {
    const { teams } = await api('/teams', { method: 'POST', body: { name } });
    setTeams(teams);
    return teams.find((t) => t.name.toLowerCase() === name.toLowerCase()) || null;
  } catch (err) {
    notify(err);
    return null;
  }
}

function renderTeamList() {
  $('#team-list').replaceChildren(...(state.teams.length ? state.teams.map((t) => {
    const name = h('input', { class: 'input team-name', value: t.name, maxlength: '40', 'aria-label': `Rename ${t.name}` });
    name.addEventListener('change', () => renameTeam(t, name));
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
    return h('li', {},
      name,
      h('span', { class: 'muted team-count', text: `${t.task_count} task${t.task_count === 1 ? '' : 's'}` }),
      h('button', {
        type: 'button', class: 'icon-btn', title: `Remove ${t.name}`, 'aria-label': `Remove team ${t.name}`,
        onclick: () => removeTeam(t),
      }, icon('trash', 15)));
  }) : [h('li', { class: 'hint', text: 'No teams yet.' })]));
}

async function teamsCall(path, options, done) {
  $('#teams-error').hidden = true;
  try {
    setTeams((await api(path, options)).teams);
    state.tasks = (await api('/tasks')).tasks;
    app.render();
    if (done) toast(done);
    return true;
  } catch (err) {
    if (!err.silent) showFormError($('#teams-error'), err.message);
    renderTeamList();
    return false;
  }
}

async function addTeam(e) {
  e.preventDefault();
  const input = e.currentTarget.elements.namedItem('name');
  const name = input.value.trim();
  if (!name) return;
  if (await teamsCall('/teams', { method: 'POST', body: { name } }, `Added ${name}`)) input.value = '';
}

function renameTeam(team, input) {
  const name = input.value.trim();
  if (!name || name === team.name) {
    input.value = team.name;
    return;
  }
  teamsCall(`/teams/${team.id}`, { method: 'PATCH', body: { name } }, `Renamed to ${name}`);
}

function removeTeam(team) {
  const n = team.task_count;
  if (!confirm(`Remove ${team.name}?${n ? ` Its ${n} task${n === 1 ? '' : 's'} will move to "No team".` : ''}`)) return;
  teamsCall(`/teams/${team.id}`, { method: 'DELETE' }, `Removed ${team.name}`);
}

async function openTeams() {
  closeMenu();
  $('#teams-error').hidden = true;
  $('#teams-dialog').showModal();
  try {
    setTeams((await api('/teams')).teams);
  } catch (err) {
    if (!err.silent) showFormError($('#teams-error'), err.message);
  }
}

/* ---------- Reminders ---------- */

let pushConfig = null;

function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
  } catch {
    return 'Europe/London';
  }
}

// iPadOS reports itself as a Mac, so touch points tell them apart.
const isAppleTouch = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function b64urlToBytes(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

export function registerServiceWorker() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { /* Reminders will say so */ });
}

async function deviceSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

function fillReminderForm() {
  const f = $('#reminders-form').elements;
  const times = pushConfig.settings.digest_times || [];
  for (let i = 1; i <= 3; i += 1) f.namedItem(`digest_time_${i}`).value = times[i - 1] || '';
  $('#reminders-tz').textContent = `Times are in ${deviceTimeZone().replace(/_/g, ' ')}. Nothing is sent when nothing needs you.`;
}

async function renderPushStatus() {
  const sub = await deviceSubscription();
  const here = Boolean(sub && pushConfig.endpoints.includes(sub.endpoint));
  const others = pushConfig.devices - (here ? 1 : 0);
  let message;
  let canEnable = false;
  if (!pushConfig.public_key) message = 'Reminders are not set up on the server yet.';
  else if (isAppleTouch() && !isStandalone()) {
    message = 'On iPhone and iPad, first add this app to your Home Screen: tap Share, then "Add to Home Screen". Open it from there and turn reminders on.';
  } else if (!pushSupported()) message = "This browser can't receive notifications.";
  else if (Notification.permission === 'denied') message = 'Notifications are blocked for this site. Allow them in your device or browser settings, then come back.';
  else {
    canEnable = true;
    message = here
      ? `On for this device${others ? ` and ${others} other${others === 1 ? '' : 's'}` : ''}.`
      : others ? `On for ${others} other device${others === 1 ? '' : 's'}; off on this one.` : 'Off. Turn it on to get reminders on this device.';
  }
  $('#reminders-status').textContent = message;
  $('#push-enable').hidden = here;
  $('#push-enable').disabled = !canEnable;
  $('#push-disable').hidden = !here;
  $('#push-test').hidden = !pushConfig.devices || !pushConfig.public_key;
}

async function openReminders() {
  closeMenu();
  $('#reminders-error').hidden = true;
  $('#reminders-status').textContent = 'Loading…';
  $('#reminders-dialog').showModal();
  try {
    pushConfig = await api('/push/config');
    fillReminderForm();
    await renderPushStatus();
  } catch (err) {
    if (!err.silent) showFormError($('#reminders-error'), err.message);
  }
}

async function enablePush() {
  $('#reminders-error').hidden = true;
  try {
    // Ask straight from the tap: Safari only shows the prompt during a user gesture.
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return renderPushStatus();
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(pushConfig.public_key) });
    await api('/push/subscriptions', { method: 'POST', body: { ...sub.toJSON(), time_zone: deviceTimeZone() } });
    pushConfig = await api('/push/config');
    fillReminderForm();
    await renderPushStatus();
    toast('Reminders on for this device');
  } catch (err) {
    if (!err.silent) showFormError($('#reminders-error'), err.message || "Couldn't turn reminders on");
  }
}

async function disablePush() {
  try {
    const sub = await deviceSubscription();
    if (sub) {
      await api('/push/subscriptions', { method: 'DELETE', body: { endpoint: sub.endpoint } });
      await sub.unsubscribe();
    }
    pushConfig = await api('/push/config');
    await renderPushStatus();
    toast('Reminders off for this device');
  } catch (err) {
    if (!err.silent) showFormError($('#reminders-error'), err.message);
  }
}

async function sendTestPush() {
  try {
    const { sent, failed } = await api('/push/test', { method: 'POST', body: {} });
    toast(failed ? `Test sent to ${sent}; ${failed} device${failed === 1 ? '' : 's'} didn't accept it` : `Test sent to ${sent} device${sent === 1 ? '' : 's'}`);
  } catch (err) {
    if (!err.silent) showFormError($('#reminders-error'), err.message);
  }
}

async function saveReminderSettings(e) {
  e.preventDefault();
  const f = $('#reminders-form').elements;
  const times = [1, 2, 3].map((i) => f.namedItem(`digest_time_${i}`).value).filter(Boolean);
  if (!times.length) {
    showFormError($('#reminders-error'), 'Choose at least one reminder time');
    return;
  }
  $('#reminders-error').hidden = true;
  try {
    const { settings } = await api('/push/settings', { method: 'PUT', body: { digest_times: times, time_zone: deviceTimeZone() } });
    pushConfig.settings = settings;
    toast('Reminder times saved');
  } catch (err) {
    if (!err.silent) showFormError($('#reminders-error'), err.message);
  }
}

/* ---------- Face ID & passkeys ---------- */

function passkeyError(message) {
  const el = $('#passkeys-error');
  el.textContent = message || '';
  el.hidden = !message;
}

async function openPasskeys() {
  closeMenu();
  const supported = Boolean(window.Passkeys?.supported());
  $('#passkeys-unsupported').hidden = supported;
  $('#passkey-password-field').hidden = !supported;
  $('#passkey-add').hidden = !supported;
  $('#passkeys-form').elements.password.value = '';
  passkeyError('');
  $('#passkey-list').replaceChildren(h('li', { class: 'hint', text: 'Loading…' }));
  $('#passkeys-dialog').showModal();
  try {
    renderPasskeys((await api('/auth/passkeys')).passkeys);
  } catch (err) {
    if (!err.silent) passkeyError(err.message);
  }
}

function renderPasskeys(list) {
  $('#passkey-list').replaceChildren(...(list.length ? list.map((p) => h('li', { class: 'passkey-item' },
    h('span', { class: 'passkey-icon' }, icon('check', 14)),
    h('span', { class: 'passkey-text' },
      h('strong', { text: p.name }),
      h('span', { class: 'hint', text: `Added ${shortDate(p.created_at)}${p.last_used_at ? ` · last used ${relTime(p.last_used_at)}` : ' · not used yet'}` })),
    h('button', {
      type: 'button', class: 'btn ghost danger', text: 'Remove', 'aria-label': `Remove passkey: ${p.name}`,
      onclick: () => removePasskey(p),
    }))) : [h('li', { class: 'hint', text: 'No passkeys yet. Add this device to sign in with Face ID or Touch ID.' })]));
}

async function addPasskey(e) {
  e.preventDefault();
  passkeyError('');
  const form = $('#passkeys-form');
  const password = form.elements.password.value;
  if (!password) {
    passkeyError('Enter your password to add this device');
    form.elements.password.focus();
    return;
  }
  const btn = $('#passkey-add');
  btn.disabled = true;
  try {
    const { challenge_id: challengeId, options } = await api('/auth/passkeys/options', { method: 'POST', body: { password } });
    form.elements.password.value = '';
    let response;
    try {
      response = await window.Passkeys.create(options);
    } catch (err) {
      if (err?.name === 'InvalidStateError') passkeyError('This device already has a passkey here.');
      else if (!window.Passkeys.cancelled(err)) passkeyError("This device couldn't create a passkey.");
      return;
    }
    const { passkeys } = await api('/auth/passkeys', { method: 'POST', body: { challenge_id: challengeId, response, name: window.Passkeys.deviceName() } });
    renderPasskeys(passkeys);
    toast('Passkey added. Next time, sign in with Face ID.');
  } catch (err) {
    if (!err.silent) passkeyError(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function removePasskey(p) {
  if (!confirm(`Remove the passkey "${p.name}"? That device will need your password to sign in.`)) return;
  try {
    await api(`/auth/passkeys/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
    renderPasskeys((await api('/auth/passkeys')).passkeys);
  } catch (err) {
    if (!err.silent) passkeyError(err.message);
  }
}

/* ---------- Password and invites ---------- */

function openPasswordDialog() {
  closeMenu();
  const form = $('#password-form');
  form.reset();
  $('#password-error').hidden = true;
  $('#password-dialog').showModal();
  form.elements.namedItem('current_password').focus();
}

// Validation beyond required/minlength is the server's; its message is shown verbatim.
async function changePassword(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api('/auth/password', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
    $('#password-dialog').close();
    toast('Password updated');
  } catch (err) {
    if (!err.silent) showFormError($('#password-error'), err.message);
  } finally {
    button.disabled = false;
  }
}

async function openInviteDialog() {
  closeMenu();
  $('#invite-code').textContent = '';
  $('#invite-error').hidden = true;
  $('#invite-dialog').showModal();
  await refreshInvites();
}

async function refreshInvites() {
  try {
    const { invites } = await api('/admin/invites');
    $('#invite-list').replaceChildren(...invites.map((i) => h('li', {},
      h('code', { text: i.code }),
      h('span', { class: 'muted', text: i.used_by_name ? `Used by ${i.used_by_name}` : 'Unused' }))));
    $('#invite-list-section').hidden = !invites.length;
  } catch (err) {
    if (!err.silent) showFormError($('#invite-error'), err.message);
  }
}

async function createInvite() {
  try {
    const { code } = await api('/admin/invites', { method: 'POST', body: {} });
    $('#invite-code').textContent = code;
    await refreshInvites();
  } catch (err) {
    if (!err.silent) showFormError($('#invite-error'), err.message);
  }
}

export function bindSettings() {
  $('#theme-toggle').addEventListener('click', toggleTheme);
  $('#user-button').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
  $('#sign-out-btn').addEventListener('click', signOut);
  $('#change-password-btn').addEventListener('click', openPasswordDialog);
  $('#reminders-btn').addEventListener('click', openReminders);
  $('#teams-btn').addEventListener('click', openTeams);
  $('#passkeys-btn').addEventListener('click', openPasskeys);
  $('#export-json-btn').addEventListener('click', () => exportAs('json'));
  $('#export-csv-btn').addEventListener('click', () => exportAs('csv'));
  $('#invite-btn').addEventListener('click', openInviteDialog);
  $('#teams-close').addEventListener('click', () => $('#teams-dialog').close());
  $('#team-add-form').addEventListener('submit', addTeam);
  $('#reminders-close').addEventListener('click', () => $('#reminders-dialog').close());
  $('#reminders-form').addEventListener('submit', saveReminderSettings);
  $('#push-enable').addEventListener('click', enablePush);
  $('#push-disable').addEventListener('click', disablePush);
  $('#push-test').addEventListener('click', sendTestPush);
  $('#passkeys-close').addEventListener('click', () => $('#passkeys-dialog').close());
  $('#passkeys-form').addEventListener('submit', addPasskey);
  $('#password-form').addEventListener('submit', changePassword);
  $('#password-cancel').addEventListener('click', () => $('#password-dialog').close());
  $('#create-invite').addEventListener('click', createInvite);
  $('#invite-close').addEventListener('click', () => $('#invite-dialog').close());
  document.addEventListener('click', (e) => { if (!e.target.closest('#user-menu')) closeMenu(); });
  $('#user-dropdown').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); $('#user-button').focus(); }
  });
}
