// The page's state, and small per-device preferences. localStorage can throw (private
// mode, blocked storage), so every access is guarded and has a fallback.

export const store = {
  get(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  },
};

const VIEWS = ['today', 'tasks', 'review'];
const FILTERS = ['todo', 'blocked', 'done'];

export const state = {
  tasks: [],
  loaded: false,
  view: VIEWS.includes(store.get('wt.view')) ? store.get('wt.view') : 'today',
  status: FILTERS.includes(store.get('wt.filter')) ? store.get('wt.filter') : 'todo', // the Tasks view's chip
  highOnly: false,
  team: store.get('wt.team', 'all'), // 'all', 'none', or a team id as a string
  teams: [],
  sort: store.get('wt.sort') === 'updated' ? 'updated' : 'due',
  q: '',
  current: null, // the task open in the panel (null = creating a new one)
  panelOpen: false,
  steps: [], // the open task's steps, or drafts while creating a new task
  dirty: false, // a new task with unsaved words
  assistant: false, // the server has the assistant's API key
  user: null,
};

// Late-bound so modules can call each other without import cycles: main.js fills these.
export const app = {
  render: () => {},
  applyDetail: () => {},
  openTask: () => {},
  openQuickAdd: () => {},
  openPlan: () => {},
  closeInlineAssist: () => {},
};

export function upsert(task) {
  const i = state.tasks.findIndex((t) => t.id === task.id);
  if (i === -1) state.tasks.unshift(task);
  else state.tasks[i] = task;
}

// The team filter narrows every view.
export function inTeamFilter(t) {
  if (state.team === 'all') return true;
  if (state.team === 'none') return t.team_id == null;
  return String(t.team_id) === state.team;
}
