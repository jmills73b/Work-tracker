import { expect, test } from '@playwright/test';
import { ACCOUNT, signIn } from './helpers.js';

// The one spec that proves the whole chain wires together: page gate → login page →
// session cookie → API → D1 → back to the page.
test('a task can be created, updated, completed and is still there after signing back in', async ({ page }) => {
  await signIn(page);

  await page.locator('#new-task').click();
  await page.locator('#task-form [name=title]').fill('Write the quarterly report');
  await page.locator('#task-form [name=priority]').selectOption('high');
  await page.locator('#save-btn').click();
  await expect(page.locator('#timeline')).toContainText('Task created');

  await page.locator('#update-note').fill('Draft sections agreed with the team');
  await page.locator('#update-progress').selectOption('40');
  await page.locator('#post-update').click();
  await expect(page.locator('.tl-note')).toContainText('Draft sections agreed with the team');
  // Posting progress on a to-do task starts it.
  await expect(page.locator('#timeline')).toContainText('Status: To do → In progress');
  await page.keyboard.press('Escape');

  const row = page.locator('.row', { hasText: 'Write the quarterly report' });
  await expect(row).toContainText('Draft sections agreed with the team');
  await expect(row).toContainText('40%');
  await expect(row.locator('.pill')).toHaveText('In progress');

  await row.locator('.check').click();
  await page.locator('[data-status=done]').click();
  await expect(page.locator('.row', { hasText: 'Write the quarterly report' }).locator('.pill')).toHaveText('Done');

  await page.locator('#user-button').click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL((url) => url.pathname === '/login');

  // Signed out, the app itself is behind the gate.
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);

  // A wrong password shows the server's words, verbatim, and the form can be retried.
  await page.locator('#login-form [name=email]').fill(ACCOUNT.email);
  await page.locator('#login-form [name=password]').fill('not-the-password');
  await page.locator('#login-form button[type=submit]').click();
  await expect(page.locator('#login-error')).toHaveText('Invalid email or password');
  await expect(page.locator('#login-form button[type=submit]')).toBeEnabled();

  await signIn(page);
  await page.locator('[data-status=done]').click();
  const done = page.locator('.row', { hasText: 'Write the quarterly report' });
  // Marking a task done completes its progress.
  await expect(done.locator('.pill')).toHaveText('Done');
  await expect(done).toContainText('100%');
});
