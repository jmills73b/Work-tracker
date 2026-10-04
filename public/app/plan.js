// The daily plan: a short list of what's worth doing on a day (anything already planned,
// due, to chase, or High and due soon), each with a tick to put it in that day's plan.
// Opened from Today, or by tapping the evening reminder (/?plan=tomorrow). The list keeps
// its order while open, so a tick never moves a row from under your finger.
import { addDays, HIGH } from '../shared/rules.js';
import { localIso, dueInfo, shortDate, weekdayDate } from './dates.js';
import { $, h } from './dom.js';
import { planCandidates } from './model.js';
import { inTeamFilter, state } from './state.js';
import { patchTask } from './views.js';

let planDay = null;

export function openPlan(which = 'today') {
  const today = localIso();
  planDay = which === 'tomorrow' ? addDays(today, 1) : today;
  $('#plan-title').textContent = which === 'tomorrow' ? `Plan tomorrow, ${weekdayDate(planDay)}` : 'Plan today';
  $('#plan-hint').textContent = 'Tick what you will work on. Planned tasks lead Today; anything unfinished carries over.';
  renderPlan();
  if (!$('#plan-dialog').open) $('#plan-dialog').showModal();
}

export function renderPlan() {
  if (!planDay) return;
  const list = planCandidates(state.tasks.filter(inTeamFilter), planDay);
  if (!list.length) {
    $('#plan-list').replaceChildren(h('li', { class: 'hint', text: 'Nothing has a deadline by then or is flagged High. To plan any other task, use the clock button on its row.' }));
    return;
  }
  $('#plan-list').replaceChildren(...list.map((t) => {
    const planned = t.planned_on === planDay;
    // The badge already says High; the reason is the deadline, or a day it carried over from.
    const due = t.target_date && dueInfo(t);
    const why = due ? (due.cls === 'overdue' ? due.label : `Deadline ${due.label}`)
      : t.planned_on && t.planned_on < planDay ? `From ${shortDate(t.planned_on)}` : '';
    return h('li', { class: `plan-item${planned ? ' is-planned' : ''}` },
      h('label', null,
        h('input', {
          type: 'checkbox',
          checked: planned,
          'aria-label': `Plan: ${t.title}`,
          onchange: (e) => {
            e.target.closest('.plan-item').classList.toggle('is-planned', e.target.checked);
            patchTask(t.id, { planned_on: e.target.checked ? planDay : null });
          },
        }),
        h('span', { class: 'plan-title', text: t.title }),
        t.priority === HIGH && h('span', { class: 'prio-badge', text: 'High' }),
        why && h('span', { class: 'plan-why', text: why })));
  }));
}

export function bindPlan() {
  $('#plan-done').addEventListener('click', () => $('#plan-dialog').close());
  $('#plan-dialog').addEventListener('close', () => { planDay = null; });
}

