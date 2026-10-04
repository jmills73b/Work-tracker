import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

const post = (page, path, body) => page.evaluate(async ([p, b]) => {
  const res = await fetch(`/api${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  return res.json();
}, [path, body]);

// Duplicate and Delete live in the task's ⋯ menu; Waiting asks when to chase.
test('Duplicate copies a task with its steps; Delete removes one; Waiting gets a chase date', async ({ page }) => {
  await signIn(page);
  await post(page, '/tasks', { title: 'Actions: monthly payroll', target_date: '2031-05-28', priority: 'high', subtasks: ['Check hours', 'Submit'] });
  await page.reload();

  await page.locator('.row', { hasText: 'Actions: monthly payroll' }).click();
  const drawer = page.locator('#drawer');
  await drawer.locator('#task-menu-btn').click();
  await drawer.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(drawer.locator('#drawer-eyebrow')).toHaveText('New task');
  await expect(drawer.locator('[name=title]')).toHaveValue('Actions: monthly payroll');
  await expect(drawer.locator('[name=high]')).toBeChecked();
  await expect(drawer.locator('.subtask-title')).toHaveCount(2);
  await drawer.locator('[name=title]').fill('Actions: June payroll');
  await drawer.locator('[name=target_date]').fill('2031-06-28');
  await drawer.getByRole('button', { name: 'Create task' }).click();
  await expect(drawer.locator('#step-count')).toHaveText('0 of 2 done');
  await page.keyboard.press('Escape');
  await expect(page.locator('.row', { hasText: 'Actions: June payroll' }).locator('.subtask-chip')).toHaveText('0/2');

  // Waiting: the chase date defaults to two days out and can be changed.
  await page.locator('.row', { hasText: 'Actions: June payroll' }).click();
  await page.locator('#task-summary').click();
  await drawer.locator('[name=status]').selectOption('blocked');
  await expect(drawer.locator('[name=waiting_until]')).toBeVisible();
  await expect(drawer.locator('[name=waiting_until]')).not.toHaveValue('');
  await expect(drawer.locator('#timeline')).toContainText('Status: Open → Waiting');
  await expect(drawer.locator('#task-summary')).toContainText('Waiting');
  await page.keyboard.press('Escape');
  await page.locator('#status-filter button[data-status="blocked"]').click();
  await expect(page.locator('.row', { hasText: 'Actions: June payroll' })).toBeVisible();

  await page.locator('.row', { hasText: 'Actions: June payroll' }).click();
  await drawer.locator('#task-menu-btn').click();
  page.once('dialog', (d) => d.accept());
  await drawer.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(drawer).toBeHidden();
  await expect(page.locator('.row', { hasText: 'Actions: June payroll' })).toHaveCount(0);
  await page.locator('#status-filter button[data-status="todo"]').click();
  await expect(page.locator('.row', { hasText: 'Actions: monthly payroll' })).toBeVisible();
});

test('everything can be exported as JSON or a spreadsheet', async ({ page }) => {
  await signIn(page);
  await post(page, '/tasks', { title: 'Export: = not a formula', subtasks: ['One step'] });

  await page.locator('#user-button').click();
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export (spreadsheet)' }).click();
  const csv = await csvDownload;
  expect(csv.suggestedFilename()).toMatch(/^mills-tasks-\d{4}-\d{2}-\d{2}\.csv$/);

  const res = await page.request.get('/api/export?format=json');
  const body = await res.json();
  const t = body.tasks.find((x) => x.title === 'Export: = not a formula');
  expect(t.steps.map((s) => s.title)).toEqual(['One step']);
  expect(t.log.map((l) => l.note)).toContain('Task created');
  const text = await (await page.request.get('/api/export?format=csv')).text();
  expect(text).toContain('"Export: = not a formula","Open"');
});
