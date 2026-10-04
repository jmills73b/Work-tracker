import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

const iso = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const post = (page, path, body) => page.evaluate(async ([p, b]) => {
  const res = await fetch(`/api${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  return res.json();
}, [path, body]);

const tasks = (page) => page.evaluate(async () => (await (await fetch('/api/tasks')).json()).tasks);

// One tap on a row's clock: plan it for today, push it to tomorrow or next week, mark it
// waiting with a chase date, or pick any date.
test('rows on Today reschedule, plan and wait in one tap', async ({ page }) => {
  await signIn(page, { view: 'today' });
  await post(page, '/tasks', { title: 'Plan: send invoice', target_date: iso(0) });
  await post(page, '/tasks', { title: 'Plan: supplier quote', target_date: iso(0) });
  await post(page, '/tasks', { title: 'Plan: chase me', status: 'blocked', waiting_until: iso(0) });
  await page.reload();

  const menu = page.locator('#row-menu');
  const rowMenu = (title) => page.locator('.row', { hasText: title }).getByRole('button', { name: `Reschedule: ${title}` });

  await expect(page.locator('.today-today')).toContainText('Plan: send invoice');
  await rowMenu('Plan: send invoice').click();
  await menu.getByRole('button', { name: 'Due tomorrow' }).click();
  await expect(page.locator('.today-today')).not.toContainText('Plan: send invoice');
  await expect(page.locator('.today-week .row', { hasText: 'Plan: send invoice' }).locator('.due')).toHaveText('Tomorrow');

  await rowMenu('Plan: send invoice').click();
  await menu.getByRole('button', { name: "Add to today's plan" }).click();
  await expect(page.locator('.today-plan')).toContainText('Plan: send invoice');

  await rowMenu('Plan: supplier quote').click();
  await menu.getByRole('button', { name: 'Waiting · chase in 2 days' }).click();
  // Still due today, so it stays there, now marked as waiting.
  await expect(page.locator('.today-today .row', { hasText: 'Plan: supplier quote' }).locator('.pill')).toContainText('Waiting · chase');
  const quote = (await tasks(page)).find((t) => t.title === 'Plan: supplier quote');
  expect([quote.status, quote.waiting_until]).toEqual(['blocked', iso(2)]);

  // A Waiting task whose chase date has come leads the list to chase.
  await expect(page.locator('.today-chase')).toContainText('Plan: chase me');
  await rowMenu('Plan: chase me').click();
  await menu.locator('#row-menu-date').fill(iso(3));
  await expect(menu).toBeHidden();
  const chased = (await tasks(page)).find((t) => t.title === 'Plan: chase me');
  expect(chased.target_date).toBe(iso(3));

  // In Tasks, Waiting shows how long until the chase.
  await page.locator('#view-toggle button[data-view="tasks"]').click();
  await page.locator('#status-filter button[data-status="blocked"]').click();
  await expect(page.locator('.row', { hasText: 'Plan: supplier quote' }).locator('.pill')).toContainText('Waiting · chase');
});

// The evening reminder opens /?plan=tomorrow: a short list to tick, each tick saved.
test('the plan screen opens from the evening link and plans tomorrow', async ({ page }) => {
  await signIn(page, { view: 'today' });
  await post(page, '/tasks', { title: 'Plan: tomorrow item', target_date: iso(1) });
  await post(page, '/tasks', { title: 'Plan: far off', target_date: iso(30) });
  await page.goto('/?plan=tomorrow');
  const dialog = page.locator('#plan-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#plan-title')).toContainText('Plan tomorrow');
  await expect(page).toHaveURL(/\/$/);
  await expect(dialog).not.toContainText('Plan: far off');
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH');
  await dialog.getByRole('checkbox', { name: 'Plan: Plan: tomorrow item' }).check();
  await saved;
  await dialog.getByRole('button', { name: 'Done' }).click();
  const t = (await tasks(page)).find((x) => x.title === 'Plan: tomorrow item');
  expect(t.planned_on).toBe(iso(1));
  // Planned for tomorrow, so not in today's plan yet.
  await expect(page.locator('.today-plan')).not.toContainText('Plan: tomorrow item');
});
