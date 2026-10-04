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

// One tap on a row's clock moves its "when" (never its deadline), marks it Waiting, or,
// for a Waiting task, records a chase and sets the next one.
test('rows on Today move the day, keep the deadline, wait and chase in one tap', async ({ page }) => {
  await signIn(page, { view: 'today' });
  await post(page, '/tasks', { title: 'Plan: send invoice', target_date: iso(0) });
  await post(page, '/tasks', { title: 'Plan: supplier quote', target_date: iso(0) });
  await post(page, '/tasks', { title: 'Plan: chase me', status: 'blocked', planned_on: iso(0) });
  await page.reload();

  const menu = page.locator('#row-menu');
  const rowMenu = (title) => page.locator('.row', { hasText: title }).getByRole('button', { name: `Move: ${title}` });
  const find = async (title) => (await tasks(page)).find((t) => t.title === title);

  await expect(page.locator('.today-today')).toContainText('Plan: send invoice');
  await rowMenu('Plan: send invoice').click();
  await menu.getByRole('button', { name: 'Tomorrow', exact: true }).click();
  await expect(page.locator('.today-today')).not.toContainText('Plan: send invoice');
  await expect(page.locator('.today-week')).toContainText('Plan: send invoice');
  const moved = await find('Plan: send invoice');
  expect([moved.planned_on, moved.target_date]).toEqual([iso(1), iso(0)]); // the deadline stays

  await rowMenu('Plan: send invoice').click();
  await menu.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.locator('.today-plan')).toContainText('Plan: send invoice');

  await rowMenu('Plan: supplier quote').click();
  await menu.getByRole('button', { name: 'Waiting · chase in 2 days' }).click();
  // Its deadline is still today, so it stays there, now marked as waiting.
  await expect(page.locator('.today-today .row', { hasText: 'Plan: supplier quote' }).locator('.pill')).toContainText('Waiting · chase');
  const quote = await find('Plan: supplier quote');
  expect([quote.status, quote.planned_on]).toEqual(['blocked', iso(2)]);

  // A Waiting task whose chase day has come leads the list; one tap records the chase.
  await expect(page.locator('.today-chase')).toContainText('Plan: chase me');
  await rowMenu('Plan: chase me').click();
  await menu.getByRole('button', { name: 'Chased · again in 2 days' }).click();
  await expect(page.locator('.today')).not.toContainText('Plan: chase me');
  expect((await find('Plan: chase me')).planned_on).toBe(iso(2));

  // Any day from the picker.
  await rowMenu('Plan: send invoice').click();
  await menu.locator('#row-menu-date').fill(iso(3));
  await expect(menu).toBeHidden();
  expect((await find('Plan: send invoice')).planned_on).toBe(iso(3));

  // In Tasks, the chase shows on the row and in the log.
  await page.locator('#view-toggle button[data-view="tasks"]').click();
  await page.locator('#status-filter button[data-status="blocked"]').click();
  await expect(page.locator('.row', { hasText: 'Plan: chase me' }).locator('.pill')).toContainText('Waiting · chase');
  await page.locator('.row', { hasText: 'Plan: chase me' }).click();
  await expect(page.locator('#timeline')).toContainText(`Chased · next chase ${iso(2)}`);
  await page.keyboard.press('Escape');
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
  // Planned for tomorrow, so it waits in the next 7 days, not today.
  await expect(page.locator('.today-week')).toContainText('Plan: tomorrow item');
  await expect(page.locator('.today-plan, .today-today').filter({ hasText: 'Plan: tomorrow item' })).toHaveCount(0);
});
