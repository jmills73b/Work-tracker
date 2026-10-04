// The quick-add dialog around the parser in parse.js.
import { api, notify } from './api.js';
import { dueInfo, weekdayDate } from './dates.js';
import { $, h, icon, toast } from './dom.js';
import { parseQuickAdd } from './parse.js';
import { openNew } from './panel.js';
import { app, state, upsert } from './state.js';

export function openQuickAdd() {
  $('#quick-input').value = '';
  renderQuickPreview();
  $('#quick-dialog').showModal();
  $('#quick-input').focus();
}

function renderQuickPreview() {
  const p = parseQuickAdd($('#quick-input').value, new Date(), state.teams);
  const parts = [];
  if (p.title) parts.push(h('span', { class: 'qp-title', text: p.title }));
  if (p.date) {
    const due = p.deadline ? dueInfo({ target_date: p.date, status: 'todo' }) : null;
    parts.push(h('span', { class: `date-chip ${due ? due.cls || 'set' : 'set'}` }, icon('calendar', 13),
      h('span', { text: `${p.deadline ? 'Deadline ' : ''}${weekdayDate(p.date)}` })));
  }
  if (p.priority === 'high') parts.push(h('span', { class: 'prio-badge', text: 'High' }));
  if (p.team_name) parts.push(h('span', { class: 'tag', text: p.team_name }));
  $('#quick-preview').replaceChildren(...(parts.length ? parts : [h('span', { class: 'qp-empty', text: 'Type a task; a day (or "by" a deadline), !high and #team are picked out as you go.' })]));
  $('#quick-submit').disabled = !p.title;
}

async function submitQuickAdd(e) {
  e.preventDefault();
  const p = parseQuickAdd($('#quick-input').value, new Date(), state.teams);
  if (!p.title) return;
  const body = { title: p.title };
  if (p.date) body[p.deadline ? 'target_date' : 'planned_on'] = p.date;
  if (p.priority) body.priority = p.priority;
  if (p.team_id) body.team_id = p.team_id;
  const btn = $('#quick-submit');
  btn.disabled = true;
  try {
    const detail = await api('/tasks', { method: 'POST', body });
    upsert(detail.task);
    app.render();
    $('#quick-dialog').close();
    toast(`Added "${detail.task.title}"`);
  } catch (err) {
    notify(err);
  } finally {
    btn.disabled = false;
  }
}

// Hand what was typed to the full form, for notes or steps.
function quickToDetails() {
  const p = parseQuickAdd($('#quick-input').value, new Date(), state.teams);
  $('#quick-dialog').close();
  const day = p.date ? { [p.deadline ? 'target_date' : 'planned_on']: p.date } : {};
  openNew(p.title ? { title: p.title, ...day, priority: p.priority, team_id: p.team_id } : null);
}

export function bindQuickAdd() {
  $('#new-task').addEventListener('click', openQuickAdd);
  $('#quick-input').addEventListener('input', renderQuickPreview);
  $('#quick-form').addEventListener('submit', submitQuickAdd);
  $('#quick-details').addEventListener('click', quickToDetails);
}
