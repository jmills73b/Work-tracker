import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

// Saving uses a prompt and reuse goes through a picker and a date field: wiring that only
// breaks end to end.
test('a task saved as a template lays its subtask dates out again from a new target date', async ({ page }) => {
  await signIn(page);

  await page.locator('#new-task').click();
  await page.locator('#task-form [name=title]').fill('Monthly board pack');
  await page.locator('#task-form [name=target_date]').fill('2030-03-20');
  for (const title of ['Collect numbers', 'Send pack']) {
    await page.locator('#subtask-input').fill(title);
    await page.locator('#subtask-input').press('Enter');
  }
  await page.locator('.subtask', { has: page.locator('input[value="Collect numbers"]') }).locator('input[type=date]').fill('2030-03-13');
  await page.locator('.subtask', { has: page.locator('input[value="Send pack"]') }).locator('input[type=date]').fill('2030-03-19');
  await page.locator('#save-btn').click();
  await expect(page.locator('#timeline')).toContainText('Task created');

  page.once('dialog', (d) => d.accept('Board pack'));
  await page.locator('#save-template-btn').click();
  await expect(page.locator('.toast').last()).toHaveText('Saved template "Board pack"');
  await page.keyboard.press('Escape');

  await page.locator('#new-task').click();
  await page.locator('#template-select').selectOption({ label: 'Board pack' });
  await expect(page.locator('#task-form [name=title]')).toHaveValue('Monthly board pack');
  await page.locator('#task-form [name=target_date]').fill('2030-04-17');
  // 7 days and 1 day before the new date, as in the original.
  await expect(page.locator('.subtask').nth(0).locator('.date-chip')).toContainText('Apr 10');
  await expect(page.locator('.subtask').nth(1).locator('.date-chip')).toContainText('Apr 16');
  await page.locator('#task-form [name=title]').fill('April board pack');
  await page.locator('#save-btn').click();
  await expect(page.locator('#timeline')).toContainText('Task created');
  await expect(page.locator('#subtask-count')).toHaveText('0 of 2 done');
});
