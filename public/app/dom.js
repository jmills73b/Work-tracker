// DOM helpers. User data only ever goes in through textContent (the `text` prop or a
// child string), never as HTML.

export const $ = (sel, root = document) => root.querySelector(sel);

export function h(tag, props, ...children) {
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

const ICONS = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
  clipboard: 'M9 4h6v3H9zM9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 13l2 2 4-4',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
  x: 'M6 6l12 12M18 6L6 18',
  calendar: 'M8 3v3M16 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
  steps: 'M10 6h10M10 12h10M10 18h10M3.5 6l1.5 1.5L7.5 5M3.5 12l1.5 1.5 2.5-2.5M3.5 18l1.5 1.5 2.5-2.5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  pin: 'M12 17v5M8 3h8l-1 6 3 3v2H6v-2l3-3z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  hourglass: 'M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9',
};

function svg(attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function path(d) {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  return p;
}

export function icon(name, size = 16) {
  const el = svg({
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  });
  el.append(path(ICONS[name]));
  return el;
}

const SPARK = [
  'M10 2.5l1.7 4.8a3 3 0 0 0 1.8 1.8L18.3 11l-4.8 1.7a3 3 0 0 0-1.8 1.8L10 19.3l-1.7-4.8a3 3 0 0 0-1.8-1.8L1.7 11l4.8-1.7a3 3 0 0 0 1.8-1.8z',
  'M19 1.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z',
  'M19.5 15.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z',
];

// The assistant's ✨, filled rather than stroked like the other icons.
export function sparkIcon(size = 16) {
  const el = svg({ viewBox: '0 0 24 24', width: size, height: size, fill: 'currentColor', 'aria-hidden': 'true' });
  for (const d of SPARK) el.append(path(d));
  return el;
}

// action: { label, run } adds a button (Undo); the toast then stays a little longer.
export function toast(message, type = 'info', action = null) {
  const el = h('div', { class: `toast ${type}` }, h('span', { text: message }));
  const leave = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
  };
  if (action) {
    el.append(h('button', { type: 'button', class: 'toast-action', text: action.label, onclick: () => { leave(); action.run(); } }));
  }
  $('#toasts').append(el);
  setTimeout(leave, type === 'error' || action ? 5000 : 2400);
}

// Textareas grow with their content instead of showing a scrollbar or a tall empty box.
export function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + 2}px`;
}

export function showFormError(el, message) {
  el.textContent = message;
  el.hidden = !message;
}
