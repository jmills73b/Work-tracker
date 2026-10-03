import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

// Adding a subtask clears the box when the save returns. If the next subtask was already
// being typed by then, clearing wiped it (seen in CI). Only what was sent is cleared now.
test('typing the next subtask while the last one is still saving keeps what was typed', async ({ page }) => {
  await signIn(page);
  await page.keyboard.press('n');
  await page.locator('#quick-input').fill('Slow network task');
  await page.locator('#quick-input').press('Enter');
  await page.locator('.row', { hasText: 'Slow network task' }).first().click();

  let release;
  const held = new Promise((r) => { release = r; });
  await page.route('**/api/tasks/*/subtasks', async (route) => {
    await held;
    await route.continue();
  });
  const input = page.locator('#subtask-input');
  await input.fill('First step');
  await input.press('Enter');
  await input.fill('Second st');
  release();
  await expect(page.locator('.subtask-title').first()).toHaveValue('First step');
  await expect(input).toHaveValue('Second st');
});
