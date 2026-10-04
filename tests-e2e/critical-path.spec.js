import { expect, test } from '@playwright/test';
import { ACCOUNT, openTaskForm, signIn } from './helpers.js';

// The one spec that proves the whole chain wires together: page gate → login page →
// session cookie → API → D1 → back to the page.
test('a task with steps can be created, edited without a save button, logged, completed, and is still there after signing back in', async ({ page }) => {
  await signIn(page);

  await openTaskForm(page);
  await page.locator('#task-form [name=title]').fill('Write the quarterly report');
  await page.locator('#task-form [name=high]').check();
  // Steps added before the task exists are drafts, created along with it.
  for (const title of ['Outline', 'Draft sections']) {
    await page.locator('#step-input').fill(title);
    await page.locator('#step-input').press('Enter');
  }
  await page.locator('#save-btn').click();
  await expect(page.locator('#timeline')).toContainText('Task created');
  await expect(page.locator('#step-count')).toHaveText('0 of 2 done');
  await expect(page.locator('#save-btn')).toBeHidden();

  // Ticking a step saves at once and is logged; it doesn't change the task's state.
  await page.locator('.subtask', { has: page.locator('input[value="Outline"]') }).locator('.check').click();
  await expect(page.locator('#step-count')).toHaveText('1 of 2 done');
  await expect(page.locator('#timeline')).toContainText('Completed: Outline');
  await expect(page.locator('#timeline')).not.toContainText('Status:');

  // A step can carry its own date; the chip shows it in words.
  const draftRow = page.locator('.subtask', { has: page.locator('input[value="Draft sections"]') });
  await draftRow.locator('input[type=date]').fill('2030-01-15');
  await expect(draftRow.locator('.date-chip')).toContainText('Jan 15');

  // Fields save as you go: the summary line opens them, and a change is logged at once.
  await page.locator('#task-summary').click();
  await page.locator('#task-form [name=target_date]').fill('2030-02-01');
  await expect(page.locator('#timeline')).toContainText('Deadline: none → 2030-02-01');
  // So does the title, a moment after you stop typing.
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/api\/tasks\/[^/]+$/.test(r.url()));
  await page.locator('#task-form [name=title]').fill('Write the Q3 report');
  await saved;

  await page.locator('#log-note').fill('Draft sections agreed with the team');
  await page.locator('#post-log').click();
  await expect(page.locator('.tl-note')).toContainText('Draft sections agreed with the team');
  await page.keyboard.press('Escape');

  const row = page.locator('.row', { hasText: 'Write the Q3 report' });
  await expect(row).toContainText('Draft sections agreed with the team');
  await expect(row.locator('.subtask-chip')).toHaveText('1/2');
  await expect(row.locator('.prio-badge')).toHaveText('High');

  await row.locator('.check').click();
  await expect(page.locator('.row', { hasText: 'Write the Q3 report' })).toHaveCount(0);
  await page.locator('[data-status=done]').click();
  await expect(page.locator('.row.is-done', { hasText: 'Write the Q3 report' })).toBeVisible();

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
  const done = page.locator('.row.is-done', { hasText: 'Write the Q3 report' });
  await expect(done).toBeVisible();
  // Steps are their own record: finishing the task doesn't tick them.
  await expect(done.locator('.subtask-chip')).toHaveText('1/2');
});
