export const STATUS_LABELS = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' };
export const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function text(value, name, max, { required = false } = {}) {
  if (typeof value !== 'string') return { error: `${name} must be text` };
  const v = value.trim();
  if (required && !v) return { error: `${name} is required` };
  if (v.length > max) return { error: `${name} must be at most ${max} characters` };
  return { value: v };
}

export function validStatus(v) {
  return Object.hasOwn(STATUS_LABELS, v);
}

function validDate(v) {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// Returns { value } with only whitelisted, validated fields, or { error }.
export function validateTask(input, { partial = false } = {}) {
  if (!isObject(input)) return { error: 'Invalid request body' };
  const out = {};

  if (!partial || 'title' in input) {
    const r = text(input.title ?? '', 'Title', 200, { required: true });
    if (r.error) return r;
    out.title = r.value;
  }
  if ('description' in input) {
    const r = text(input.description ?? '', 'Description', 5000);
    if (r.error) return r;
    out.description = r.value;
  }
  if ('category' in input) {
    const r = text(input.category ?? '', 'Category', 60);
    if (r.error) return r;
    out.category = r.value;
  }
  if ('status' in input) {
    if (!validStatus(input.status)) return { error: 'Invalid status' };
    out.status = input.status;
  }
  if ('priority' in input) {
    if (!Object.hasOwn(PRIORITY_LABELS, input.priority)) return { error: 'Invalid priority' };
    out.priority = input.priority;
  }
  if ('target_date' in input) {
    const v = input.target_date;
    if (v === null || v === '') out.target_date = null;
    else if (typeof v === 'string' && validDate(v)) out.target_date = v;
    else return { error: 'Target date must be YYYY-MM-DD' };
  }

  if (!partial && 'subtasks' in input) {
    if (!Array.isArray(input.subtasks) || input.subtasks.length > MAX_SUBTASKS) {
      return { error: `Subtasks must be a list of at most ${MAX_SUBTASKS}` };
    }
    const subtasks = [];
    for (const item of input.subtasks) {
      // A bare string is a title; an object can also carry a target date.
      const r = validateSubtaskCreate(typeof item === 'string' ? { title: item } : item);
      if (r.error) return r;
      subtasks.push(r.value);
    }
    out.subtasks = subtasks;
  }

  return { value: out };
}

export const MAX_SUBTASKS = 50;

function subtaskTitle(value) {
  return text(value ?? '', 'Subtask', 200, { required: true });
}

// null or '' means "no date"; anything else must be a real calendar date.
function optionalDate(v) {
  if (v === null || v === '') return { value: null };
  if (typeof v === 'string' && validDate(v)) return { value: v };
  return { error: 'Target date must be YYYY-MM-DD' };
}

export function validateSubtaskCreate(input) {
  if (!isObject(input)) return { error: 'Invalid request body' };
  const r = subtaskTitle(input.title);
  if (r.error) return r;
  const d = optionalDate(input.target_date ?? null);
  if (d.error) return d;
  return { value: { title: r.value, target_date: d.value } };
}

// PATCH body: { title?, done?, target_date? }. done must be a real boolean, not 0/1 or
// "true". A target_date of null clears the date; leaving the key out leaves it alone.
export function validateSubtaskPatch(input) {
  if (!isObject(input)) return { error: 'Invalid request body' };
  const out = {};
  if ('title' in input) {
    const r = subtaskTitle(input.title);
    if (r.error) return r;
    out.title = r.value;
  }
  if ('done' in input) {
    if (typeof input.done !== 'boolean') return { error: 'done must be true or false' };
    out.done = input.done;
  }
  if ('target_date' in input) {
    const d = optionalDate(input.target_date);
    if (d.error) return d;
    out.target_date = d.value;
  }
  if (!Object.keys(out).length) return { error: 'Nothing to change' };
  return { value: out };
}

export function validateUpdate(input) {
  if (!isObject(input)) return { error: 'Invalid request body' };
  const r = text(input.note ?? '', 'Update', 2000, { required: true });
  if (r.error) return r;
  const out = { note: r.value, status: null };
  if (input.status != null) {
    if (!validStatus(input.status)) return { error: 'Invalid status' };
    out.status = input.status;
  }
  return { value: out };
}
