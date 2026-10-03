'use strict';

(() => {
  const STATUS = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' };
  const STATUS_ORDER = Object.keys(STATUS);
  const PRIORITY = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };
  const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };

  const ICONS = {
    check: 'M5 12.5l4.5 4.5L19 7.5',
    plus: 'M12 5v14M5 12h14',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
    clipboard: 'M9 4h6v3H9zM9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 13l2 2 4-4',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
    x: 'M6 6l12 12M18 6L6 18',
    calendar: 'M8 3v3M16 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
    repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
    subtasks: 'M10 6h10M10 12h10M10 18h10M3.5 6l1.5 1.5L7.5 5M3.5 12l1.5 1.5 2.5-2.5M3.5 18l1.5 1.5 2.5-2.5',
  };

  const $ = (sel, root = document) => root.querySelector(sel);

  const store = {
    get(key, fallback) {
      try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
    },
  };

  const state = {
    tasks: [],
    loaded: false,
    view: store.get('wt.view', 'today'), // 'today', 'list' or 'board'
    status: store.get('wt.status', 'active'),
    priority: 'all',
    team: store.get('wt.team', 'all'), // 'all', 'none', or a team id as a string
    teams: [],
    sort: store.get('wt.sort', 'due'),
    q: '',
    current: null, // task open in the drawer (null = creating a new one)
    drawerOpen: false,
    subtasks: [], // the open task's subtasks, or drafts while creating a new task
    templates: [],
    dirty: false,
    assistant: false, // the server has the assistant's API key
  };

  const form = $('#task-form');
  const field = (name) => form.elements.namedItem(name);

  /* ---------- DOM helpers (user data only ever goes through textContent) ---------- */

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'vars') for (const [name, val] of Object.entries(v)) el.style.setProperty(name, val);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const child of children.flat()) {
      if (child == null || child === false || child === '') continue;
      el.append(child instanceof Node ? child : String(child));
    }
    return el;
  }

  const SPARK = [
    'M10 2.5l1.7 4.8a3 3 0 0 0 1.8 1.8L18.3 11l-4.8 1.7a3 3 0 0 0-1.8 1.8L10 19.3l-1.7-4.8a3 3 0 0 0-1.8-1.8L1.7 11l4.8-1.7a3 3 0 0 0 1.8-1.8z',
    'M19 1.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z',
    'M19.5 15.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z',
  ];

  // The assistant's ✨, filled rather than stroked like the other icons.
  function sparkIcon(size = 16) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'currentColor', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
    for (const d of SPARK) {
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    return svg;
  }

  function icon(name, size = 16) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    for (const [k, v] of Object.entries({
      viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
      'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
    })) svg.setAttribute(k, v);
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.append(path);
    return svg;
  }

  function toast(message, type = 'info') {
    const el = h('div', { class: `toast ${type}`, text: message });
    $('#toasts').append(el);
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 220);
    }, type === 'error' ? 5000 : 2400);
  }

  /* ---------- API ---------- */

  async function api(path, { method = 'GET', body } = {}) {
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

  function notify(err) {
    if (!err.silent) toast(err.message, 'error');
  }

  /* ---------- Dates ---------- */

  const dayNumber = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;

  // Whole days from `today` to an ISO date (YYYY-MM-DD); negative once it has passed.
  function daysUntil(iso, today = new Date()) {
    const [y, m, d] = iso.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000 - dayNumber(today));
  }

  function shortDate(iso, today = new Date()) {
    const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
    const opts = { month: 'short', day: 'numeric' };
    if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
  }

  function dueInfo(t, today = new Date()) {
    if (!t.target_date) return { label: 'No date', cls: 'muted' };
    const n = daysUntil(t.target_date, today);
    const date = shortDate(t.target_date, today);
    if (t.status === 'done') return { label: date, cls: 'muted' };
    if (n < 0) return { label: `${-n}d overdue`, cls: 'overdue', title: `Target was ${date}` };
    if (n === 0) return { label: 'Today', cls: 'soon', title: date };
    if (n === 1) return { label: 'Tomorrow', cls: 'soon', title: date };
    if (n <= 7) return { label: `${date} · ${n}d`, cls: 'soon' };
    return { label: date, cls: '' };
  }

  const isActive = (t) => t.status !== 'done';
  // Done more than 30 days ago: out of the way (List's Archive chip, or All), still searchable.
  const ARCHIVE_DAYS = 30;
  const isArchived = (t, today = new Date()) =>
    t.status === 'done' && Boolean(t.completed_at) && dayNumber(today) - dayNumber(new Date(t.completed_at)) >= ARCHIVE_DAYS;
  const isOverdue = (t, today = new Date()) => isActive(t) && Boolean(t.target_date) && daysUntil(t.target_date, today) < 0;
  const isDueThisWeek = (t, today = new Date()) => {
    if (!isActive(t) || !t.target_date) return false;
    const n = daysUntil(t.target_date, today);
    return n >= 0 && n <= 7;
  };

  // The Today view: open tasks and open subtasks (of open tasks) by when they're due.
  // Each item is { kind, task, subtask?, date }; a subtask is listed in its own right, so
  // a step due today shows even when its task is due next month.
  const TODAY_GROUPS = [
    { key: 'overdue', label: 'Overdue', test: (n) => n < 0 },
    { key: 'today', label: 'Today', test: (n) => n === 0 },
    { key: 'week', label: 'Next 7 days', test: (n) => n >= 1 && n <= 7 },
  ];

  function planWeek(tasks, today = new Date()) {
    const groups = Object.fromEntries(TODAY_GROUPS.map((g) => [g.key, []]));
    const place = (item) => {
      const n = daysUntil(item.date, today);
      const group = TODAY_GROUPS.find((g) => g.test(n));
      if (group) groups[group.key].push(item);
    };
    for (const task of tasks) {
      if (!isActive(task)) continue;
      if (task.target_date) place({ kind: 'task', task, date: task.target_date });
      for (const subtask of task.subtasks || []) {
        if (!subtask.done && subtask.target_date) place({ kind: 'subtask', task, subtask, date: subtask.target_date });
      }
    }
    const rank = { urgent: 0, high: 1, medium: 2, low: 3 };
    for (const list of Object.values(groups)) {
      list.sort((a, b) => a.date.localeCompare(b.date) || rank[a.task.priority] - rank[b.task.priority]
        || (a.kind === 'task' ? 0 : 1) - (b.kind === 'task' ? 0 : 1));
    }
    return groups;
  }

  // Insights, from the tasks already loaded. Weeks start on Monday; "on time" means done
  // on or before the target date (in local time).
  const INSIGHT_WEEKS = 12;

  function computeInsights(tasks, today = new Date()) {
    const todayN = dayNumber(today);
    const localIso = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
    const mondayN = (n) => n - ((new Date(n * 86400000).getUTCDay() + 6) % 7);
    const thisMonday = mondayN(todayN);
    const weeks = Array.from({ length: INSIGHT_WEEKS }, (_, i) => ({ start: localIso(thisMonday - 7 * (INSIGHT_WEEKS - 1 - i)), count: 0 }));
    const teams = new Map();
    const team = (t) => {
      const key = t.team_name || 'No team';
      if (!teams.has(key)) teams.set(key, { name: key, open: 0, overdue: 0, done90: 0, dated: 0, onTime: 0 });
      return teams.get(key);
    };
    let done30 = 0;
    let dated = 0;
    let onTime = 0;
    let slipTotal = 0;
    let late = 0;
    let overdue = 0;
    for (const t of tasks) {
      if (t.status !== 'done') {
        team(t).open += 1;
        if (isOverdue(t, today)) { overdue += 1; team(t).overdue += 1; }
        continue;
      }
      if (!t.completed_at) continue;
      const doneN = dayNumber(new Date(t.completed_at));
      const age = todayN - doneN;
      if (age < 30) done30 += 1;
      const w = Math.floor((thisMonday - mondayN(doneN)) / 7);
      if (w >= 0 && w < INSIGHT_WEEKS) weeks[INSIGHT_WEEKS - 1 - w].count += 1;
      if (age >= 90) continue;
      team(t).done90 += 1;
      if (!t.target_date) continue;
      const [y, m, d] = t.target_date.split('-').map(Number);
      const slip = doneN - Date.UTC(y, m - 1, d) / 86400000; // days late; 0 or less is on time
      dated += 1;
      team(t).dated += 1;
      if (slip <= 0) { onTime += 1; team(t).onTime += 1; } else { late += 1; slipTotal += slip; }
    }
    return {
      done30,
      overdue,
      onTimeRate: dated ? onTime / dated : null,
      dated,
      avgSlip: late ? slipTotal / late : null,
      weeks,
      teams: [...teams.values()].sort((a, b) => b.open - a.open || b.done90 - a.done90 || a.name.localeCompare(b.name)),
    };
  }

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  function relTime(iso) {
    const secs = (new Date(iso).getTime() - Date.now()) / 1000;
    const abs = Math.abs(secs);
    if (abs < 45) return 'just now';
    if (abs < 3600) return rtf.format(Math.round(secs / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(secs / 3600), 'hour');
    if (abs < 7 * 86400) return rtf.format(Math.round(secs / 86400), 'day');
    return shortDate(iso);
  }

  const fullTime = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  /* ---------- Filtering & sorting ---------- */

  const byDue = (a, b) =>
    (a.target_date || '9999-99-99').localeCompare(b.target_date || '9999-99-99') ||
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];

  const SORTS = {
    due: byDue,
    priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byDue(a, b),
    updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
    created: (a, b) => b.created_at.localeCompare(a.created_at),
  };

  const STATUS_FILTERS = {
    active: isActive,
    all: () => true,
    overdue: (t) => isOverdue(t),
    week: (t) => isDueThisWeek(t),
    done30: (t) => t.status === 'done' && !isArchived(t),
    done: (t) => t.status === 'done' && !isArchived(t),
    archived: (t) => isArchived(t),
  };

  function visibleTasks() {
    const q = state.q.trim().toLowerCase();
    const statusOk = STATUS_FILTERS[state.status] || ((t) => t.status === state.status);
    const sort = SORTS[state.sort] || byDue;
    return state.tasks
      .filter((t) => {
        if (!inTeamFilter(t)) return false;
        if (state.priority !== 'all' && t.priority !== state.priority) return false;
        if (state.view === 'list' && !statusOk(t)) return false;
        if (state.view !== 'list' && isArchived(t)) return false;
        if (q && !`${t.title}\n${t.description}\n${t.team_name || ''}\n${t.last_note || ''}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => (a.status === 'done') - (b.status === 'done') || sort(a, b));
  }

  /* ---------- Rendering ---------- */

  function render() {
    renderStats();
    renderToolbar();
    const root = $('#tasks');
    root.replaceChildren();
    if (!state.loaded) return root.append(skeleton());
    if (!state.tasks.length) return root.append(emptyState(true));
    const tasks = visibleTasks();
    if (state.view === 'board') renderBoard(root, tasks);
    else if (state.view === 'today') renderToday(root, tasks);
    else if (!tasks.length) root.append(emptyState(false));
    else renderList(root, tasks);
  }

  // The team filter narrows everything on the page, the summary tiles included.
  function inTeamFilter(t) {
    if (state.team === 'all') return true;
    if (state.team === 'none') return t.team_id == null;
    return String(t.team_id) === state.team;
  }

  function renderStats() {
    const t = state.tasks.filter(inTeamFilter);
    const stats = [
      { key: 'active', label: 'Active', value: t.filter(isActive).length, s: 'todo' },
      { key: 'in_progress', label: 'In progress', value: t.filter((x) => x.status === 'in_progress').length, s: 'in_progress' },
      { key: 'week', label: 'Due this week', value: t.filter((x) => isDueThisWeek(x)).length, s: 'blocked' },
      { key: 'overdue', label: 'Overdue', value: t.filter((x) => isOverdue(x)).length, alert: true },
      { key: 'done30', label: 'Done (30 days)', value: t.filter(STATUS_FILTERS.done30).length, s: 'done' },
    ];
    $('#stats').replaceChildren(
      ...stats.map((s) =>
        h('button', {
          type: 'button',
          class: `stat${s.alert && s.value ? ' alert' : ''}${state.view === 'list' && state.status === s.key ? ' is-active' : ''}`,
          title: `Show ${s.label.toLowerCase()}`,
          onclick: () => setFilter(state.status === s.key ? 'active' : s.key, true),
        },
        h('span', { class: 'stat-label' }, h('span', { class: `dot ${s.s ? `status-${s.s}` : ''}`, vars: s.alert ? { '--s': 'var(--red)' } : null }), s.label),
        h('span', { class: 'stat-value', text: state.loaded ? s.value : '–' })),
      ),
    );
  }

  function renderToolbar() {
    document.body.classList.toggle('view-board', state.view === 'board');
    document.body.classList.toggle('view-today', state.view === 'today');
    for (const b of document.querySelectorAll('#view-toggle button')) b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
    for (const b of document.querySelectorAll('#status-filter button')) b.setAttribute('aria-pressed', String(b.dataset.status === state.status));
    $('#priority-filter').value = state.priority;
    $('#sort').value = state.sort;
  }

  const statusPill = (s) => h('span', { class: `pill status-${s}`, text: STATUS[s] });

  // "2/5" with a checklist icon; nothing at all for a task without subtasks.
  function subtaskChip(t) {
    const total = t.subtask_total || 0;
    if (!total) return h('span', { class: 'subtask-chip is-none', 'aria-hidden': 'true' });
    const done = t.subtask_done || 0;
    return h('span', {
      class: `subtask-chip${done === total ? ' complete' : ''}`,
      title: `${done} of ${total} subtasks done`,
    }, icon('subtasks', 14), `${done}/${total}`);
  }

  function dueLabel(t) {
    const d = dueInfo(t);
    return h('span', { class: `due ${d.cls}`, title: d.title, text: d.label });
  }

  function checkButton(t) {
    const done = t.status === 'done';
    return h('button', {
      type: 'button',
      class: 'check',
      title: done ? 'Mark as not done' : 'Mark as done',
      'aria-label': done ? `Mark "${t.title}" as not done` : `Mark "${t.title}" as done`,
      onclick: (e) => {
        e.stopPropagation();
        patchTask(t.id, { status: done ? (t.subtask_done > 0 ? 'in_progress' : 'todo') : 'done' });
      },
    }, icon('check', 13));
  }

  function renderList(root, tasks) {
    root.append(h('div', { class: 'list', role: 'list' },
      h('div', { class: 'list-head', 'aria-hidden': 'true' },
        h('span'), h('span', { text: 'Task' }), h('span', { text: 'Status' }), h('span', { text: 'Subtasks' }), h('span', { text: 'Target' })),
      tasks.map(taskRow)));
  }

  function taskRow(t) {
    return h('div', {
      class: `row prio-${t.priority}${t.status === 'done' ? ' is-done' : ''}`,
      role: 'listitem',
      onclick: () => openTask(t.id),
    },
    checkButton(t),
    h('button', { type: 'button', class: 'row-main', 'aria-label': `Open ${t.title}` },
      h('span', { class: 'row-title' },
        (t.priority === 'urgent' || t.priority === 'high') && h('span', { class: `prio-badge prio-${t.priority}`, text: PRIORITY[t.priority] }),
        h('span', { class: 'text', text: t.title }),
        repeatMark(t)),
      h('span', { class: 'row-sub' },
        t.team_name && h('span', { class: 'tag', text: t.team_name }),
        t.last_note && h('span', { class: 'last-note', text: t.last_note }))),
    statusPill(t.status),
    subtaskChip(t),
    dueLabel(t));
  }

  function renderToday(root, tasks) {
    const groups = planWeek(tasks);
    const sections = TODAY_GROUPS.filter((g) => groups[g.key].length).map((g) =>
      h('section', { class: `today-group today-${g.key}`, 'aria-label': g.label },
        h('h2', { class: 'today-head' }, g.label, h('span', { class: 'count', text: groups[g.key].length })),
        h('div', { class: 'list', role: 'list' }, groups[g.key].map(todayRow))));
    if (!sections.length) {
      return root.append(h('div', { class: 'empty' },
        h('span', { class: 'empty-icon' }, icon('check', 22)),
        h('h2', { text: 'Nothing due in the next 7 days' }),
        h('p', { text: 'Tasks and subtasks with a target date show up here when they are due soon or overdue.' }),
        h('button', { type: 'button', class: 'btn', onclick: () => setView('list') }, 'See all tasks')));
    }
    root.append(h('div', { class: 'today' }, sections));
  }

  function todayRow(item) {
    const { task: t, subtask: st } = item;
    if (item.kind === 'task') return taskRow(t);
    const due = dueInfo({ target_date: st.target_date, status: 'todo' });
    return h('div', { class: `row is-subtask prio-${t.priority}`, role: 'listitem', onclick: () => openTask(t.id) },
      h('button', {
        type: 'button',
        class: 'check sm',
        title: 'Mark subtask as done',
        'aria-label': `Mark done: ${st.title}`,
        onclick: (e) => { e.stopPropagation(); toggleSubtaskOf(t.id, st.id); },
      }, icon('check', 12)),
      h('button', { type: 'button', class: 'row-main', 'aria-label': `Open ${t.title}` },
        h('span', { class: 'row-title' }, h('span', { class: 'text', text: st.title })),
        h('span', { class: 'row-sub' },
          h('span', { class: 'parent-task' }, icon('subtasks', 13), h('span', { text: t.title })),
          t.team_name && h('span', { class: 'tag', text: t.team_name }))),
      h('span', { class: 'pill subtask-pill', text: 'Subtask' }),
      h('span', { class: 'subtask-chip is-none', 'aria-hidden': 'true' }),
      h('span', { class: `due ${due.cls}`, title: due.title, text: due.label }));
  }

  function renderBoard(root, tasks) {
    const board = h('div', { class: 'board' });
    for (const s of STATUS_ORDER) {
      const items = tasks.filter((t) => t.status === s);
      if (s === 'done') items.sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
      const col = h('section', { class: `column status-${s}`, 'aria-label': STATUS[s] },
        h('header', { class: 'column-head' }, h('span', { class: 'dot' }), STATUS[s], h('span', { class: 'count', text: items.length })),
        h('div', { class: 'column-body' }, items.length ? items.map(taskCard) : h('div', { class: 'column-empty', text: 'Drag tasks here' }),
          s === 'done' && archivedLink()));
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop'); });
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('drop');
        const id = e.dataTransfer.getData('text/plain');
        const task = state.tasks.find((t) => t.id === id);
        if (task && task.status !== s) patchTask(id, { status: s });
      });
      board.append(col);
    }
    root.append(board);
  }

  function archivedLink() {
    const n = state.tasks.filter((t) => inTeamFilter(t) && isArchived(t)).length;
    if (!n) return null;
    return h('button', {
      type: 'button', class: 'archive-link', onclick: () => { state.view = 'list'; store.set('wt.view', 'list'); setFilter('archived'); },
    }, `${n} done more than ${ARCHIVE_DAYS} days ago`);
  }

  function taskCard(t) {
    const card = h('article', {
      class: `card prio-${t.priority}${t.status === 'done' ? ' is-done' : ''}`,
      draggable: 'true',
      tabindex: '0',
      'aria-label': t.title,
      onclick: () => openTask(t.id),
      onkeydown: (e) => { if (e.key === 'Enter') openTask(t.id); },
      ondragstart: (e) => {
        e.dataTransfer.setData('text/plain', t.id);
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragging');
      },
      ondragend: () => card.classList.remove('dragging'),
    },
    h('div', { class: 'card-top' },
      h('span', { class: `prio-badge prio-${t.priority}`, text: PRIORITY[t.priority] }),
      t.team_name && h('span', { class: 'tag', text: t.team_name }),
      repeatMark(t)),
    h('div', { class: 'card-title', text: t.title }),
    cardSubtasks(t),
    t.last_note && h('div', { class: 'card-note', text: t.last_note }),
    h('div', { class: 'card-foot' }, subtaskChip(t), dueLabel(t)));
    return card;
  }

  const CARD_SUBTASK_LIMIT = 6;

  function cardSubtasks(t) {
    const list = t.subtasks || [];
    if (!list.length) return null;
    const shown = list.slice(0, CARD_SUBTASK_LIMIT);
    return h('ul', { class: 'card-subtasks' },
      shown.map((st) => {
        const due = st.target_date && !st.done ? dueInfo({ target_date: st.target_date, status: 'todo' }) : null;
        return h('li', { class: `card-subtask${st.done ? ' is-done' : ''}` },
          h('button', {
            type: 'button',
            class: 'check xs',
            title: st.done ? 'Mark as not done' : 'Mark as done',
            'aria-label': `${st.done ? 'Mark not done' : 'Mark done'}: ${st.title}`,
            // The card itself opens the task; a tick here must only tick.
            onclick: (e) => { e.stopPropagation(); toggleSubtaskOf(t.id, st.id); },
            onkeydown: (e) => e.stopPropagation(),
          }, icon('check', 10)),
          h('span', { class: 'card-subtask-title', text: st.title }),
          due && h('span', { class: `due ${due.cls}`, title: due.title, text: shortDate(st.target_date) }));
      }),
      list.length > shown.length && h('li', { class: 'card-subtask-more', text: `+${list.length - shown.length} more` }));
  }

  function emptyState(firstRun) {
    return h('div', { class: 'empty' },
      h('span', { class: 'empty-icon' }, icon(firstRun ? 'clipboard' : 'search', 22)),
      h('h2', { text: firstRun ? 'No tasks yet' : 'Nothing matches' }),
      h('p', { text: firstRun
        ? 'Capture your first task — give it a priority, a target date and subtasks, then post updates as you go.'
        : 'Try a different filter or search term.' }),
      firstRun
        ? h('button', { type: 'button', class: 'btn primary', onclick: openQuickAdd }, icon('plus'), 'New task')
        : h('div', { class: 'empty-actions' },
          // A search that finds nothing among active tasks may be about an older one.
          state.q.trim() && state.status !== 'all' && h('button', { type: 'button', class: 'btn primary', onclick: () => setFilter('all') }, 'Search all tasks'),
          h('button', { type: 'button', class: 'btn', onclick: clearFilters }, 'Clear filters')));
  }

  function skeleton() {
    return h('div', { class: 'list' }, Array.from({ length: 5 }, () => h('div', { class: 'skeleton' })));
  }

  /* ---------- Filters ---------- */

  function setView(view) {
    state.view = view;
    store.set('wt.view', view);
    render();
  }

  function setFilter(status, fromStats = false) {
    state.status = status;
    if (fromStats && state.view !== 'list') state.view = 'list';
    if (STATUS[status] || ['active', 'all', 'archived'].includes(status)) store.set('wt.status', status);
    render();
  }

  function clearFilters() {
    state.q = '';
    $('#search').value = '';
    state.priority = 'all';
    setFilter('active');
  }

  /* ---------- Task mutations ---------- */

  function upsert(task) {
    const i = state.tasks.findIndex((t) => t.id === task.id);
    if (i === -1) state.tasks.unshift(task);
    else state.tasks[i] = task;
  }

  async function patchTask(id, changes) {
    const i = state.tasks.findIndex((t) => t.id === id);
    if (i === -1) return;
    const before = state.tasks[i];
    state.tasks[i] = { ...before, ...changes };
    render();
    try {
      const detail = await api(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes });
      applyDetail(detail);
      if (changes.status === 'done' && !detail.next_task) toast('Nice — marked as done');
    } catch (err) {
      state.tasks[i] = before;
      render();
      notify(err);
    }
  }

  function applyDetail({ task, updates, subtasks, next_task: nextTask }) {
    upsert(task);
    // Marking a repeating task done made the next one.
    if (nextTask) {
      upsert(nextTask);
      toast(`Done. Next one is due ${shortDate(nextTask.target_date)}`);
    }
    if (state.drawerOpen && state.current && state.current.id === task.id) {
      state.current = task;
      if (!state.dirty) fillForm(task);
      renderTimeline(updates);
      renderSubtasks(subtasks || []);
      renderMeta(task);
    }
    render();
  }

  /* ---------- Drawer ---------- */

  let hideTimer;

  function openNew() {
    showDrawer(null);
  }

  async function openTask(id) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;
    showDrawer(task);
    try {
      const detail = await api(`/tasks/${encodeURIComponent(id)}`);
      if (state.current && state.current.id === id) applyDetail(detail);
    } catch (err) {
      notify(err);
    }
  }

  function showDrawer(task) {
    clearTimeout(hideTimer);
    state.current = task;
    state.drawerOpen = true;
    fillForm(task);
    $('#drawer-eyebrow').textContent = task ? 'Task' : 'New task';
    $('#save-btn').textContent = task ? 'Save changes' : 'Create task';
    $('#delete-btn').hidden = !task;
    $('#save-template-btn').hidden = !task;
    $('#template-pick').hidden = Boolean(task) || !state.templates.length;
    $('#template-select').value = '';
    $('#updates-section').hidden = !task;
    $('#update-note').value = '';
    $('#update-status').value = '';
    $('#subtask-input').value = '';
    closeSubtaskSuggestion();
    renderSubtasks([]);
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

  function closeDrawer(force = false) {
    if (!state.drawerOpen) return;
    if (!force && state.dirty && !confirm('Discard unsaved changes?')) return;
    state.drawerOpen = false;
    state.current = null;
    setDirty(false);
    const drawer = $('#drawer');
    const scrim = $('#scrim');
    drawer.classList.remove('open');
    scrim.classList.remove('open');
    document.body.classList.remove('drawer-open');
    hideTimer = setTimeout(() => { drawer.hidden = true; scrim.hidden = true; }, 240);
  }

  function fillForm(task) {
    const t = task || { title: '', description: '', status: 'todo', priority: 'medium', target_date: '', team_id: newTaskTeam() };
    field('title').value = t.title;
    field('description').value = t.description;
    field('status').value = t.status;
    field('priority').value = t.priority;
    field('target_date').value = t.target_date || '';
    field('team_id').value = t.team_id == null ? '' : String(t.team_id);
    setRepeatField(t.recurrence || null);
    requestAnimationFrame(() => { autoGrow(field('title')); autoGrow(field('description')); });
    setDirty(false);
  }

  function readForm() {
    return {
      title: field('title').value.trim(),
      description: field('description').value.trim(),
      status: field('status').value,
      priority: field('priority').value,
      target_date: field('target_date').value || null,
      team_id: field('team_id').value ? Number(field('team_id').value) : null,
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

  function describeRepeat(r) {
    if (!r) return '';
    const [kind, raw] = r.split(':');
    const n = Number(raw);
    if (kind === 'weekly') return n === 1 ? 'Repeats every week' : `Repeats every ${n} weeks`;
    if (kind === 'monthly') return { 1: 'Repeats every month', 3: 'Repeats every quarter', 12: 'Repeats every year' }[n] || `Repeats every ${n} months`;
    return `Repeats ${n} day${n === 1 ? '' : 's'} after done`;
  }

  const repeatMark = (t) => t.recurrence && h('span', { class: 'repeat-mark', title: describeRepeat(t.recurrence), 'aria-label': describeRepeat(t.recurrence) }, icon('repeat', 13));

  function setDirty(dirty) {
    state.dirty = dirty;
    $('#save-btn').disabled = Boolean(state.current) && !dirty;
  }

  function renderMeta(task) {
    $('#task-meta').textContent = task
      ? `Created ${shortDate(task.created_at)} · Updated ${relTime(task.updated_at)}${task.completed_at ? ` · Done ${shortDate(task.completed_at)}` : ''}`
      : '';
  }

  function renderTimeline(updates) {
    const ol = $('#timeline');
    if (!updates) return ol.replaceChildren(h('li', { class: 'timeline-empty', text: 'Loading…' }));
    if (!updates.length) return ol.replaceChildren(h('li', { class: 'timeline-empty', text: 'No updates yet.' }));
    ol.replaceChildren(...updates.map((u) => {
      const time = h('time', { datetime: u.created_at, title: fullTime(u.created_at), text: relTime(u.created_at) });
      if (u.kind === 'change') {
        return h('li', { class: 'tl-change' }, h('span', { class: 'tl-dot' }), h('span', { text: u.note }), time);
      }
      return h('li', { class: 'tl-note' },
        h('span', { class: 'tl-dot' }),
        h('div', { class: 'tl-card' },
          h('div', { class: 'tl-meta' },
            time,
            u.status && statusPill(u.status),
            h('button', { type: 'button', class: 'icon-btn tl-del', title: 'Delete update', 'aria-label': 'Delete update', onclick: () => deleteUpdate(u.id) }, icon('trash', 14))),
          h('p', { class: 'tl-text', text: u.note })));
    }));
  }

  async function saveTask(e) {
    e.preventDefault();
    const data = readForm();
    if (!data.title) {
      toast('Give the task a title first', 'error');
      field('title').focus();
      return;
    }
    const btn = $('#save-btn');
    btn.disabled = true;
    try {
      if (state.current) {
        const changes = {};
        for (const [k, v] of Object.entries(data)) if (v !== (state.current[k] ?? null)) changes[k] = v;
        const detail = await api(`/tasks/${encodeURIComponent(state.current.id)}`, { method: 'PATCH', body: changes });
        setDirty(false);
        applyDetail(detail);
        if (!detail.next_task) toast('Saved');
      } else {
        const subtasks = state.subtasks.map(({ title, target_date: targetDate }) => ({ title, target_date: targetDate || null }));
        const detail = await api('/tasks', { method: 'POST', body: { ...data, subtasks } });
        upsert(detail.task);
        setDirty(false);
        showDrawer(detail.task);
        applyDetail(detail);
        toast('Task created');
      }
    } catch (err) {
      notify(err);
      setDirty(true);
    }
  }

  async function deleteTask() {
    const task = state.current;
    if (!task || !confirm(`Delete "${task.title}" and all of its updates? This can't be undone.`)) return;
    try {
      await api(`/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE' });
      state.tasks = state.tasks.filter((t) => t.id !== task.id);
      setDirty(false);
      closeDrawer();
      render();
      toast('Task deleted');
    } catch (err) {
      notify(err);
    }
  }

  async function postUpdate() {
    const task = state.current;
    const noteEl = $('#update-note');
    const note = noteEl.value.trim();
    if (!task) return;
    if (!note) {
      noteEl.focus();
      return;
    }
    const body = { note };
    const status = $('#update-status').value;
    if (status) body.status = status;

    const btn = $('#post-update');
    btn.disabled = true;
    try {
      const detail = await api(`/tasks/${encodeURIComponent(task.id)}/updates`, { method: 'POST', body });
      noteEl.value = '';
      $('#update-status').value = '';
      closeSubtaskSuggestion();
      applyDetail(detail);
      if (!detail.next_task) toast('Update posted');
    } catch (err) {
      notify(err);
    } finally {
      btn.disabled = false;
    }
  }

  async function deleteUpdate(updateId) {
    const task = state.current;
    if (!task || !confirm('Delete this update?')) return;
    try {
      applyDetail(await api(`/tasks/${encodeURIComponent(task.id)}/updates/${encodeURIComponent(updateId)}`, { method: 'DELETE' }));
    } catch (err) {
      notify(err);
    }
  }

  /* ---------- Subtasks ---------- */
  // On a saved task each change is sent straight away and the server's copy replaces
  // ours. While creating a task they are drafts, sent along with the create.

  const subtaskPath = (id = '') => `/tasks/${encodeURIComponent(state.current.id)}/subtasks${id ? `/${encodeURIComponent(id)}` : ''}`;

  function renderSubtasks(subtasks) {
    state.subtasks = subtasks;
    const done = subtasks.filter((st) => st.done).length;
    $('#subtask-count').textContent = subtasks.length ? `${done} of ${subtasks.length} done` : '';
    $('#subtask-list').replaceChildren(...subtasks.map((st, i) => subtaskItem(st, i)));
  }

  function subtaskItem(st, i) {
    const draft = !state.current;
    const title = h('input', {
      class: 'subtask-title', value: st.title, maxlength: '200', 'aria-label': 'Subtask title', enterkeyhint: 'done',
    });
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); title.blur(); }
      if (e.key === 'Escape') { e.stopPropagation(); title.value = st.title; title.blur(); }
    });
    title.addEventListener('change', () => renameSubtask(i, title));
    return h('li', { class: `subtask${st.done ? ' is-done' : ''}` },
      h('button', {
        type: 'button',
        class: 'check sm',
        disabled: draft,
        title: draft ? 'Create the task to tick off subtasks' : st.done ? 'Mark as not done' : 'Mark as done',
        'aria-label': `${st.done ? 'Mark not done' : 'Mark done'}: ${st.title}`,
        onclick: () => toggleSubtask(i),
      }, icon('check', 12)),
      title,
      state.assistant && !st.done && h('button', {
        type: 'button', class: 'sub-assist', title: 'Suggest clearer wording', 'aria-label': `Suggest clearer wording: ${st.title}`,
        onclick: (e) => suggestSubtaskWording(title, e.currentTarget.closest('li'), e.currentTarget, (text) => {
          title.value = text;
          renameSubtask(i, title);
        }),
      }, sparkIcon(16)),
      dateChip(st.target_date, (value) => setSubtaskDate(i, value), { done: Boolean(st.done) }),
      h('button', {
        type: 'button', class: 'icon-btn subtask-del', title: 'Delete subtask', 'aria-label': `Delete subtask: ${st.title}`,
        onclick: () => removeSubtask(i),
      }, icon('x', 15)));
  }

  // A friendly date label with the device's own date picker laid transparently over it.
  // Tapping opens the picker (on desktop, showPicker() does the same); a set date also
  // gets a small clear button.
  function dateChip(value, onChange, { done = false } = {}) {
    const info = value ? dueInfo({ target_date: value, status: done ? 'done' : 'todo' }) : null;
    const input = h('input', {
      type: 'date',
      class: 'date-chip-input',
      value: value || '',
      'aria-label': value ? `Due ${shortDate(value)}. Change date` : 'Add a due date',
    });
    input.addEventListener('click', () => { try { input.showPicker(); } catch { /* not supported: native tap opens it */ } });
    input.addEventListener('change', () => onChange(input.value || null));
    return h('span', { class: 'date-chip-wrap' },
      h('span', { class: `date-chip ${info ? info.cls || 'set' : 'unset'}`, title: info?.title || (value ? shortDate(value) : 'Add a due date') },
        icon('calendar', 13),
        info ? h('span', { text: info.label === 'No date' ? shortDate(value) : info.label }) : h('span', { class: 'date-chip-placeholder', text: 'Date' }),
        input),
      value && h('button', {
        type: 'button', class: 'icon-btn date-clear', title: 'Remove date', 'aria-label': 'Remove date', onclick: () => onChange(null),
      }, icon('x', 12)));
  }

  async function setSubtaskDate(i, value) {
    const st = state.subtasks[i];
    if (!st || (st.target_date || null) === value) return;
    if (!state.current) {
      // A date picked by hand stops following the template's offset.
      renderSubtasks(state.subtasks.map((x, j) => (j === i ? { ...x, target_date: value, offset_days: null } : x)));
      return;
    }
    try {
      applyDetail(await api(subtaskPath(st.id), { method: 'PATCH', body: { target_date: value } }));
    } catch (err) {
      notify(err);
    }
  }

  // Tick a subtask from outside the drawer (board cards): optimistic, then the server's copy.
  async function toggleSubtaskOf(taskId, subtaskId) {
    const before = state.tasks.find((x) => x.id === taskId);
    const st = before?.subtasks?.find((x) => x.id === subtaskId);
    if (!st) return;
    const subtasks = before.subtasks.map((x) => (x.id === subtaskId ? { ...x, done: x.done ? 0 : 1 } : x));
    upsert({ ...before, subtasks, subtask_done: subtasks.filter((x) => x.done).length });
    render();
    try {
      applyDetail(await api(`/tasks/${encodeURIComponent(taskId)}/subtasks/${encodeURIComponent(subtaskId)}`, {
        method: 'PATCH', body: { done: !st.done },
      }));
    } catch (err) {
      upsert(before);
      render();
      notify(err);
    }
  }

  async function addSubtask() {
    const input = $('#subtask-input');
    const title = input.value.trim();
    if (!title) return input.focus();
    if (!state.current) {
      renderSubtasks([...state.subtasks, { id: `draft-${state.subtasks.length}-${Date.now()}`, title, done: 0 }]);
      setDirty(true);
      input.value = '';
      return input.focus();
    }
    const btn = $('#subtask-add-btn');
    btn.disabled = true;
    try {
      applyDetail(await api(subtaskPath(), { method: 'POST', body: { title } }));
      // Only clear what was sent: the next subtask may already be half typed.
      if (input.value.trim() === title) input.value = '';
    } catch (err) {
      notify(err);
    } finally {
      btn.disabled = false;
      input.focus();
    }
  }

  async function toggleSubtask(i) {
    const before = state.subtasks;
    const st = before[i];
    if (!state.current || !st) return;
    renderSubtasks(before.map((x, j) => (j === i ? { ...x, done: x.done ? 0 : 1 } : x)));
    try {
      applyDetail(await api(subtaskPath(st.id), { method: 'PATCH', body: { done: !st.done } }));
    } catch (err) {
      renderSubtasks(before);
      notify(err);
    }
  }

  async function renameSubtask(i, input) {
    const st = state.subtasks[i];
    const title = input.value.trim();
    if (!st || title === st.title) return;
    if (!title) {
      input.value = st.title;
      return;
    }
    if (!state.current) {
      renderSubtasks(state.subtasks.map((x, j) => (j === i ? { ...x, title } : x)));
      return;
    }
    try {
      applyDetail(await api(subtaskPath(st.id), { method: 'PATCH', body: { title } }));
    } catch (err) {
      input.value = st.title;
      notify(err);
    }
  }

  async function removeSubtask(i) {
    const st = state.subtasks[i];
    if (!st) return;
    if (!state.current) return renderSubtasks(state.subtasks.filter((_, j) => j !== i));
    try {
      applyDetail(await api(subtaskPath(st.id), { method: 'DELETE' }));
    } catch (err) {
      notify(err);
    }
  }

  // Textareas grow with their content instead of showing a scrollbar or a tall empty box.
  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }

  /* ---------- Task assistant ---------- */

  // run numbers each request, so a late reply to an earlier one is ignored.
  const assist = { run: 0, suggestion: null };

  async function askAssistant() {
    const original = { title: field('title').value.trim(), description: field('description').value.trim() };
    if (!original.title) {
      toast('Write a title first, then ask for suggestions', 'error');
      field('title').focus();
      return;
    }
    const dialog = $('#assist-dialog');
    if (!dialog.open) dialog.showModal();
    const run = ++assist.run;
    assist.suggestion = null;
    showAssist({ busy: true });
    $('#assist-btn').classList.add('is-busy');
    try {
      const suggestion = await api('/assist', { method: 'POST', body: original });
      if (run !== assist.run) return;
      assist.suggestion = { ...suggestion, original };
      showAssist({ suggestion: assist.suggestion });
    } catch (err) {
      if (run !== assist.run || err.silent) return;
      showAssist({ error: err.message });
    } finally {
      if (run === assist.run) $('#assist-btn').classList.remove('is-busy');
    }
  }

  function showAssist({ busy = false, suggestion = null, error = '' }) {
    const changed = Boolean(suggestion && (suggestion.changed.title || suggestion.changed.description));
    const status = $('#assist-status');
    status.classList.toggle('is-busy', busy);
    status.textContent = busy ? 'Reading your task…'
      : error || (suggestion && !changed ? 'This task already reads clearly. Nothing to change.' : '');
    $('#assist-result').hidden = !changed;
    if (changed) {
      // Only the fields with a suggestion; an unchanged one would just be noise.
      $('#assist-title-field').hidden = !suggestion.changed.title;
      $('#assist-title-old').textContent = suggestion.original.title;
      $('#assist-title-new').textContent = suggestion.title;
      $('#assist-desc-field').hidden = !suggestion.changed.description;
      $('#assist-desc-old').textContent = suggestion.original.description;
      $('#assist-desc-new').textContent = suggestion.description;
      $('#assist-why').textContent = suggestion.reason;
    }
    $('#assist-replace').hidden = !changed;
    $('#assist-keep').textContent = changed ? 'Keep original' : 'Close';
    $('#assist-retry').hidden = busy;
  }

  // Puts the suggestion in the form; nothing is saved until Save, as with typing.
  function applySuggestion() {
    const s = assist.suggestion;
    if (!s) return;
    if (s.changed.title) field('title').value = s.title;
    if (s.changed.description) field('description').value = s.description;
    autoGrow(field('title'));
    autoGrow(field('description'));
    setDirty(true);
    $('#assist-dialog').close();
    toast(state.current ? 'Wording replaced. Save changes to keep it.' : 'Wording replaced');
  }

  // One inline suggestion at a time (a subtask's, or the update box's Tidy). A subtask's
  // opens in place under the row (or under the "Add a subtask" box) with Keep / Use. It
  // sees the task title and the other subtasks.
  const subAssist = { run: 0, panel: null, btn: null };

  function closeSubtaskSuggestion() {
    subAssist.run += 1;
    subAssist.panel?.remove();
    subAssist.btn?.classList.remove('is-busy');
    subAssist.panel = null;
    subAssist.btn = null;
  }

  async function suggestSubtaskWording(input, after, btn, onUse) {
    const title = input.value.trim();
    if (!title) {
      toast('Write the subtask first', 'error');
      input.focus();
      return;
    }
    closeSubtaskSuggestion();
    const run = subAssist.run;
    const panel = h(after.tagName === 'LI' ? 'li' : 'div', { class: 'subtask-suggest' },
      h('p', { class: 'assist-status is-busy', role: 'status', text: 'Reading your subtask…' }));
    after.after(panel);
    Object.assign(subAssist, { panel, btn });
    btn.classList.add('is-busy');

    const close = h('button', { type: 'button', class: 'btn', text: 'Close', onclick: closeSubtaskSuggestion });
    try {
      const others = state.subtasks.map((st) => st.title).filter((t) => t !== title);
      const s = await api('/assist/subtask', { method: 'POST', body: { task_title: field('title').value.trim(), title, others } });
      if (run !== subAssist.run) return;
      if (!s.changed) {
        panel.replaceChildren(h('p', { class: 'assist-status', role: 'status', text: 'This subtask already reads clearly.' }), h('div', { class: 'assist-actions' }, close));
        return;
      }
      panel.replaceChildren(
        h('div', { class: 'assist-card suggested' }, h('span', { class: 'assist-label', text: 'Suggested' }), h('p', { text: s.title })),
        s.reason && h('p', { class: 'assist-why', text: s.reason }),
        h('div', { class: 'assist-actions' },
          h('button', { type: 'button', class: 'btn', text: 'Keep', onclick: closeSubtaskSuggestion }),
          h('button', { type: 'button', class: 'btn primary', text: 'Use', onclick: () => { closeSubtaskSuggestion(); onUse(s.title); } })));
    } catch (err) {
      if (run !== subAssist.run || err.silent) return;
      panel.replaceChildren(h('p', { class: 'assist-status', role: 'status', text: err.message }), h('div', { class: 'assist-actions' }, close));
    } finally {
      if (run === subAssist.run) btn.classList.remove('is-busy');
    }
  }

  // ✨ Tidy on the progress update box: yours and the tidied version side by side under the
  // box; Replace puts it in the box, and nothing is posted until Post update.
  async function tidyUpdate(btn) {
    const noteEl = $('#update-note');
    const note = noteEl.value.trim();
    if (!note) {
      toast('Write your update first, then tidy it', 'error');
      noteEl.focus();
      return;
    }
    closeSubtaskSuggestion();
    const run = subAssist.run;
    const panel = h('div', { class: 'subtask-suggest update-suggest' },
      h('p', { class: 'assist-status is-busy', role: 'status', text: 'Tidying your update…' }));
    $('.composer').after(panel);
    Object.assign(subAssist, { panel, btn });
    btn.classList.add('is-busy');

    const close = h('button', { type: 'button', class: 'btn', text: 'Close', onclick: closeSubtaskSuggestion });
    try {
      const s = await api('/assist/update', { method: 'POST', body: { task_title: field('title').value.trim(), note } });
      if (run !== subAssist.run) return;
      if (!s.changed) {
        panel.replaceChildren(h('p', { class: 'assist-status', role: 'status', text: 'This update already reads clearly.' }), h('div', { class: 'assist-actions' }, close));
        return;
      }
      panel.replaceChildren(
        h('div', { class: 'assist-compare' },
          h('div', { class: 'assist-card' }, h('span', { class: 'assist-label', text: 'Yours' }), h('p', { text: note })),
          h('div', { class: 'assist-card suggested' }, h('span', { class: 'assist-label', text: 'Tidied' }), h('p', { text: s.text }))),
        s.reason && h('p', { class: 'assist-why', text: s.reason }),
        h('div', { class: 'assist-actions' },
          h('button', { type: 'button', class: 'btn', text: 'Keep mine', onclick: closeSubtaskSuggestion }),
          h('button', {
            type: 'button', class: 'btn primary', text: 'Replace',
            onclick: () => {
              closeSubtaskSuggestion();
              noteEl.value = s.text;
              noteEl.focus();
            },
          })));
    } catch (err) {
      if (run !== subAssist.run || err.silent) return;
      panel.replaceChildren(h('p', { class: 'assist-status', role: 'status', text: err.message }), h('div', { class: 'assist-actions' }, close));
    } finally {
      if (run === subAssist.run) btn.classList.remove('is-busy');
    }
  }

  /* ---------- Face ID & passkeys ---------- */

  function passkeyError(message) {
    const el = $('#passkeys-error');
    el.textContent = message || '';
    el.hidden = !message;
  }

  async function openPasskeys() {
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

  /* ---------- Insights ---------- */

  const weekLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  function renderInsights() {
    const teamName = state.team === 'all' ? null : state.team === 'none' ? 'No team' : state.teams.find((t) => String(t.id) === state.team)?.name;
    $('#insights-scope').textContent = teamName ? `For ${teamName} (the team filter applies).` : 'All teams. The team filter narrows this.';
    const ins = computeInsights(state.tasks.filter(inTeamFilter));
    const pct = (x) => `${Math.round(x * 100)}%`;
    const tiles = [
      { label: 'Done, last 30 days', value: String(ins.done30) },
      { label: 'On time, last 90 days', value: ins.onTimeRate == null ? '–' : pct(ins.onTimeRate), note: ins.dated ? `of ${ins.dated} with a target date` : 'no dated tasks done yet' },
      { label: 'Average slip when late', value: ins.avgSlip == null ? '–' : `${ins.avgSlip.toFixed(1)}d`, note: ins.avgSlip == null ? 'nothing finished late' : 'days past the target' },
      { label: 'Overdue now', value: String(ins.overdue), alert: ins.overdue > 0 },
    ];
    const max = Math.max(1, ...ins.weeks.map((w) => w.count));
    const last = ins.weeks.length - 1;
    const chart = h('div', { class: 'ins-chart', role: 'img', 'aria-label': `Tasks done per week, last ${ins.weeks.length} weeks` },
      ins.weeks.map((w, i) => h('div', { class: 'ins-col' },
        h('button', {
          type: 'button',
          class: 'ins-bar-hit',
          'aria-label': `Week of ${weekLabel(w.start)}: ${w.count} done`,
        },
        h('span', { class: 'ins-tip', text: `Week of ${weekLabel(w.start)} · ${w.count} done` }),
        i === last && h('span', { class: 'ins-cap', text: String(w.count) }),
        h('span', { class: `ins-bar${w.count ? '' : ' is-zero'}`, vars: { '--h': `${(w.count / max) * 100}%` } })),
        h('span', { class: 'ins-x', text: i % 3 === last % 3 ? weekLabel(w.start) : '' }))));
    const table = (head, rows) => h('table', { class: 'ins-table' },
      h('thead', null, h('tr', null, head.map((c, i) => h('th', { scope: 'col', class: i ? 'num' : null, text: c })))),
      h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => (i ? h('td', { class: 'num', text: c }) : h('th', { scope: 'row', text: c })))))));
    $('#insights-body').replaceChildren(
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
          : h('p', { class: 'hint', text: 'No tasks yet.' })));
  }

  /* ---------- Quick add parser ---------- */
  // One line in, task fields out: "Board deck fri !high #Leadership". Recognised words are
  // taken out of the title; the preview shows what was understood before anything is saved.

  const QA_WEEKDAYS = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
  const QA_MONTHS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
  const QA_PRIORITY = { '!!!': 'urgent', '!urgent': 'urgent', '!u': 'urgent', '!!': 'high', '!high': 'high', '!h': 'high', '!medium': 'medium', '!med': 'medium', '!m': 'medium', '!low': 'low', '!l': 'low' };
  const QA_DAY = '(?:(?:by|on|due)\\s+)?';
  const QA_WEEKDAY_RE = Object.keys(QA_WEEKDAYS).sort((a, b) => b.length - a.length).join('|');
  const QA_MONTH_RE = Object.keys(QA_MONTHS).sort((a, b) => b.length - a.length).join('|');

  // A real calendar date or null (31 Feb is refused rather than rolled into March).
  function qaIso(y, m, d) {
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null;
  }

  const qaPlusDays = (today, n) => qaIso(today.getFullYear(), today.getMonth() + 1, today.getDate()) && new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + n)).toISOString().slice(0, 10);

  // A day and month with no year: this year, or next year once that date has passed.
  function qaNextYearly(today, m, d) {
    const thisYear = qaIso(today.getFullYear(), m, d);
    if (!thisYear) return null;
    return thisYear < qaPlusDays(today, 0) ? qaIso(today.getFullYear() + 1, m, d) : thisYear;
  }

  // `teams` is [{ id, name }]: "#RDH", "#devops" or "#Dev_Ops" pick a team; a #word that
  // names no team is left in the title, where the preview shows it wasn't understood.
  function parseQuickAdd(text, today = new Date(), teams = []) {
    const out = { title: '', target_date: null, priority: null, team_id: null, team_name: null };
    const qaKey = (name) => String(name).toLowerCase().replace(/[\s_-]+/g, '');
    let rest = ` ${String(text).replace(/\s+/g, ' ')} `;
    const take = (re, fn) => {
      rest = rest.replace(re, (...m) => {
        const kept = fn(...m);
        return kept === false ? m[0] : ' ';
      });
    };
    const date = (re, fn) => take(re, (...m) => {
      if (out.target_date) return false;
      const iso = fn(...m);
      if (!iso) return false;
      out.target_date = iso;
      return true;
    });

    take(/\s(!!!|!!|!(?:urgent|high|medium|med|low|u|h|m|l))(?=\s)/i, (_, p) => {
      if (out.priority) return false;
      out.priority = QA_PRIORITY[p.toLowerCase()];
      return true;
    });
    take(/\s#([\p{L}\p{N}_-]+)(?=\s)/u, (_, c) => {
      if (out.team_id) return false;
      const team = teams.find((tm) => qaKey(tm.name) === qaKey(c));
      if (!team) return false;
      out.team_id = team.id;
      out.team_name = team.name;
      return true;
    });

    const y4 = (y) => (y.length === 2 ? 2000 + Number(y) : Number(y));
    date(new RegExp(`\\s${QA_DAY}(\\d{1,2})/(\\d{1,2})(?:/(\\d{2}|\\d{4}))?(?=\\s)`, 'i'),
      (_, d, m, y) => (y ? qaIso(y4(y), Number(m), Number(d)) : qaNextYearly(today, Number(m), Number(d))));
    date(new RegExp(`\\s${QA_DAY}(\\d{1,2})(?:st|nd|rd|th)?\\s+(${QA_MONTH_RE})(?:\\s+(\\d{4}))?(?=\\s)`, 'i'),
      (_, d, mon, y) => (y ? qaIso(Number(y), QA_MONTHS[mon.toLowerCase()], Number(d)) : qaNextYearly(today, QA_MONTHS[mon.toLowerCase()], Number(d))));
    date(new RegExp(`\\s${QA_DAY}(${QA_MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?=\\s)`, 'i'),
      (_, mon, d, y) => (y ? qaIso(Number(y), QA_MONTHS[mon.toLowerCase()], Number(d)) : qaNextYearly(today, QA_MONTHS[mon.toLowerCase()], Number(d))));
    date(new RegExp(`\\s${QA_DAY}(today|tonight)(?=\\s)`, 'i'), () => qaPlusDays(today, 0));
    date(new RegExp(`\\s${QA_DAY}(tomorrow|tmrw|tmr)(?=\\s)`, 'i'), () => qaPlusDays(today, 1));
    date(new RegExp(`\\s${QA_DAY}in\\s+(\\d{1,3})\\s+(days?|weeks?|months?)(?=\\s)`, 'i'), (_, n, unit) => {
      const k = Number(n);
      if (/^day/i.test(unit)) return qaPlusDays(today, k);
      if (/^week/i.test(unit)) return qaPlusDays(today, 7 * k);
      const m0 = today.getMonth() + k; // same day k months on, clamped to the month's last day
      const last = new Date(Date.UTC(today.getFullYear(), m0 + 1, 0)).getUTCDate();
      return new Date(Date.UTC(today.getFullYear(), m0, Math.min(today.getDate(), last))).toISOString().slice(0, 10);
    });
    date(new RegExp(`\\s${QA_DAY}next\\s+week(?=\\s)`, 'i'), () => qaPlusDays(today, ((1 - today.getDay() + 7) % 7) || 7));
    date(new RegExp(`\\s${QA_DAY}(?:eow|end\\s+of\\s+(?:the\\s+)?week)(?=\\s)`, 'i'), () => qaPlusDays(today, (5 - today.getDay() + 7) % 7));
    date(new RegExp(`\\s${QA_DAY}(?:eom|end\\s+of\\s+(?:the\\s+)?month)(?=\\s)`, 'i'),
      () => new Date(Date.UTC(today.getFullYear(), today.getMonth() + 1, 0)).toISOString().slice(0, 10));
    // "fri" = the coming Friday (today if it is Friday). "next fri" = the Friday of next
    // week (Monday-start): from a Saturday that is the coming one, from a Monday a week later.
    date(new RegExp(`\\s${QA_DAY}(next\\s+)?(${QA_WEEKDAY_RE})(?=\\s)`, 'i'), (_, next, name) => {
      const dow = today.getDay();
      let diff = (QA_WEEKDAYS[name.toLowerCase()] - dow + 7) % 7;
      if (next) {
        const daysToSunday = (7 - dow) % 7;
        if (diff <= daysToSunday) diff += 7;
      }
      return qaPlusDays(today, diff);
    });

    out.title = rest.replace(/\s+/g, ' ').trim();
    return out;
  }

  /* end quick add parser */

  /* ---------- Quick add ---------- */

  function openQuickAdd() {
    $('#quick-input').value = '';
    renderQuickPreview();
    $('#quick-dialog').showModal();
    $('#quick-input').focus();
  }

  function renderQuickPreview() {
    const p = parseQuickAdd($('#quick-input').value, new Date(), state.teams);
    const parts = [];
    if (p.title) parts.push(h('span', { class: 'qp-title', text: p.title }));
    if (p.target_date) {
      const due = dueInfo({ target_date: p.target_date, status: 'todo' });
      const words = new Date(`${p.target_date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
      parts.push(h('span', { class: `date-chip ${due.cls || 'set'}` }, icon('calendar', 13), h('span', { text: words })));
    }
    if (p.priority) parts.push(h('span', { class: `prio-badge prio-${p.priority}`, text: PRIORITY[p.priority] }));
    if (p.team_name) parts.push(h('span', { class: 'tag', text: p.team_name }));
    $('#quick-preview').replaceChildren(...(parts.length ? parts : [h('span', { class: 'qp-empty', text: 'Type a task; dates, !priority and #team are picked out as you go.' })]));
    $('#quick-submit').disabled = !p.title;
    return p;
  }

  async function submitQuickAdd(e) {
    e.preventDefault();
    const p = parseQuickAdd($('#quick-input').value, new Date(), state.teams);
    if (!p.title) return;
    const body = { title: p.title };
    if (p.target_date) body.target_date = p.target_date;
    if (p.priority) body.priority = p.priority;
    if (p.team_id) body.team_id = p.team_id;
    const btn = $('#quick-submit');
    btn.disabled = true;
    try {
      const detail = await api('/tasks', { method: 'POST', body });
      upsert(detail.task);
      render();
      $('#quick-dialog').close();
      toast(`Added "${detail.task.title}"`);
    } catch (err) {
      notify(err);
    } finally {
      btn.disabled = false;
    }
  }

  // Hand what was typed to the full form, for a description, subtasks or a template.
  function quickToDetails() {
    const p = parseQuickAdd($('#quick-input').value, new Date(), state.teams);
    $('#quick-dialog').close();
    openNew();
    if (p.title) field('title').value = p.title;
    if (p.target_date) field('target_date').value = p.target_date;
    if (p.priority) field('priority').value = p.priority;
    if (p.team_id) field('team_id').value = String(p.team_id);
    requestAnimationFrame(() => autoGrow(field('title')));
    if (p.title) setDirty(true);
  }

  /* ---------- Reminders ---------- */

  let pushConfig = null;
  const remindersForm = () => $('#reminders-form');

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

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { /* reminders will say so */ });
  }

  async function deviceSubscription() {
    if (!pushSupported()) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? reg.pushManager.getSubscription() : null;
  }

  function fillReminderForm() {
    const f = remindersForm().elements;
    f.namedItem('enabled').checked = pushConfig.settings.enabled;
    f.namedItem('digest_time').value = pushConfig.settings.digest_time;
    f.namedItem('include_tomorrow').checked = pushConfig.settings.include_tomorrow;
    $('#reminders-tz').textContent = `Times are in ${deviceTimeZone().replace(/_/g, ' ')}. Nothing is sent on a day with nothing due.`;
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
        : others ? `On for ${others} other device${others === 1 ? '' : 's'}; off on this one.` : 'Off. Turn it on to get your morning digest on this device.';
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
    const f = remindersForm().elements;
    try {
      const { settings } = await api('/push/settings', {
        method: 'PUT',
        body: {
          enabled: f.namedItem('enabled').checked,
          digest_time: f.namedItem('digest_time').value,
          include_tomorrow: f.namedItem('include_tomorrow').checked,
          time_zone: deviceTimeZone(),
        },
      });
      pushConfig.settings = settings;
      toast('Reminder settings saved');
    } catch (err) {
      if (!err.silent) showFormError($('#reminders-error'), err.message);
    }
  }

  /* ---------- Teams ---------- */

  // A new task starts on the team being filtered to, so it doesn't vanish from view.
  const newTaskTeam = () => (/^\d+$/.test(state.team) ? Number(state.team) : null);

  function setTeams(teams) {
    state.teams = teams;
    if (/^\d+$/.test(state.team) && !teams.some((t) => String(t.id) === state.team)) {
      state.team = 'all';
      store.set('wt.team', 'all');
    }
    const options = () => teams.map((t) => h('option', { value: String(t.id), text: t.name }));
    $('#team-filter').replaceChildren(
      h('option', { value: 'all', text: 'All teams' }),
      h('option', { value: 'none', text: 'No team' }),
      ...options());
    $('#team-filter').value = state.team;
    const pick = field('team_id');
    const current = pick.value;
    pick.replaceChildren(h('option', { value: '', text: 'No team' }), ...options());
    pick.value = teams.some((t) => String(t.id) === current) ? current : '';
    renderTeamList();
  }

  async function refreshTeams() {
    setTeams((await api('/teams')).teams);
  }

  function renderTeamList() {
    $('#team-list').replaceChildren(...state.teams.map((t) => {
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
    }));
  }

  async function teamsCall(path, options, done) {
    $('#teams-error').hidden = true;
    try {
      setTeams((await api(path, options)).teams);
      await reloadTasks();
      if (done) toast(done);
    } catch (err) {
      if (!err.silent) showFormError($('#teams-error'), err.message);
      renderTeamList();
    }
  }

  async function reloadTasks() {
    state.tasks = (await api('/tasks')).tasks;
    render();
  }

  async function addTeam(e) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem('name');
    const name = input.value.trim();
    if (!name) return;
    await teamsCall('/admin/teams', { method: 'POST', body: { name } }, `Added ${name}`);
    if ($('#teams-error').hidden) input.value = '';
  }

  function renameTeam(team, input) {
    const name = input.value.trim();
    if (!name || name === team.name) {
      input.value = team.name;
      return;
    }
    teamsCall(`/admin/teams/${team.id}`, { method: 'PATCH', body: { name } }, `Renamed to ${name}`);
  }

  function removeTeam(team) {
    const n = team.task_count;
    if (!confirm(`Remove ${team.name}?${n ? ` Its ${n} task${n === 1 ? '' : 's'} will move to "No team".` : ''}`)) return;
    teamsCall(`/admin/teams/${team.id}`, { method: 'DELETE' }, `Removed ${team.name}`);
  }

  /* ---------- Templates ---------- */

  // The date `days` after an ISO date (negative = before); null when either is missing.
  function shiftDate(iso, days) {
    if (!iso || days == null) return null;
    return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  }

  // Draft subtasks that came from a template follow the task's target date.
  function placeDrafts(drafts, targetDate) {
    return drafts.map((st) => (st.offset_days == null ? st : { ...st, target_date: shiftDate(targetDate, st.offset_days) }));
  }

  /* end templates helpers */

  function renderTemplatePicker() {
    $('#template-select').replaceChildren(
      h('option', { value: '', text: 'Choose…' }),
      ...state.templates.map((t) => h('option', { value: t.id, text: t.name })));
    if (!state.current && state.drawerOpen) $('#template-pick').hidden = !state.templates.length;
    renderTemplateList();
  }

  function applyTemplate(id) {
    const t = state.templates.find((x) => x.id === id);
    if (!t || state.current) return;
    field('title').value = t.title;
    field('description').value = t.description;
    field('priority').value = t.priority;
    field('team_id').value = t.team_id == null ? '' : String(t.team_id);
    autoGrow(field('title'));
    autoGrow(field('description'));
    const drafts = t.subtasks.map((st, i) => ({ id: `draft-${i}-${Date.now()}`, title: st.title, done: 0, offset_days: st.offset_days, target_date: null }));
    renderSubtasks(placeDrafts(drafts, field('target_date').value || null));
    setDirty(true);
    if (!field('target_date').value && t.subtasks.some((st) => st.offset_days != null)) {
      toast('Set a target date and the subtask dates will follow');
    }
  }

  async function saveAsTemplate() {
    const task = state.current;
    if (!task) return;
    const name = prompt('Name this template', task.title);
    if (name === null) return;
    try {
      const { templates } = await api('/templates', { method: 'POST', body: { task_id: task.id, name } });
      state.templates = templates;
      renderTemplatePicker();
      toast(`Saved template "${name.trim()}"`);
    } catch (err) {
      notify(err);
    }
  }

  function renderTemplateList() {
    $('#templates-empty').hidden = state.templates.length > 0;
    $('#template-list').replaceChildren(...state.templates.map((t) => h('li', {},
      h('span', { class: 'template-name' }, h('strong', { text: t.name }),
        h('span', { class: 'muted', text: t.subtasks.length ? ` · ${t.subtasks.length} subtask${t.subtasks.length === 1 ? '' : 's'}` : '' })),
      h('button', {
        type: 'button', class: 'icon-btn', title: 'Delete template', 'aria-label': `Delete template ${t.name}`,
        onclick: () => deleteTemplate(t),
      }, icon('trash', 15)))));
  }

  async function deleteTemplate(t) {
    if (!confirm(`Delete the template "${t.name}"? Tasks made from it stay as they are.`)) return;
    try {
      state.templates = (await api(`/templates/${encodeURIComponent(t.id)}`, { method: 'DELETE' })).templates;
      renderTemplatePicker();
    } catch (err) {
      notify(err);
    }
  }

  /* ---------- Theme ---------- */

  function applyTheme(theme) {
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

  /* ---------- Wiring ---------- */

  function bind() {
    $('#new-task').addEventListener('click', openQuickAdd);
    $('#quick-input').addEventListener('input', renderQuickPreview);
    $('#quick-form').addEventListener('submit', submitQuickAdd);
    $('#quick-details').addEventListener('click', quickToDetails);
    $('#theme-toggle').addEventListener('click', toggleTheme);
    $('#close-drawer').addEventListener('click', () => closeDrawer());
    $('#scrim').addEventListener('click', () => closeDrawer());
    $('#delete-btn').addEventListener('click', deleteTask);
    $('#post-update').addEventListener('click', postUpdate);
    $('#assist-btn').addEventListener('click', askAssistant);
    $('#assist-retry').addEventListener('click', askAssistant);
    $('#assist-replace').addEventListener('click', applySuggestion);
    $('#assist-keep').addEventListener('click', () => $('#assist-dialog').close());
    // However it closes (Keep, Escape, Replace), a reply still on its way is dropped.
    $('#assist-dialog').addEventListener('close', () => {
      assist.run += 1;
      assist.suggestion = null;
      $('#assist-btn').classList.remove('is-busy');
    });
    form.addEventListener('submit', saveTask);
    form.addEventListener('input', (e) => {
      if (e.target === field('title') && /[\r\n]/.test(e.target.value)) e.target.value = e.target.value.replace(/[\r\n]+/g, ' ');
      if (e.target === field('target_date') && !state.current) renderSubtasks(placeDrafts(state.subtasks, e.target.value || null));
      if (e.target === field('recurrence')) $('#repeat-days-field').hidden = e.target.value !== 'after';
      if (e.target.tagName === 'TEXTAREA') autoGrow(e.target);
      if (e.target.closest('.composer, .subtasks')) return;
      setDirty(true);
    });
    $('#subtask-add-btn').addEventListener('click', addSubtask);
    $('#update-assist').addEventListener('click', (e) => tidyUpdate(e.currentTarget));
    $('#subtask-input-assist').addEventListener('click', (e) => {
      const input = $('#subtask-input');
      suggestSubtaskWording(input, $('.subtask-add'), e.currentTarget, (text) => {
        input.value = text;
        input.focus();
      });
    });
    $('#template-select').addEventListener('change', (e) => applyTemplate(e.target.value));
    $('#save-template-btn').addEventListener('click', saveAsTemplate);
    $('#subtask-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addSubtask(); }
    });
    form.addEventListener('keydown', (e) => {
      // The title wraps like a paragraph but is one line: Enter saves instead of adding a newline.
      if (e.target === field('title') && e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        form.requestSubmit();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (e.target.id === 'update-note') postUpdate();
        else form.requestSubmit();
      }
    });

    $('#search').addEventListener('input', (e) => { state.q = e.target.value; render(); });
    $('#team-filter').addEventListener('change', (e) => { state.team = e.target.value; store.set('wt.team', state.team); render(); });
    $('#priority-filter').addEventListener('change', (e) => { state.priority = e.target.value; render(); });
    $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; store.set('wt.sort', state.sort); render(); });
    $('#status-filter').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-status]');
      if (b) setFilter(b.dataset.status);
    });
    $('#view-toggle').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-view]');
      if (b) setView(b.dataset.view);
    });

    document.addEventListener('keydown', (e) => {
      // A dialog over the drawer (the assistant) closes itself on Escape; the drawer stays.
      if (e.key === 'Escape' && state.drawerOpen && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        closeDrawer();
        return;
      }
      const t = e.target;
      if (e.ctrlKey || e.metaKey || e.altKey || state.drawerOpen || document.querySelector('dialog[open]')) return;
      if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openQuickAdd(); }
      if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
    });

    window.addEventListener('beforeunload', (e) => {
      if (state.dirty) e.preventDefault();
    });
  }

  /* ---------- Account ---------- */

  function setUser(user) {
    $('#user-menu').hidden = false;
    $('#user-name').textContent = user.name;
    $('#user-avatar').textContent = user.name.slice(0, 1);
    $('#user-button').title = `Signed in as ${user.email}`;
    $('#invite-btn').hidden = !user.is_admin;
    $('#teams-btn').hidden = !user.is_admin;
    state.assistant = Boolean(user.assistant);
    $('#assist-btn').hidden = !state.assistant;
    $('#subtask-input-assist').hidden = !state.assistant;
    $('#update-assist').hidden = !state.assistant;
  }

  async function loadApp() {
    const [me, list, tpl, teams] = await Promise.all([api('/auth/me'), api('/tasks'), api('/templates'), api('/teams')]);
    setUser(me);
    setTeams(teams.teams);
    state.tasks = list.tasks;
    state.templates = tpl.templates;
    renderTemplatePicker();
    state.loaded = true;
    render();
    registerServiceWorker();
  }

  async function signOut() {
    closeMenu();
    if (state.dirty && !confirm('Discard unsaved changes and sign out?')) return;
    try {
      await api('/auth/logout', { method: 'POST', body: {} });
    } catch (err) {
      if (!err.silent) return notify(err);
    }
    state.dirty = false;
    location.href = '/login';
  }

  function toggleMenu(open) {
    const menu = $('#user-dropdown');
    const show = open ?? menu.hidden;
    menu.hidden = !show;
    $('#user-button').setAttribute('aria-expanded', String(show));
    if (show) menu.querySelector('button:not([hidden])').focus();
  }
  const closeMenu = () => toggleMenu(false);

  function showFormError(el, message) {
    el.textContent = message;
    el.hidden = false;
  }

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

  function bindAccount() {
    $('#user-button').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
    $('#sign-out-btn').addEventListener('click', signOut);
    $('#change-password-btn').addEventListener('click', openPasswordDialog);
    $('#reminders-btn').addEventListener('click', openReminders);
    $('#teams-btn').addEventListener('click', async () => {
      closeMenu();
      $('#teams-error').hidden = true;
      $('#teams-dialog').showModal();
      await refreshTeams().catch((err) => { if (!err.silent) showFormError($('#teams-error'), err.message); });
    });
    $('#teams-close').addEventListener('click', () => $('#teams-dialog').close());
    $('#team-add-form').addEventListener('submit', addTeam);
    $('#reminders-close').addEventListener('click', () => $('#reminders-dialog').close());
    $('#reminders-form').addEventListener('submit', saveReminderSettings);
    $('#push-enable').addEventListener('click', enablePush);
    $('#push-disable').addEventListener('click', disablePush);
    $('#push-test').addEventListener('click', sendTestPush);
    $('#passkeys-btn').addEventListener('click', () => { closeMenu(); openPasskeys(); });
    $('#passkeys-close').addEventListener('click', () => $('#passkeys-dialog').close());
    $('#passkeys-form').addEventListener('submit', addPasskey);
    $('#insights-btn').addEventListener('click', () => { closeMenu(); renderInsights(); $('#insights-dialog').showModal(); });
    $('#insights-close').addEventListener('click', () => $('#insights-dialog').close());
    $('#templates-btn').addEventListener('click', () => { closeMenu(); renderTemplateList(); $('#templates-dialog').showModal(); });
    $('#templates-close').addEventListener('click', () => $('#templates-dialog').close());
    $('#invite-btn').addEventListener('click', openInviteDialog);
    $('#password-form').addEventListener('submit', changePassword);
    $('#password-cancel').addEventListener('click', () => $('#password-dialog').close());
    $('#create-invite').addEventListener('click', createInvite);
    $('#invite-close').addEventListener('click', () => $('#invite-dialog').close());
    document.addEventListener('click', (e) => { if (!e.target.closest('#user-menu')) closeMenu(); });
    $('#user-dropdown').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); $('#user-button').focus(); }
    });
  }

  async function init() {
    applyTheme(store.get('wt.theme', ''));
    bind();
    bindAccount();
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
})();
