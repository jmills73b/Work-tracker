import { expect, test } from '@playwright/test';
import { openTaskForm, signIn } from './helpers.js';

// States that only break end to end: a blank page and a page that explains itself look
// identical to every unit test.

test('with no tasks the app explains itself and offers to create one', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/tasks', (route) => route.fulfill({ json: { tasks: [] } }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'No tasks yet' })).toBeVisible();
  await expect(page.locator('#tasks').getByRole('button', { name: 'New task' })).toBeVisible();
});

test('a failed save shows the server message and the page keeps working', async ({ page }) => {
  // notify() once called itself, so the first error froze the page instead of showing it.
  await signIn(page);
  await page.route('**/api/tasks', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 500, json: { error: 'Database is having a moment' } })
      : route.continue());
  await openTaskForm(page);
  await page.locator('#task-form [name=title]').fill('This save will fail');
  await page.locator('#save-btn').click();
  await expect(page.locator('.toast.error')).toHaveText('Database is having a moment');
  // The unsaved title is still there, so closing asks first.
  page.once('dialog', (d) => d.accept());
  await page.keyboard.press('Escape');
  await expect(page.locator('#drawer')).toBeHidden();
  await page.locator('#view-toggle button[data-view="review"]').click();
  await expect(page.locator('.review')).toBeVisible();
});
