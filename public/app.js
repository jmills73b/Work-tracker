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
    view: store.get('wt.view', 'list'),
    status: store.get('wt.status', 'active'),
    priority: 'all',
    sort: store.get('wt.sort', 'due'),
    q: '',
    current: null, // task open in the drawer (null = creating a new one)
    drawerOpen: false,
    subtasks: [], // the open task's subtasks, or drafts while creating a new task
    dirty: false,
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
  const isOverdue = (t, today = new Date()) => isActive(t) && Boolean(t.target_date) && daysUntil(t.target_date, today) < 0;
  const isDueThisWeek = (t, today = new Date()) => {
    if (!isActive(t) || !t.target_date) return false;
    const n = daysUntil(t.target_date, today);
    return n >= 0 && n <= 7;
  };

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
    done30: (t) => t.status === 'done' && t.completed_at && Date.now() - new Date(t.completed_at) < 30 * 86400000,
  };

  function visibleTasks() {
    const q = state.q.trim().toLowerCase();
    const statusOk = STATUS_FILTERS[state.status] || ((t) => t.status === state.status);
    const sort = SORTS[state.sort] || byDue;
    return state.tasks
      .filter((t) => {
        if (state.priority !== 'all' && t.priority !== state.priority) return false;
        if (state.view === 'list' && !statusOk(t)) return false;
        if (q && !`${t.title}\n${t.description}\n${t.category}\n${t.last_note || ''}`.toLowerCase().includes(q)) return false;
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
    else if (!tasks.length) root.append(emptyState(false));
    else renderList(root, tasks);
    renderCategories();
  }

  function renderStats() {
    const t = state.tasks;
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
    for (const b of document.querySelectorAll('#view-toggle button')) b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
    for (const b of document.querySelectorAll('#status-filter button')) b.setAttribute('aria-pressed', String(b.dataset.status === state.status));
    $('#priority-filter').value = state.priority;
    $('#sort').value = state.sort;
  }

  function renderCategories() {
    const cats = [...new Set(state.tasks.map((t) => t.category).filter(Boolean))].sort();
    $('#categories').replaceChildren(...cats.map((c) => h('option', { value: c })));
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
        h('span', { class: 'text', text: t.title })),
      h('span', { class: 'row-sub' },
        t.category && h('span', { class: 'tag', text: t.category }),
        t.last_note && h('span', { class: 'last-note', text: t.last_note }))),
    statusPill(t.status),
    subtaskChip(t),
    dueLabel(t));
  }

  function renderBoard(root, tasks) {
    const board = h('div', { class: 'board' });
    for (const s of STATUS_ORDER) {
      const items = tasks.filter((t) => t.status === s);
      if (s === 'done') items.sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
      const col = h('section', { class: `column status-${s}`, 'aria-label': STATUS[s] },
        h('header', { class: 'column-head' }, h('span', { class: 'dot' }), STATUS[s], h('span', { class: 'count', text: items.length })),
        h('div', { class: 'column-body' }, items.length ? items.map(taskCard) : h('div', { class: 'column-empty', text: 'Drag tasks here' })));
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
      t.category && h('span', { class: 'tag', text: t.category })),
    h('div', { class: 'card-title', text: t.title }),
    t.last_note && h('div', { class: 'card-note', text: t.last_note }),
    h('div', { class: 'card-foot' }, subtaskChip(t), dueLabel(t)));
    return card;
  }

  function emptyState(firstRun) {
    return h('div', { class: 'empty' },
      h('span', { class: 'empty-icon' }, icon(firstRun ? 'clipboard' : 'search', 22)),
      h('h2', { text: firstRun ? 'No tasks yet' : 'Nothing matches' }),
      h('p', { text: firstRun
        ? 'Capture your first task — give it a priority, a target date and subtasks, then post updates as you go.'
        : 'Try a different filter or search term.' }),
      firstRun
        ? h('button', { type: 'button', class: 'btn primary', onclick: openNew }, icon('plus'), 'New task')
        : h('button', { type: 'button', class: 'btn', onclick: clearFilters }, 'Clear filters'));
  }

  function skeleton() {
    return h('div', { class: 'list' }, Array.from({ length: 5 }, () => h('div', { class: 'skeleton' })));
  }

  /* ---------- Filters ---------- */

  function setFilter(status, fromStats = false) {
    state.status = status;
    if (fromStats && state.view !== 'list') state.view = 'list';
    if (STATUS[status] || status === 'active' || status === 'all') store.set('wt.status', status);
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
      if (changes.status === 'done') toast('Nice — marked as done');
    } catch (err) {
      state.tasks[i] = before;
      render();
      notify(err);
    }
  }

  function applyDetail({ task, updates, subtasks }) {
    upsert(task);
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
    $('#updates-section').hidden = !task;
    $('#update-note').value = '';
    $('#update-status').value = '';
    $('#subtask-input').value = '';
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
    const t = task || { title: '', description: '', status: 'todo', priority: 'medium', target_date: '', category: '' };
    field('title').value = t.title;
    field('description').value = t.description;
    field('status').value = t.status;
    field('priority').value = t.priority;
    field('target_date').value = t.target_date || '';
    field('category').value = t.category;
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
      category: field('category').value.trim(),
    };
  }

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
        toast('Saved');
      } else {
        const subtasks = state.subtasks.map((st) => st.title);
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
      applyDetail(detail);
      toast('Update posted');
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
      h('button', {
        type: 'button', class: 'icon-btn subtask-del', title: 'Delete subtask', 'aria-label': `Delete subtask: ${st.title}`,
        onclick: () => removeSubtask(i),
      }, icon('x', 15)));
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
      input.value = '';
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
    $('#new-task').addEventListener('click', openNew);
    $('#theme-toggle').addEventListener('click', toggleTheme);
    $('#close-drawer').addEventListener('click', () => closeDrawer());
    $('#scrim').addEventListener('click', () => closeDrawer());
    $('#delete-btn').addEventListener('click', deleteTask);
    $('#post-update').addEventListener('click', postUpdate);
    form.addEventListener('submit', saveTask);
    form.addEventListener('input', (e) => {
      if (e.target === field('title') && /[\r\n]/.test(e.target.value)) e.target.value = e.target.value.replace(/[\r\n]+/g, ' ');
      if (e.target.tagName === 'TEXTAREA') autoGrow(e.target);
      if (e.target.closest('.composer, .subtasks')) return;
      setDirty(true);
    });
    $('#subtask-add-btn').addEventListener('click', addSubtask);
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
    $('#priority-filter').addEventListener('change', (e) => { state.priority = e.target.value; render(); });
    $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; store.set('wt.sort', state.sort); render(); });
    $('#status-filter').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-status]');
      if (b) setFilter(b.dataset.status);
    });
    $('#view-toggle').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-view]');
      if (!b) return;
      state.view = b.dataset.view;
      store.set('wt.view', state.view);
      render();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.drawerOpen) {
        e.preventDefault();
        closeDrawer();
        return;
      }
      const t = e.target;
      if (e.ctrlKey || e.metaKey || e.altKey || state.drawerOpen || document.querySelector('dialog[open]')) return;
      if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openNew(); }
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
  }

  async function loadApp() {
    const [me, list] = await Promise.all([api('/auth/me'), api('/tasks')]);
    setUser(me);
    state.tasks = list.tasks;
    state.loaded = true;
    render();
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
