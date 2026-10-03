import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

// A repeating task, marked done, comes back as a fresh task with the next date and its
// subtasks unticked and moved on; reopening and finishing again doesn't make a second.
test('a weekly task marked done comes back next week with its subtasks, once', async ({ page }) => {
  await signIn(page);
  await page.locator('#new-task').click();
  await page.locator('#quick-details').click();
  const drawer = page.locator('#drawer');
  await drawer.locator('[name=title]').fill('Weekly RDH check-in');
  await drawer.locator('[name=target_date]').fill('2031-03-03');
  await drawer.locator('[name=recurrence]').selectOption('weekly:1');
  await drawer.locator('#subtask-input').fill('Prepare notes');
  await drawer.locator('#subtask-input').press('Enter');
  await drawer.getByRole('button', { name: 'Create task' }).click();
  await expect(drawer.getByRole('button', { name: 'Save changes' })).toBeVisible();
  // The timeline records the repeat on later changes; the row shows the ↻ marker.
  await page.keyboard.press('Escape');
  const row = page.locator('.row', { hasText: 'Weekly RDH check-in' });
  await expect(row.locator('.repeat-mark')).toHaveAttribute('title', 'Repeats every week');

  await row.getByRole('button', { name: 'Mark "Weekly RDH check-in" as done' }).click();
  await expect(page.locator('.toast', { hasText: 'Next one is due' })).toBeVisible();
  await expect(page.locator('.row', { hasText: 'Weekly RDH check-in' })).toHaveCount(1); // the done one is filtered out of Active

  await page.locator('.row', { hasText: 'Weekly RDH check-in' }).click();
  await expect(drawer.locator('[name=target_date]')).toHaveValue('2031-03-10');
  await expect(drawer.locator('[name=recurrence]')).toHaveValue('weekly:1');
  await expect(drawer.locator('.subtask-title')).toHaveValue('Prepare notes');
  await expect(drawer.locator('#timeline')).toContainText('Created from the previous occurrence');
  await page.keyboard.press('Escape');

  // Reopen the done one and finish it again: still only one next occurrence.
  await page.locator('#status-filter button[data-status="all"]').click();
  const done = page.locator('.row.is-done', { hasText: 'Weekly RDH check-in' });
  await done.getByRole('button', { name: 'as not done' }).click();
  await expect(page.locator('.row.is-done', { hasText: 'Weekly RDH check-in' })).toHaveCount(0);
  await page.locator('.row', { hasText: 'Weekly RDH check-in' }).filter({ has: page.locator('.due', { hasText: /Mar 3/ }) })
    .getByRole('button', { name: 'as done' }).click();
  await page.reload();
  await page.locator('#status-filter button[data-status="all"]').click();
  await expect(page.locator('.row', { hasText: 'Weekly RDH check-in' })).toHaveCount(2);
});

test('"days after done" counts from the day it is finished', async ({ page }) => {
  await signIn(page);
  await page.locator('#new-task').click();
  await page.locator('#quick-details').click();
  const drawer = page.locator('#drawer');
  await drawer.locator('[name=title]').fill('Water the office plants');
  await drawer.locator('[name=recurrence]').selectOption('after');
  await expect(drawer.locator('[name=repeat_days]')).toBeVisible();
  await drawer.locator('[name=repeat_days]').fill('3');
  await drawer.getByRole('button', { name: 'Create task' }).click();
  await expect(drawer.getByRole('button', { name: 'Save changes' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.locator('.row', { hasText: 'Water the office plants' }).getByRole('button', { name: 'as done' }).click();
  await page.locator('.row', { hasText: 'Water the office plants' }).click();
  const d = new Date();
  d.setDate(d.getDate() + 3);
  const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await expect(drawer.locator('[name=target_date]')).toHaveValue(expected);
  await expect(drawer.locator('[name=repeat_days]')).toHaveValue('3');
});
