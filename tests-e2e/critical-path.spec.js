import { expect, test } from '@playwright/test';
import { ACCOUNT, openTaskForm, signIn } from './helpers.js';

// The one spec that proves the whole chain wires together: page gate → login page →
// session cookie → API → D1 → back to the page.
test('a task with subtasks can be created, updated, completed and is still there after signing back in', async ({ page }) => {
  await signIn(page);

  await openTaskForm(page);
  await page.locator('#task-form [name=title]').fill('Write the quarterly report');
  await page.locator('#task-form [name=priority]').selectOption('high');
  // Subtasks added before the task exists are drafts, created along with it.
  for (const title of ['Outline', 'Draft sections']) {
    await page.locator('#subtask-input').fill(title);
    await page.locator('#subtask-input').press('Enter');
  }
  await page.locator('#save-btn').click();
  await expect(page.locator('#timeline')).toContainText('Task created');
  await expect(page.locator('#subtask-count')).toHaveText('0 of 2 done');

  // Ticking a subtask saves at once, starts the task, and both show on the timeline.
  await page.locator('.subtask', { has: page.locator('input[value="Outline"]') }).locator('.check').click();
  await expect(page.locator('#subtask-count')).toHaveText('1 of 2 done');
  await expect(page.locator('#timeline')).toContainText('Completed: Outline');
  await expect(page.locator('#timeline')).toContainText('Status: To do → In progress');

  // A subtask can carry its own date; the chip shows it in words.
  const draftRow = page.locator('.subtask', { has: page.locator('input[value="Draft sections"]') });
  await draftRow.locator('input[type=date]').fill('2030-01-15');
  await expect(draftRow.locator('.date-chip')).toContainText('Jan 15');

  await page.locator('#update-note').fill('Draft sections agreed with the team');
  await page.locator('#post-update').click();
  await expect(page.locator('.tl-note')).toContainText('Draft sections agreed with the team');
  await page.keyboard.press('Escape');

  const row = page.locator('.row', { hasText: 'Write the quarterly report' });
  await expect(row).toContainText('Draft sections agreed with the team');
  await expect(row.locator('.subtask-chip')).toHaveText('1/2');
  await expect(row.locator('.pill')).toHaveText('In progress');

  // The board shows each card's subtasks, and they can be ticked there without opening the task.
  await page.getByRole('button', { name: 'Board' }).click();
  const card = page.locator('.card', { hasText: 'Write the quarterly report' });
  await expect(card.locator('.card-subtask')).toHaveText([/Outline/, /Draft sections.*Jan 15/]);
  await card.locator('.card-subtask', { hasText: 'Draft sections' }).locator('.check').click();
  await expect(card.locator('.subtask-chip')).toHaveText('2/2');
  await expect(page.locator('#drawer')).toBeHidden();
  await page.getByRole('button', { name: 'List' }).click();

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
  await expect(done.locator('.pill')).toHaveText('Done');
  // Subtasks are their own record: finishing the task doesn't tick them.
  await expect(done.locator('.subtask-chip')).toHaveText('2/2');
});
