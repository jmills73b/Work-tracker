// Entry point: wires the modules together, binds the toolbar and keyboard, and loads.
import { api } from './api.js';
import { bindAssist, closeInlineAssist } from './assist.js';
import { $, h } from './dom.js';
import { applyDetail, bindPanel, closePanel, openTask } from './panel.js';
import { bindPlan, openPlan } from './plan.js';
import { bindQuickAdd, openQuickAdd } from './quickadd.js';
import { applyTheme, bindSettings, registerServiceWorker, setTeams, setUser } from './settings.js';
import { app, state, store } from './state.js';
import { closeRowMenu, pickRowMenuDate, planWhich, render, setStatusFilter, setView } from './views.js';

Object.assign(app, { render, applyDetail, openTask, openQuickAdd, openPlan, closeInlineAssist });

function bindToolbar() {
  $('#view-toggle').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (b) setView(b.dataset.view);
  });
  $('#status-filter').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-status]');
    if (!b) return;
    state.q = '';
    $('#search').value = '';
    setStatusFilter(b.dataset.status);
  });
  $('#high-toggle').addEventListener('click', () => { state.highOnly = !state.highOnly; render(); });
  $('#team-filter').addEventListener('change', (e) => { state.team = e.target.value; store.set('wt.team', state.team); render(); });
  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; store.set('wt.sort', state.sort); render(); });
  // Search looks across every task, so it shows in the Tasks view.
  $('#search').addEventListener('input', (e) => {
    state.q = e.target.value;
    if (state.q && state.view !== 'tasks') setView('tasks');
    else render();
  });
  $('#plan-btn').addEventListener('click', () => openPlan(planWhich()));
  $('#row-menu-date').addEventListener('change', (e) => pickRowMenuDate(e.target.value));
  $('#row-menu-close').addEventListener('click', closeRowMenu);
}

function bindKeys() {
  document.addEventListener('keydown', (e) => {
    // A dialog over the panel closes itself on Escape; the panel stays.
    if (e.key === 'Escape' && state.panelOpen && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      closePanel();
      return;
    }
    const t = e.target;
    if (e.ctrlKey || e.metaKey || e.altKey || state.panelOpen || document.querySelector('dialog[open]')) return;
    if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openQuickAdd(); }
    if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
  });
  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) e.preventDefault();
  });
}

async function loadApp() {
  const [me, list, teams] = await Promise.all([api('/auth/me'), api('/tasks'), api('/teams')]);
  setUser(me);
  setTeams(teams.teams);
  state.tasks = list.tasks;
  state.loaded = true;
  render();
  registerServiceWorker();
  // The evening reminder opens /?plan=tomorrow.
  const params = new URLSearchParams(location.search);
  if (params.get('plan') === 'tomorrow' || params.get('plan') === 'today') {
    history.replaceState(null, '', location.pathname);
    openPlan(params.get('plan'));
  }
}

async function init() {
  applyTheme(store.get('wt.theme', ''));
  bindToolbar();
  bindKeys();
  bindPanel();
  bindAssist();
  bindPlan();
  bindQuickAdd();
  bindSettings();
  render();
  try {
    await loadApp();
  } catch (err) {
    if (err.silent) return;
    $('#tasks').replaceChildren(h('div', { class: 'empty' },
      h('h2', { text: "Couldn't load your tasks" }),
      h('p', { text: err.message }),
      h('button', { type: 'button', class: 'btn', onclick: () => location.reload() }, 'Reload')));
  }
}

init();
