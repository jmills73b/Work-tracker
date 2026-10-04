import { STATUS } from '../../public/shared/rules.js';
import { exportRows } from '../infra/tasksRepo.js';
import { listTeams } from '../infra/teamsRepo.js';

// Everything you own, as a download: JSON (tasks with their steps and full log) or CSV
// (one row per task, for a spreadsheet). Nothing is left out but other people's data.
export async function download(env, user, format, now = new Date()) {
  const [tasks, teams] = await Promise.all([exportRows(env, user.id), listTeams(env, user.id)]);
  const day = now.toISOString().slice(0, 10);
  if (format === 'csv') {
    return file(toCsv(tasks), `mills-tasks-${day}.csv`, 'text/csv; charset=utf-8');
  }
  const body = JSON.stringify({ exported_at: now.toISOString(), teams: teams.map(({ id, name }) => ({ id, name })), tasks }, null, 2);
  return file(body, `mills-tasks-${day}.json`, 'application/json; charset=utf-8');
}

const file = (body, name, type) => new Response(body, {
  headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' },
});

const COLUMNS = ['Title', 'Status', 'High', 'Due', 'Team', 'Repeats', 'Steps done', 'Steps', 'Notes', 'Created', 'Done on', 'Last log entry'];

// RFC 4180: quote every field, double any quote. A leading = + - @ is prefixed with ' so
// a spreadsheet shows the text instead of running it as a formula.
export function csvField(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(tasks) {
  const rows = tasks.map((t) => {
    const notes = t.log.filter((u) => u.kind === 'note');
    return [
      t.title, STATUS[t.status] ?? t.status, t.priority === 'high' ? 'Yes' : '', t.target_date, t.team_name, t.recurrence,
      t.steps.filter((s) => s.done).length, t.steps.length, t.description, t.created_at.slice(0, 10),
      t.completed_at ? t.completed_at.slice(0, 10) : '', notes.length ? notes.at(-1).note : '',
    ];
  });
  return [COLUMNS, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n');
}
