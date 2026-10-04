// ✨ Tidy. On a task: title, notes and open steps reviewed together, yours and the
// suggestion side by side, each changed step with its own tick. On a log entry: yours and
// the tidied version under the box. Nothing is saved until you choose Replace.
import { api } from './api.js';
import { $, autoGrow, h, toast } from './dom.js';
import { panelField as field, renameStep } from './panel.js';
import { state } from './state.js';

// run numbers each request, so a late reply to an earlier one is ignored.
const task = { run: 0, suggestion: null };

export async function askAssistant() {
  const open = state.steps.map((st, i) => ({ st, i })).filter(({ st }) => !st.done);
  const original = {
    title: field('title').value.trim(),
    description: field('description').value.trim(),
    steps: open.map(({ st }) => st.title),
  };
  if (!original.title) {
    toast('Write a title first, then tidy', 'error');
    field('title').focus();
    return;
  }
  const dialog = $('#assist-dialog');
  if (!dialog.open) dialog.showModal();
  const run = ++task.run;
  task.suggestion = null;
  show({ busy: true });
  $('#assist-btn').classList.add('is-busy');
  try {
    const suggestion = await api('/assist', { method: 'POST', body: original });
    if (run !== task.run) return;
    task.suggestion = { ...suggestion, original, stepIndex: open.map(({ i }) => i) };
    show({ suggestion: task.suggestion });
  } catch (err) {
    if (run !== task.run || err.silent) return;
    show({ error: err.message });
  } finally {
    if (run === task.run) $('#assist-btn').classList.remove('is-busy');
  }
}

function show({ busy = false, suggestion = null, error = '' }) {
  const stepChanges = suggestion ? suggestion.changed.steps.map((c, k) => c && k).filter((k) => k !== false) : [];
  const changed = Boolean(suggestion && (suggestion.changed.title || suggestion.changed.description || stepChanges.length));
  const status = $('#assist-status');
  status.classList.toggle('is-busy', busy);
  status.textContent = busy ? 'Reading your task…'
    : error || (suggestion && !changed ? 'This task already reads clearly. Nothing to change.' : '');
  $('#assist-result').hidden = !changed;
  if (changed) {
    // Only what has a suggestion; an unchanged part would just be noise.
    $('#assist-title-field').hidden = !suggestion.changed.title;
    $('#assist-title-old').textContent = suggestion.original.title;
    $('#assist-title-new').textContent = suggestion.title;
    $('#assist-desc-field').hidden = !suggestion.changed.description;
    $('#assist-desc-old').textContent = suggestion.original.description;
    $('#assist-desc-new').textContent = suggestion.description;
    $('#assist-steps-field').hidden = !stepChanges.length;
    $('#assist-steps').replaceChildren(...stepChanges.map((k) => h('li', { class: 'assist-step' },
      h('label', null,
        h('input', { type: 'checkbox', checked: true, 'data-k': String(k), 'aria-label': `Use: ${suggestion.steps[k]}` }),
        h('span', { class: 'assist-step-words' },
          h('span', { class: 'old', text: suggestion.original.steps[k] }),
          h('span', { class: 'new', text: suggestion.steps[k] }))))));
    $('#assist-why').textContent = suggestion.reason;
  }
  $('#assist-replace').hidden = !changed;
  $('#assist-keep').textContent = changed ? 'Keep original' : 'Close';
  $('#assist-retry').hidden = busy;
}

// Title and notes go into the form (a saved task then saves them as if typed); ticked
// steps are renamed.
async function applySuggestion() {
  const s = task.suggestion;
  if (!s) return;
  const picked = [...document.querySelectorAll('#assist-steps input:checked')].map((el) => Number(el.dataset.k));
  $('#assist-dialog').close();
  if (s.changed.title) field('title').value = s.title;
  if (s.changed.description) field('description').value = s.description;
  autoGrow(field('title'));
  autoGrow(field('description'));
  if (s.changed.title || s.changed.description) {
    field('title').dispatchEvent(new Event('input', { bubbles: true }));
    field('title').dispatchEvent(new Event('blur'));
  }
  for (const k of picked) await renameStep(s.stepIndex[k], s.steps[k]);
  toast('Wording replaced');
}

// ---------- Tidy on a log entry ----------

const inline = { run: 0, panel: null, btn: null };

export function closeInlineAssist() {
  inline.run += 1;
  inline.panel?.remove();
  inline.btn?.classList.remove('is-busy');
  inline.panel = null;
  inline.btn = null;
}

async function tidyEntry(btn) {
  const noteEl = $('#log-note');
  const note = noteEl.value.trim();
  if (!note) {
    toast('Write the entry first, then tidy it', 'error');
    noteEl.focus();
    return;
  }
  closeInlineAssist();
  const run = inline.run;
  const panel = h('div', { class: 'subtask-suggest update-suggest' },
    h('p', { class: 'assist-status is-busy', role: 'status', text: 'Tidying your entry…' }));
  $('.composer').after(panel);
  Object.assign(inline, { panel, btn });
  btn.classList.add('is-busy');
  const close = h('button', { type: 'button', class: 'btn', text: 'Close', onclick: closeInlineAssist });
  try {
    const s = await api('/assist/update', { method: 'POST', body: { task_title: field('title').value.trim(), note } });
    if (run !== inline.run) return;
    if (!s.changed) {
      panel.replaceChildren(h('p', { class: 'assist-status', role: 'status', text: 'This entry already reads clearly.' }), h('div', { class: 'assist-actions' }, close));
      return;
    }
    panel.replaceChildren(
      h('div', { class: 'assist-compare' },
        h('div', { class: 'assist-card' }, h('span', { class: 'assist-label', text: 'Yours' }), h('p', { text: note })),
        h('div', { class: 'assist-card suggested' }, h('span', { class: 'assist-label', text: 'Tidied' }), h('p', { text: s.text }))),
      s.reason && h('p', { class: 'assist-why', text: s.reason }),
      h('div', { class: 'assist-actions' },
        h('button', { type: 'button', class: 'btn', text: 'Keep mine', onclick: closeInlineAssist }),
        h('button', {
          type: 'button',
          class: 'btn primary',
          text: 'Replace',
          onclick: () => {
            closeInlineAssist();
            noteEl.value = s.text;
            noteEl.focus();
          },
        })));
  } catch (err) {
    if (run !== inline.run || err.silent) return;
    panel.replaceChildren(h('p', { class: 'assist-status', role: 'status', text: err.message }), h('div', { class: 'assist-actions' }, close));
  } finally {
    if (run === inline.run) btn.classList.remove('is-busy');
  }
}

export function bindAssist() {
  $('#assist-btn').addEventListener('click', askAssistant);
  $('#assist-retry').addEventListener('click', askAssistant);
  $('#assist-replace').addEventListener('click', applySuggestion);
  $('#assist-keep').addEventListener('click', () => $('#assist-dialog').close());
  // However it closes (Keep, Escape, Replace), a reply still on its way is dropped.
  $('#assist-dialog').addEventListener('close', () => {
    task.run += 1;
    task.suggestion = null;
    $('#assist-btn').classList.remove('is-busy');
  });
  $('#log-assist').addEventListener('click', (e) => tidyEntry(e.currentTarget));
}
