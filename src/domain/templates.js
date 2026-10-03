// Templates store subtask dates relative to the task's target date.

const DAY_MS = 86400000;
const toDay = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

// Whole days from `from` to `to` (both YYYY-MM-DD): negative when `to` is earlier.
// null when either date is missing: an undated subtask stays undated.
export function dayOffset(from, to) {
  if (!from || !to) return null;
  return Math.round(toDay(to) - toDay(from));
}

// What a task becomes as a template. A subtask's offset is only meaningful against a
// task date, so on an undated task every offset is null.
export function templateFromTask(task, subtasks) {
  return {
    title: task.title,
    description: task.description || '',
    priority: task.priority,
    team_id: task.team_id ?? null,
    subtasks: subtasks.map((st) => ({ title: st.title, offset_days: dayOffset(task.target_date, st.target_date) })),
  };
}

export function validateTemplateName(name) {
  const v = typeof name === 'string' ? name.trim() : '';
  if (!v) return { error: 'Template name is required' };
  if (v.length > 80) return { error: 'Template name must be at most 80 characters' };
  return { value: v };
}
