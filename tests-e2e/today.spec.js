import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

const iso = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Today is the home screen: overdue, today and the next 7 days, with steps listed in
// their own right so a step due today shows even when its task is due much later.
test('Today lists what is overdue, due today and due this week, steps included, and ticks them off', async ({ page }) => {
  await signIn(page, { view: 'today' });
  const api = (path, body) => page.evaluate(async ([p, b]) => {
    const res = await fetch(`/api${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    return res.json();
  }, [path, body]);
  await api('/tasks', { title: 'Today: late report', target_date: iso(-2), priority: 'high' });
  await api('/tasks', { title: 'Today: big project', target_date: iso(40), subtasks: ['Today: send the draft'] });
  await api('/tasks', { title: 'Today: next week item', target_date: iso(5) });
  await api('/tasks', { title: 'Today: far away', target_date: iso(30) });
  // Give the big project's step today's date.
  const list = await page.evaluate(async () => (await (await fetch('/api/tasks')).json()).tasks);
  const big = list.find((t) => t.title === 'Today: big project');
  await page.evaluate(async ([id, sid, date]) => {
    await fetch(`/api/tasks/${id}/subtasks/${sid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_date: date }) });
  }, [big.id, big.subtasks[0].id, iso(0)]);
  await page.reload();

  await expect(page.locator('.today-overdue')).toContainText('Today: late report');
  const todayGroup = page.locator('.today-today');
  await expect(todayGroup.locator('.row.is-step')).toContainText('Today: send the draft');
  await expect(todayGroup.locator('.row.is-step')).toContainText('Today: big project');
  await expect(page.locator('.today-week')).toContainText('Today: next week item');
  await expect(page.locator('.today')).not.toContainText('Today: far away');
  // Status chips, High and sort belong to the Tasks view.
  await expect(page.locator('#status-filter')).toBeHidden();
  await expect(page.locator('#sort')).toBeHidden();

  // Ticking the step here ticks it for real, and it leaves the list.
  await todayGroup.getByRole('button', { name: 'Mark done: Today: send the draft' }).click();
  await expect(page.locator('.today')).not.toContainText('Today: send the draft');
  await page.reload();
  await expect(page.locator('.today')).not.toContainText('Today: send the draft');

  // Tapping a row opens its task.
  await page.locator('#view-toggle button[data-view="tasks"]').click();
  await page.locator('#view-toggle button[data-view="today"]').click();
  await page.locator('.today-overdue .row', { hasText: 'Today: late report' }).click();
  await expect(page.locator('#drawer [name=title]')).toHaveValue('Today: late report');
});
