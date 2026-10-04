// The three views: Today (act), Tasks (find and plan), Review (look back).
import { addDays, DONE, HIGH, nextMonday, OPEN, STATUS, WAITING } from '../shared/rules.js';
import { api, notify } from './api.js';
import { localIso, dueInfo, shortDate } from './dates.js';
import { $, h, icon, toast } from './dom.js';
import { computeInsights, describeRepeat, filterTasks, planWeek, TODAY_GROUPS } from './model.js';
import { app, inTeamFilter, state, store, upsert } from './state.js';

// A row ticked off stays where it is, shown done, for a moment before the list redraws.
// Redrawing at once slid the next row under the finger: on iPhone it then looked ticked
// (hover sticks to whatever is under the last touch), and a second quick tap ticked it.
const HOLD_MS = 700;
let holdUntil = 0;
let heldRender = null;

function holdRow(row) {
  row.classList.add('is-done', 'is-leaving');
  holdUntil = Date.now() + HOLD_MS;
}

export function render() {
  const wait = holdUntil - Date.now();
  if (wait > 0) {
    clearTimeout(heldRender);
    heldRender = setTimeout(render, wait);
    return;
  }
  renderToolbar();
  const root = $('#tasks');
  root.replaceChildren();
  if (!state.loaded) return root.append(skeleton());
  if (state.view === 'review') return renderReview(root);
  if (!state.tasks.length) return root.append(emptyState(true));
  const tasks = state.tasks.filter(inTeamFilter);
  if (state.view === 'today') return renderToday(root, tasks);
  const list = filterTasks(state.tasks, { status: state.status, q: state.q, highOnly: state.highOnly, sort: state.sort, inTeam: inTeamFilter });
  if (!list.length) return root.append(emptyState(false));
  root.append(h('div', { class: 'list', role: 'list' }, list.map((t) => taskRow(t, { menu: t.status !== DONE }))));
}

function renderToolbar() {
  document.body.dataset.view = state.view;
  for (const b of document.querySelectorAll('#view-toggle button')) b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
  for (const b of document.querySelectorAll('#status-filter button')) b.setAttribute('aria-pressed', String(!state.q && b.dataset.status === state.status));
  $('#high-toggle').setAttribute('aria-pressed', String(state.highOnly));
  $('#sort').value = state.sort;
  $('#plan-btn-label').textContent = planWhich() === 'tomorrow' ? 'Plan tomorrow' : 'Plan today';
}

// From 5 pm, planning is for tomorrow.
export const planWhich = () => (new Date().getHours() >= 17 ? 'tomorrow' : 'today');

export function setView(view) {
  state.view = view;
  store.set('wt.view', view);
  render();
}

export function setStatusFilter(status) {
  state.status = status;
  store.set('wt.filter', status);
  render();
}

// ---------- Rows ----------

const waitingPill = (t) => t.status === WAITING && h('span', { class: 'pill status-blocked', text: t.waiting_until ? `Waiting · chase ${shortDate(t.waiting_until)}` : 'Waiting' });

function stepChip(t) {
  const total = t.subtask_total || 0;
  if (!total) return h('span', { class: 'subtask-chip is-none', 'aria-hidden': 'true' });
  const done = t.subtask_done || 0;
  return h('span', { class: `subtask-chip${done === total ? ' complete' : ''}`, title: `${done} of ${total} steps done` }, icon('steps', 14), `${done}/${total}`);
}

// Today only lists dated or planned work, so "No date" there is noise.
function dueLabel(t, quiet) {
  if (quiet && !t.target_date) return h('span', { class: 'due' });
  const d = dueInfo(t);
  return h('span', { class: `due ${d.cls}`, title: d.title, text: d.label });
}

const repeatMark = (t) => t.recurrence && h('span', { class: 'repeat-mark', title: `Repeats: ${describeRepeat(t.recurrence)}`, 'aria-label': `Repeats ${describeRepeat(t.recurrence)}` }, icon('repeat', 13));

function checkButton(t) {
  const done = t.status === DONE;
  return h('button', {
    type: 'button',
    class: 'check',
    title: done ? 'Mark as not done' : 'Mark as done',
    'aria-label': done ? `Mark "${t.title}" as not done` : `Mark "${t.title}" as done`,
    onclick: (e) => {
      e.stopPropagation();
      if (!done) holdRow(e.currentTarget.closest('.row'));
      patchTask(t.id, { status: done ? OPEN : DONE });
    },
  }, icon('check', 13));
}

function taskRow(t, { menu = false, quiet = false } = {}) {
  return h('div', {
    class: `row${t.priority === HIGH ? ' is-high' : ''}${t.status === DONE ? ' is-done' : ''}`,
    role: 'listitem',
    onclick: () => app.openTask(t.id),
  },
  checkButton(t),
  h('button', { type: 'button', class: 'row-main', 'aria-label': `Open ${t.title}` },
    h('span', { class: 'row-title' },
      t.priority === HIGH && h('span', { class: 'prio-badge', text: 'High' }),
      h('span', { class: 'text', text: t.title }),
      repeatMark(t)),
    h('span', { class: 'row-sub' },
      waitingPill(t),
      t.team_name && h('span', { class: 'tag', text: t.team_name }),
      t.last_note && h('span', { class: 'last-note', text: t.last_note }))),
  stepChip(t),
  dueLabel(t, quiet),
  menu ? rowMenuButton({ kind: 'task', task: t }) : h('span', { class: 'row-menu-slot', 'aria-hidden': 'true' }));
}

function stepRow(item) {
  const { task: t, step: st } = item;
  const due = dueInfo({ target_date: st.target_date, status: OPEN });
  return h('div', { class: 'row is-step', role: 'listitem', onclick: () => app.openTask(t.id) },
    h('button', {
      type: 'button',
      class: 'check sm',
      title: 'Mark step as done',
      'aria-label': `Mark done: ${st.title}`,
      onclick: (e) => {
        e.stopPropagation();
        holdRow(e.currentTarget.closest('.row'));
        toggleStepOf(t.id, st.id);
      },
    }, icon('check', 12)),
    h('button', { type: 'button', class: 'row-main', 'aria-label': `Open ${t.title}` },
      h('span', { class: 'row-title' }, h('span', { class: 'text', text: st.title })),
      h('span', { class: 'row-sub' },
        h('span', { class: 'parent-task' }, h('span', { text: `in ${t.title}` })),
        t.team_name && h('span', { class: 'tag', text: t.team_name }))),
    h('span', { class: 'subtask-chip is-none', 'aria-hidden': 'true' }),
    h('span', { class: `due ${due.cls}`, title: due.title, text: due.label }),
    rowMenuButton(item));
}

// ---------- Today ----------

function renderToday(root, tasks) {
  const groups = planWeek(tasks);
  const sections = TODAY_GROUPS.filter((g) => groups[g.key].length).map((g) =>
    h('section', { class: `today-group today-${g.key}`, 'aria-label': g.label },
      h('h2', { class: 'today-head' }, g.label, h('span', { class: 'count', text: groups[g.key].length })),
      h('div', { class: 'list', role: 'list' }, groups[g.key].map((item) => (item.kind === 'task' ? taskRow(item.task, { menu: true, quiet: true }) : stepRow(item))))));
  if (!sections.length) {
    return root.append(h('div', { class: 'empty' },
      h('span', { class: 'empty-icon' }, icon('check', 22)),
      h('h2', { text: 'Nothing planned or due this week' }),
      h('p', { text: 'Plan your day, or give tasks and steps a due date and they show up here.' }),
      h('button', { type: 'button', class: 'btn', onclick: () => setView('tasks') }, 'See all tasks')));
  }
  root.append(h('div', { class: 'today' }, sections));
}

// ---------- One-tap reschedule ----------

function rowMenuButton(item) {
  const name = item.kind === 'task' ? item.task.title : item.step.title;
  return h('button', {
    type: 'button',
    class: 'icon-btn row-menu-btn',
    title: 'Reschedule or plan',
    'aria-label': `Reschedule: ${name}`,
    onclick: (e) => { e.stopPropagation(); openRowMenu(item); },
  }, icon('clock', 16));
}

let menuItem = null;

function openRowMenu(item) {
  menuItem = item;
  const today = localIso();
  const isTask = item.kind === 'task';
  const t = item.task;
  $('#row-menu-title').textContent = isTask ? t.title : item.step.title;
  const due = (date) => () => { closeRowMenu(); setDue(item, date); };
  const actions = [
    h('button', { type: 'button', class: 'btn', onclick: due(addDays(today, 1)) }, 'Due tomorrow'),
    h('button', { type: 'button', class: 'btn', onclick: due(nextMonday(today)) }, 'Due next week'),
  ];
  if (isTask) {
    const planned = t.planned_on && t.planned_on <= today;
    actions.unshift(h('button', {
      type: 'button',
      class: 'btn',
      onclick: () => { closeRowMenu(); patchTask(t.id, { planned_on: planned ? null : today }); },
    }, planned ? "Remove from today's plan" : "Add to today's plan"));
    actions.push(t.status === WAITING
      ? h('button', { type: 'button', class: 'btn', onclick: () => { closeRowMenu(); patchTask(t.id, { status: OPEN }); } }, 'No longer waiting')
      : h('button', { type: 'button', class: 'btn', onclick: () => { closeRowMenu(); patchTask(t.id, { status: WAITING, waiting_until: addDays(today, 2) }); } }, 'Waiting · chase in 2 days'));
  }
  $('#row-menu-actions').replaceChildren(...actions);
  $('#row-menu-date').value = (isTask ? t.target_date : item.step.target_date) || '';
  $('#row-menu').showModal();
}

export function closeRowMenu() {
  if ($('#row-menu').open) $('#row-menu').close();
}

export function pickRowMenuDate(value) {
  if (!menuItem || !value) return;
  const item = menuItem;
  closeRowMenu();
  setDue(item, value);
}

function setDue(item, date) {
  if (item.kind === 'task') return patchTask(item.task.id, { target_date: date });
  return patchStepOf(item.task.id, item.step.id, { target_date: date }, `Moved to ${shortDate(date)}`);
}

// ---------- Review ----------

const weekLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function renderReview(root) {
  const teamName = state.team === 'all' ? null : state.team === 'none' ? 'No team' : state.teams.find((t) => String(t.id) === state.team)?.name;
  const ins = computeInsights(state.tasks.filter(inTeamFilter));
  const pct = (x) => `${Math.round(x * 100)}%`;
  const tiles = [
    { label: 'Done, last 30 days', value: String(ins.done30) },
    { label: 'On time, last 90 days', value: ins.onTimeRate == null ? '–' : pct(ins.onTimeRate), note: ins.dated ? `of ${ins.dated} with a due date` : 'no dated tasks done yet' },
    { label: 'Overdue now', value: String(ins.overdue), alert: ins.overdue > 0 },
    { label: 'Waiting', value: String(ins.waiting) },
  ];
  const max = Math.max(1, ...ins.weeks.map((w) => w.count));
  const last = ins.weeks.length - 1;
  const chart = h('div', { class: 'ins-chart', role: 'img', 'aria-label': `Tasks done per week, last ${ins.weeks.length} weeks` },
    ins.weeks.map((w, i) => h('div', { class: 'ins-col' },
      h('button', { type: 'button', class: 'ins-bar-hit', 'aria-label': `Week of ${weekLabel(w.start)}: ${w.count} done` },
        h('span', { class: 'ins-tip', text: `Week of ${weekLabel(w.start)} · ${w.count} done` }),
        i === last && h('span', { class: 'ins-cap', text: String(w.count) }),
        h('span', { class: `ins-bar${w.count ? '' : ' is-zero'}`, vars: { '--h': `${(w.count / max) * 100}%` } })),
      h('span', { class: 'ins-x', text: i % 3 === last % 3 ? weekLabel(w.start) : '' }))));
  const table = (head, rows) => h('table', { class: 'ins-table' },
    h('thead', null, h('tr', null, head.map((c, i) => h('th', { scope: 'col', class: i ? 'num' : null, text: c })))),
    h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => (i ? h('td', { class: 'num', text: c }) : h('th', { scope: 'row', text: c })))))));
  root.append(h('div', { class: 'review' },
    h('p', { class: 'hint', text: teamName ? `For ${teamName}. The team filter narrows this.` : 'All teams. The team filter narrows this.' }),
    h('div', { class: 'ins-tiles' }, tiles.map((t) => h('div', { class: `ins-tile${t.alert ? ' alert' : ''}` },
      h('span', { class: 'stat-label', text: t.label }),
      h('span', { class: 'stat-value', text: t.value }),
      t.note && h('span', { class: 'ins-note', text: t.note })))),
    h('section', { class: 'ins-section' },
      h('h3', { text: 'Done per week' }),
      chart,
      h('details', { class: 'ins-details' }, h('summary', { text: 'Show as a table' }),
        table(['Week of', 'Done'], ins.weeks.map((w) => [weekLabel(w.start), String(w.count)])))),
    h('section', { class: 'ins-section' },
      h('h3', { text: 'By team' }),
      ins.teams.length
        ? table(['Team', 'Open', 'Overdue', 'Done (90d)', 'On time'], ins.teams.map((t) => [
          t.name, String(t.open), String(t.overdue), String(t.done90), t.dated ? pct(t.onTime / t.dated) : '–',
        ]))
        : h('p', { class: 'hint', text: 'No tasks yet.' }))));
}

// ---------- Empty and loading ----------

function emptyState(firstRun) {
  return h('div', { class: 'empty' },
    h('span', { class: 'empty-icon' }, icon(firstRun ? 'clipboard' : 'search', 22)),
    h('h2', { text: firstRun ? 'No tasks yet' : 'Nothing here' }),
    h('p', { text: firstRun
      ? 'Capture your first task: give it a due date and steps, then log what happens as you go.'
      : state.q ? 'No task matches that search.' : `No ${STATUS[state.status].toLowerCase()} tasks${state.highOnly ? ' flagged High' : ''}.` }),
    firstRun
      ? h('button', { type: 'button', class: 'btn primary', onclick: () => app.openQuickAdd() }, icon('plus'), 'New task')
      : (state.q || state.highOnly) && h('button', { type: 'button', class: 'btn', onclick: clearFilters }, 'Clear search and filters'));
}

function skeleton() {
  return h('div', { class: 'list' }, Array.from({ length: 5 }, () => h('div', { class: 'skeleton' })));
}

export function clearFilters() {
  state.q = '';
  $('#search').value = '';
  state.highOnly = false;
  render();
}

// ---------- Changes made from a row ----------

export async function patchTask(id, changes) {
  const i = state.tasks.findIndex((t) => t.id === id);
  if (i === -1) return;
  const before = state.tasks[i];
  state.tasks[i] = { ...before, ...changes };
  render();
  try {
    const detail = await api(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes });
    app.applyDetail(detail);
    // Undo puts back the state it had (and a Waiting task's chase date). Not offered when
    // a repeating task has already made its next one.
    if (changes.status === DONE && !detail.next_task) {
      const back = before.status === WAITING ? { status: WAITING, waiting_until: before.waiting_until ?? null } : { status: before.status };
      toast(`Done: ${before.title}`, 'info', { label: 'Undo', run: () => patchTask(id, back) });
    }
  } catch (err) {
    state.tasks[i] = before;
    render();
    notify(err);
  }
}

async function patchStepOf(taskId, stepId, body, message) {
  const before = state.tasks.find((x) => x.id === taskId);
  if (!before) return;
  const steps = (before.subtasks || []).map((x) => (x.id === stepId ? { ...x, ...body, done: 'done' in body ? (body.done ? 1 : 0) : x.done } : x));
  upsert({ ...before, subtasks: steps, subtask_done: steps.filter((x) => x.done).length });
  render();
  try {
    app.applyDetail(await api(`/tasks/${encodeURIComponent(taskId)}/subtasks/${encodeURIComponent(stepId)}`, { method: 'PATCH', body }));
    if (message) toast(message);
  } catch (err) {
    upsert(before);
    render();
    notify(err);
  }
}

function toggleStepOf(taskId, stepId) {
  const st = state.tasks.find((x) => x.id === taskId)?.subtasks?.find((x) => x.id === stepId);
  if (st) patchStepOf(taskId, stepId, { done: !st.done });
}
