import { devices, expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test.use({ viewport: devices['iPhone 12 Mini'].viewport, hasTouch: true, isMobile: true });

// The specs share one database; leave nothing behind for the Today spec to trip over.
test.afterEach(async ({ page }) => {
  await page.evaluate(async () => {
    const { tasks } = await (await fetch('/api/tasks')).json();
    for (const t of tasks.filter((x) => x.title.startsWith('Tick:'))) await fetch(`/api/tasks/${t.id}`, { method: 'DELETE' });
  });
});

// Ticking a row used to redraw the list at once, sliding the next row under the finger:
// on iPhone it then looked ticked, and a quick second tap really ticked it. The ticked row
// now stays put for a moment, and completing can be undone.
test('ticking a task on a phone completes only that task, and Undo brings it back', async ({ page }) => {
  await signIn(page, { view: 'today' });
  await page.evaluate(async (d) => {
    for (const title of ['Tick: first', 'Tick: second', 'Tick: third']) {
      await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, target_date: d }) });
    }
  }, today());
  await page.reload();
  const patches = [];
  page.on('request', (r) => { if (r.method() === 'PATCH') patches.push(r.url()); });

  const first = page.locator('.row', { hasText: 'Tick: first' });
  const box = await first.locator('.check').boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  // Two quick taps on the same spot: the second lands on the held, ticked row.
  await page.touchscreen.tap(x, y);
  await page.touchscreen.tap(x, y);
  await expect(page.locator('.row', { hasText: 'Tick: first' })).toHaveCount(0);
  await expect(page.locator('.row', { hasText: 'Tick: second' })).toBeVisible();
  await expect(page.locator('.row', { hasText: 'Tick: third' })).toBeVisible();
  expect(patches).toHaveLength(1);
  const states = await page.evaluate(async () => (await (await fetch('/api/tasks')).json()).tasks.filter((t) => t.title.startsWith('Tick:')).map((t) => [t.title, t.status]).sort());
  expect(states).toEqual([['Tick: first', 'done'], ['Tick: second', 'todo'], ['Tick: third', 'todo']]);

  await page.locator('.toast', { hasText: 'Done: Tick: first' }).getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.row', { hasText: 'Tick: first' })).toBeVisible();
});

test('ticking a step on Today completes only that step', async ({ page }) => {
  await signIn(page, { view: 'today' });
  const task = await page.evaluate(async () => (await (await fetch('/api/tasks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Tick: steps', target_date: '2099-01-01', subtasks: ['Step one', 'Step two'] }),
  })).json()).task);
  const detail = await page.evaluate(async (id) => (await (await fetch(`/api/tasks/${id}`)).json()), task.id);
  await page.evaluate(async ([id, steps, d]) => {
    for (const s of steps) await fetch(`/api/tasks/${id}/subtasks/${s.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_date: d }) });
  }, [task.id, detail.subtasks, today()]);
  await page.reload();
  const box = await page.locator('.row.is-step', { hasText: 'Step one' }).locator('.check').boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.row.is-step', { hasText: 'Step one' })).toHaveCount(0);
  await expect(page.locator('.row.is-step', { hasText: 'Step two' })).toBeVisible();
  const after = await page.evaluate(async (id) => (await (await fetch(`/api/tasks/${id}`)).json()).subtasks.map((s) => [s.title, s.done]), task.id);
  expect(after).toEqual([['Step one', 1], ['Step two', 0]]);
});
