// The task panel. A saved task's fields save as they change (text after a pause or on
// leaving the field); steps and log entries save on their own. A new task is a form with
// one Create button. The fields fold into one summary line; the log sits below the steps.
import { addDays, DONE, HIGH, NORMAL, OPEN, PRIORITY, STATUS, WAITING } from '../shared/rules.js';
import { api, notify } from './api.js';
import { dueInfo, fullTime, localIso, relTime, shortDate, weekdayDate, whenLabel } from './dates.js';
import { $, autoGrow, h, icon, toast } from './dom.js';
import { describeRepeat, duplicateDraft, placeDrafts } from './model.js';
import { addTeamNamed } from './settings.js';
import { app, state, upsert } from './state.js';

const form = () => $('#task-form');
const field = (name) => form().elements.namedItem(name);
const NEW_TEAM = '__new';

// ---------- Open and close ----------

let hideTimer;

export async function openTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  showPanel(task);
  try {
    const detail = await api(`/tasks/${encodeURIComponent(id)}`);
    if (state.current && state.current.id === id) applyDetail(detail);
  } catch (err) {
    notify(err);
  }
}

// A new task, optionally pre-filled (from quick add's "Add details…", or Duplicate).
export function openNew(prefill = null) {
  showPanel(null);
  if (!prefill) return;
  if (prefill.title) field('title').value = prefill.title;
  if (prefill.description) field('description').value = prefill.description;
  if (prefill.target_date) field('target_date').value = prefill.target_date;
  if (prefill.planned_on) field('planned_on').value = prefill.planned_on;
  if (prefill.priority) field('high').checked = prefill.priority === HIGH;
  if (prefill.team_id != null) field('team_id').value = String(prefill.team_id);
  setRepeatField(prefill.recurrence ?? null);
  if (prefill.steps) renderSteps(placeDrafts(prefill.steps, field('target_date').value || null));
  requestAnimationFrame(() => { autoGrow(field('title')); autoGrow(field('description')); });
  renderSummary();
  if (prefill.title) setDirty(true);
}

function showPanel(task) {
  clearTimeout(hideTimer);
  state.current = task;
  state.panelOpen = true;
  fillForm(task);
  $('#drawer-eyebrow').textContent = task ? 'Task' : 'New task';
  $('#task-menu-wrap').hidden = !task;
  closeTaskMenu();
  $('#create-actions').hidden = Boolean(task);
  $('#status-field').hidden = !task; // a new task is always Open
  $('#log-section').hidden = !task;
  $('#task-fields').open = !task;
  $('#log-note').value = '';
  $('#step-input').value = '';
  app.closeInlineAssist();
  renderSteps(task ? task.subtasks || [] : []);
  renderTimeline(null);
  renderMeta(task);

  const drawer = $('#drawer');
  const scrim = $('#scrim');
  drawer.hidden = false;
  scrim.hidden = false;
  document.body.classList.add('drawer-open');
  requestAnimationFrame(() => {
    drawer.classList.add('open');
    scrim.classList.add('open');
    if (task) drawer.focus();
    else field('title').focus();
  });
}

export async function closePanel() {
  if (!state.panelOpen) return;
  if (!state.current && state.dirty && !confirm('Discard this new task?')) return;
  await flushText();
  state.panelOpen = false;
  state.current = null;
  setDirty(false);
  const drawer = $('#drawer');
  const scrim = $('#scrim');
  drawer.classList.remove('open');
  scrim.classList.remove('open');
  document.body.classList.remove('drawer-open');
  hideTimer = setTimeout(() => { drawer.hidden = true; scrim.hidden = true; }, 240);
}

function setDirty(dirty) {
  state.dirty = dirty;
}

// ---------- The form ----------

const newTaskTeam = () => (/^\d+$/.test(state.team) ? Number(state.team) : null);

function fillForm(task) {
  const t = task || { title: '', description: '', status: OPEN, priority: NORMAL, target_date: '', team_id: newTaskTeam() };
  field('title').value = t.title;
  field('description').value = t.description;
  fillFields(t);
  requestAnimationFrame(() => { autoGrow(field('title')); autoGrow(field('description')); });
  setDirty(false);
}

// Everything but the two text boxes, so a save landing while you type doesn't move your caret.
function fillFields(t) {
  field('status').value = t.status in STATUS ? t.status : OPEN;
  field('planned_on').value = t.planned_on || '';
  field('target_date').value = t.target_date || '';
  field('team_id').value = t.team_id == null ? '' : String(t.team_id);
  field('high').checked = t.priority === HIGH;
  setRepeatField(t.recurrence || null);
  showWhenLabel();
  renderSummary();
}

function readForm() {
  return {
    title: field('title').value.trim(),
    description: field('description').value.trim(),
    status: field('status').value,
    planned_on: field('planned_on').value || null,
    priority: field('high').checked ? HIGH : NORMAL,
    target_date: field('target_date').value || null,
    team_id: field('team_id').value && field('team_id').value !== NEW_TEAM ? Number(field('team_id').value) : null,
    recurrence: readRepeatField(),
  };
}

// "Repeats" is one select, plus a number for "N days after done".
function setRepeatField(recurrence) {
  const after = recurrence?.startsWith('after:');
  field('recurrence').value = after ? 'after' : recurrence || '';
  if (after) field('repeat_days').value = recurrence.slice(6);
  $('#repeat-days-field').hidden = !after;
}

function readRepeatField() {
  const v = field('recurrence').value;
  if (v !== 'after') return v || null;
  const n = Math.min(365, Math.max(1, Math.round(Number(field('repeat_days').value) || 7)));
  return `after:${n}`;
}

// A Waiting task's "when" is the day to chase it.
function showWhenLabel() {
  $('#when-label').textContent = field('status').value === WAITING ? 'Chase on' : 'When';
}

// The one line that stands for all the fields: "Open · Tomorrow · Deadline Fri 10 Oct · High · RDH".
function renderSummary() {
  const f = readForm();
  const parts = [STATUS[f.status]];
  if (f.planned_on && f.status !== DONE) parts.push(f.status === WAITING ? `chase ${shortDate(f.planned_on)}` : whenLabel(f.planned_on));
  if (f.target_date) parts.push(`Deadline ${weekdayDate(f.target_date)}`);
  if (f.priority === HIGH) parts.push(PRIORITY.high);
  const team = state.teams.find((t) => t.id === f.team_id);
  if (team) parts.push(team.name);
  if (f.recurrence) parts.push(describeRepeat(f.recurrence));
  const due = f.target_date && f.status !== DONE ? dueInfo({ target_date: f.target_date, status: f.status }) : null;
  $('#task-summary').replaceChildren(
    h('span', { class: `summary-text${due?.cls === 'overdue' ? ' overdue' : ''}`, text: parts.join(' · ') }),
    h('span', { class: 'summary-edit', text: 'Edit' }));
}

export function renderMeta(task) {
  $('#task-meta').textContent = task
    ? `Created ${shortDate(task.created_at)} · Updated ${relTime(task.updated_at)}${task.completed_at ? ` · Done ${shortDate(task.completed_at)}` : ''}`
    : '';
}

// ---------- Saving ----------

let textTimer = null;

// A saved task: send what changed. The server's copy then replaces ours.
async function save(changes) {
  const task = state.current;
  if (!task) return;
  const diff = {};
  for (const [k, v] of Object.entries(changes)) if (v !== (task[k] ?? null) && !(k === 'description' && v === (task[k] ?? ''))) diff[k] = v;
  if (!Object.keys(diff).length) return;
  state.current = { ...task, ...diff };
  try {
    const detail = await api(`/tasks/${encodeURIComponent(task.id)}`, { method: 'PATCH', body: diff });
    applyDetail(detail);
    if (diff.status === DONE && !detail.next_task) toast('Nice — marked as done');
  } catch (err) {
    notify(err);
    if (state.current?.id === task.id) {
      state.current = task;
      fillFields(task);
    }
  }
}

function saveText() {
  clearTimeout(textTimer);
  textTimer = null;
  if (!state.current) return Promise.resolve();
  const title = field('title').value.trim();
  if (!title) return Promise.resolve(); // restored on leaving the field
  return save({ title, description: field('description').value.trim() });
}

function flushText() {
  return textTimer ? saveText() : Promise.resolve();
}

function onFieldChange(e) {
  const t = e.target;
  if (t === field('team_id') && t.value === NEW_TEAM) return newTeamFromPicker();
  if (t === field('status')) {
    // Waiting means someone else has it: chase in two days unless a later day is set.
    const today = localIso();
    if (t.value === WAITING && !(field('planned_on').value > today)) field('planned_on').value = addDays(today, 2);
    showWhenLabel();
  }
  if (t === field('recurrence')) $('#repeat-days-field').hidden = t.value !== 'after';
  if (t === field('target_date') && !state.current) renderSteps(placeDrafts(state.steps, t.value || null));
  renderSummary();
  if (!state.current) return;
  const f = readForm();
  const byField = {
    status: { status: f.status, planned_on: f.planned_on },
    planned_on: { planned_on: f.planned_on },
    target_date: { target_date: f.target_date },
    team_id: { team_id: f.team_id },
    high: { priority: f.priority },
    recurrence: { recurrence: f.recurrence },
    repeat_days: { recurrence: f.recurrence },
  };
  if (byField[t.name]) save(byField[t.name]);
}

async function newTeamFromPicker() {
  const pick = field('team_id');
  const previous = state.current?.team_id == null ? '' : String(state.current?.team_id ?? '');
  const name = prompt('New team name');
  const team = name && name.trim() ? await addTeamNamed(name.trim()) : null;
  pick.value = team ? String(team.id) : previous;
  renderSummary();
  if (team && state.current) save({ team_id: team.id });
}

// A new task: one Create button sends everything, steps included.
async function createTask(e) {
  e.preventDefault();
  if (state.current) return;
  const data = readForm();
  if (!data.title) {
    toast('Give the task a title first', 'error');
    field('title').focus();
    return;
  }
  const btn = $('#save-btn');
  btn.disabled = true;
  try {
    const steps = state.steps.map(({ title, target_date: d }) => ({ title, target_date: d || null }));
    const detail = await api('/tasks', { method: 'POST', body: { ...data, subtasks: steps } });
    upsert(detail.task);
    setDirty(false);
    showPanel(detail.task);
    applyDetail(detail);
    toast('Task created');
  } catch (err) {
    notify(err);
  } finally {
    btn.disabled = false;
  }
}

// After any change to a task: the list, and the panel if it shows that task.
export function applyDetail({ task, updates, subtasks, next_task: nextTask }) {
  upsert(task);
  // Marking a repeating task done made the next one.
  if (nextTask) {
    upsert(nextTask);
    toast(`Done. Next one is due ${shortDate(nextTask.target_date || nextTask.planned_on)}`);
  }
  if (state.panelOpen && state.current && state.current.id === task.id) {
    state.current = task;
    const active = document.activeElement;
    if (active !== field('title') && !textTimer) field('title').value = task.title;
    if (active !== field('description') && !textTimer) field('description').value = task.description;
    fillFields(task);
    if (updates) renderTimeline(updates);
    if (subtasks) renderSteps(subtasks);
    renderMeta(task);
  }
  app.render();
}

// ---------- ⋯ menu ----------

function toggleTaskMenu(open) {
  const menu = $('#task-menu');
  const show = open ?? menu.hidden;
  menu.hidden = !show;
  $('#task-menu-btn').setAttribute('aria-expanded', String(show));
  if (show) menu.querySelector('button').focus();
}
const closeTaskMenu = () => toggleTaskMenu(false);

async function duplicateTask() {
  closeTaskMenu();
  const task = state.current;
  if (!task) return;
  await flushText();
  const draft = duplicateDraft(task, state.steps);
  openNew(draft);
  toast(task.target_date ? 'Copy ready: set its due date and the steps follow, then Create' : 'Copy ready: adjust it, then Create');
}

async function deleteTask() {
  closeTaskMenu();
  const task = state.current;
  if (!task || !confirm(`Delete "${task.title}" and its whole log? This can't be undone.`)) return;
  try {
    await api(`/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE' });
    state.tasks = state.tasks.filter((t) => t.id !== task.id);
    clearTimeout(textTimer);
    textTimer = null;
    await closePanel();
    app.render();
    toast('Task deleted');
  } catch (err) {
    notify(err);
  }
}

// ---------- Log ----------

export function renderTimeline(updates) {
  const ol = $('#timeline');
  if (!updates) return ol.replaceChildren(h('li', { class: 'timeline-empty', text: 'Loading…' }));
  if (!updates.length) return ol.replaceChildren(h('li', { class: 'timeline-empty', text: 'Nothing logged yet.' }));
  ol.replaceChildren(...updates.map((u) => {
    const time = h('time', { datetime: u.created_at, title: fullTime(u.created_at), text: relTime(u.created_at) });
    if (u.kind === 'change') return h('li', { class: 'tl-change' }, h('span', { class: 'tl-dot' }), h('span', { text: u.note }), time);
    return h('li', { class: 'tl-note' },
      h('span', { class: 'tl-dot' }),
      h('div', { class: 'tl-card' },
        h('div', { class: 'tl-meta' },
          time,
          h('button', { type: 'button', class: 'icon-btn tl-del', title: 'Delete entry', 'aria-label': 'Delete entry', onclick: () => deleteEntry(u.id) }, icon('trash', 14))),
        h('p', { class: 'tl-text', text: u.note })));
  }));
}

async function postEntry() {
  const task = state.current;
  const noteEl = $('#log-note');
  const note = noteEl.value.trim();
  if (!task) return;
  if (!note) return noteEl.focus();
  const btn = $('#post-log');
  btn.disabled = true;
  try {
    const detail = await api(`/tasks/${encodeURIComponent(task.id)}/updates`, { method: 'POST', body: { note } });
    if (noteEl.value.trim() === note) noteEl.value = '';
    app.closeInlineAssist();
    applyDetail(detail);
    toast('Logged');
  } catch (err) {
    notify(err);
  } finally {
    btn.disabled = false;
  }
}

async function deleteEntry(updateId) {
  const task = state.current;
  if (!task || !confirm('Delete this entry?')) return;
  try {
    applyDetail(await api(`/tasks/${encodeURIComponent(task.id)}/updates/${encodeURIComponent(updateId)}`, { method: 'DELETE' }));
  } catch (err) {
    notify(err);
  }
}

// ---------- Steps ----------
// On a saved task each change is sent straight away and the server's copy replaces ours.
// While creating a task they are drafts, sent along with Create.

const stepPath = (id = '') => `/tasks/${encodeURIComponent(state.current.id)}/subtasks${id ? `/${encodeURIComponent(id)}` : ''}`;

export function renderSteps(steps) {
  state.steps = steps;
  const done = steps.filter((st) => st.done).length;
  $('#step-count').textContent = steps.length ? `${done} of ${steps.length} done` : '';
  $('#step-list').replaceChildren(...steps.map((st, i) => stepItem(st, i)));
}

function stepItem(st, i) {
  const draft = !state.current;
  const title = h('input', { class: 'subtask-title', value: st.title, maxlength: '200', 'aria-label': 'Step', enterkeyhint: 'done' });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); title.blur(); }
    if (e.key === 'Escape') { e.stopPropagation(); title.value = st.title; title.blur(); }
  });
  title.addEventListener('change', () => renameStep(i, title.value));
  return h('li', { class: `subtask${st.done ? ' is-done' : ''}` },
    h('button', {
      type: 'button',
      class: 'check sm',
      disabled: draft,
      title: draft ? 'Create the task to tick off steps' : st.done ? 'Mark as not done' : 'Mark as done',
      'aria-label': `${st.done ? 'Mark not done' : 'Mark done'}: ${st.title}`,
      onclick: () => toggleStep(i),
    }, icon('check', 12)),
    title,
    dateChip(st.target_date, (value) => setStepDate(i, value), { done: Boolean(st.done) }),
    h('button', {
      type: 'button', class: 'icon-btn subtask-del', title: 'Delete step', 'aria-label': `Delete step: ${st.title}`,
      onclick: () => removeStep(i),
    }, icon('x', 15)));
}

// A friendly date label with the device's own date picker laid transparently over it.
function dateChip(value, onChange, { done = false } = {}) {
  const info = value ? dueInfo({ target_date: value, status: done ? DONE : OPEN }) : null;
  const input = h('input', { type: 'date', class: 'date-chip-input', value: value || '', 'aria-label': value ? `Due ${shortDate(value)}. Change date` : 'Add a due date' });
  input.addEventListener('click', () => { try { input.showPicker(); } catch { /* not supported: a tap opens it */ } });
  input.addEventListener('change', () => onChange(input.value || null));
  return h('span', { class: 'date-chip-wrap' },
    h('span', { class: `date-chip ${info ? info.cls || 'set' : 'unset'}`, title: info?.title || (value ? shortDate(value) : 'Add a due date') },
      icon('calendar', 13),
      info ? h('span', { text: info.label === 'No date' ? shortDate(value) : info.label }) : h('span', { class: 'date-chip-placeholder', text: 'Date' }),
      input),
    value && h('button', { type: 'button', class: 'icon-btn date-clear', title: 'Remove date', 'aria-label': 'Remove date', onclick: () => onChange(null) }, icon('x', 12)));
}

async function stepCall(path, options) {
  try {
    applyDetail(await api(path, options));
  } catch (err) {
    notify(err);
    if (state.current) renderSteps(state.steps);
  }
}

function setStepDate(i, value) {
  const st = state.steps[i];
  if (!st || (st.target_date || null) === value) return;
  // A draft dated by hand stops following the due date.
  if (!state.current) return renderSteps(state.steps.map((x, j) => (j === i ? { ...x, target_date: value, offset_days: null } : x)));
  return stepCall(stepPath(st.id), { method: 'PATCH', body: { target_date: value } });
}

async function addStep() {
  const input = $('#step-input');
  const title = input.value.trim();
  if (!title) return input.focus();
  if (!state.current) {
    renderSteps([...state.steps, { id: `draft-${state.steps.length}-${Date.now()}`, title, done: 0 }]);
    setDirty(true);
    input.value = '';
    return input.focus();
  }
  const btn = $('#step-add-btn');
  btn.disabled = true;
  try {
    applyDetail(await api(stepPath(), { method: 'POST', body: { title } }));
    // Only clear what was sent: the next step may already be half typed.
    if (input.value.trim() === title) input.value = '';
  } catch (err) {
    notify(err);
  } finally {
    btn.disabled = false;
    input.focus();
  }
}

function toggleStep(i) {
  const st = state.steps[i];
  if (!state.current || !st) return;
  renderSteps(state.steps.map((x, j) => (j === i ? { ...x, done: x.done ? 0 : 1 } : x)));
  return stepCall(stepPath(st.id), { method: 'PATCH', body: { done: !st.done } });
}

export function renameStep(i, value) {
  const st = state.steps[i];
  const title = String(value).trim();
  if (!st || title === st.title) return Promise.resolve();
  if (!title) return Promise.resolve(renderSteps(state.steps));
  if (!state.current) return Promise.resolve(renderSteps(state.steps.map((x, j) => (j === i ? { ...x, title } : x))));
  return stepCall(stepPath(st.id), { method: 'PATCH', body: { title } });
}

function removeStep(i) {
  const st = state.steps[i];
  if (!st) return;
  if (!state.current) return renderSteps(state.steps.filter((_, j) => j !== i));
  return stepCall(stepPath(st.id), { method: 'DELETE' });
}

// ---------- Wiring ----------

export function bindPanel() {
  const f = form();
  f.addEventListener('submit', createTask);
  f.addEventListener('change', (e) => {
    if (e.target.closest('.subtasks, .composer') || e.target === field('title') || e.target === field('description')) return;
    onFieldChange(e);
  });
  f.addEventListener('input', (e) => {
    const t = e.target;
    if (t === field('title') && /[\r\n]/.test(t.value)) t.value = t.value.replace(/[\r\n]+/g, ' ');
    if (t.tagName === 'TEXTAREA') autoGrow(t);
    if (t !== field('title') && t !== field('description')) return;
    if (!state.current) { setDirty(Boolean(field('title').value.trim() || field('description').value.trim())); return; }
    clearTimeout(textTimer);
    textTimer = setTimeout(saveText, 800);
  });
  for (const name of ['title', 'description']) {
    field(name).addEventListener('blur', () => {
      if (!state.current) return;
      if (name === 'title' && !field('title').value.trim()) {
        field('title').value = state.current.title;
        autoGrow(field('title'));
        toast('A task needs a title', 'error');
      }
      saveText();
    });
  }
  f.addEventListener('keydown', (e) => {
    // The title wraps like a paragraph but is one line: Enter creates (new) or finishes (saved).
    if (e.target === field('title') && e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      if (state.current) field('title').blur();
      else f.requestSubmit();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && e.target.id === 'log-note') {
      e.preventDefault();
      postEntry();
    }
  });
  $('#close-drawer').addEventListener('click', () => closePanel());
  $('#scrim').addEventListener('click', () => closePanel());
  $('#post-log').addEventListener('click', postEntry);
  $('#step-add-btn').addEventListener('click', addStep);
  $('#step-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addStep(); }
  });
  $('#task-menu-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleTaskMenu(); });
  $('#duplicate-btn').addEventListener('click', duplicateTask);
  $('#delete-btn').addEventListener('click', deleteTask);
  document.addEventListener('click', (e) => { if (!e.target.closest('#task-menu-wrap')) closeTaskMenu(); });
}

// Team picker: the teams, then "New team…" at the end.
export function fillTeamPicker() {
  const pick = field('team_id');
  const current = pick.value;
  pick.replaceChildren(
    h('option', { value: '', text: 'No team' }),
    ...state.teams.map((t) => h('option', { value: String(t.id), text: t.name })),
    h('option', { value: NEW_TEAM, text: 'New team…' }));
  pick.value = state.teams.some((t) => String(t.id) === current) ? current : '';
}

export { field as panelField };
