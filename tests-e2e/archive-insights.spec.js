import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

// The browser's clock is moved 40 days on, so a task finished "today" is past the 30-day
// archive line without touching the database.
test('done tasks older than 30 days move to the Archive, stay searchable, and Insights counts them', async ({ page }) => {
  await signIn(page);
  const created = await page.evaluate(async () => {
    const post = (p, b, m = 'POST') => fetch(`/api${p}`, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
    const a = await post('/tasks', { title: 'Archive: old finished report' });
    await post(`/tasks/${a.task.id}`, { status: 'done' }, 'PATCH');
    return a.task.id;
  });
  expect(created).toBeTruthy();
  // Done "today" as far as the server knows, but 40 days ago by the page's clock.
  await page.clock.install({ time: new Date(Date.now() + 40 * 86400000) });
  await page.reload();

  await page.locator('#status-filter button[data-status="done"]').click();
  await expect(page.locator('.row', { hasText: 'Archive: old finished report' })).toHaveCount(0);
  await page.locator('#status-filter button[data-status="archived"]').click();
  await expect(page.locator('.row', { hasText: 'Archive: old finished report' })).toBeVisible();

  // A search among active tasks that finds nothing offers to search everything.
  await page.locator('#status-filter button[data-status="active"]').click();
  await page.locator('#search').fill('old finished report');
  await page.getByRole('button', { name: 'Search all tasks' }).click();
  await expect(page.locator('.row', { hasText: 'Archive: old finished report' })).toBeVisible();
  await page.locator('#search').fill('');

  // The board's Done column leaves it out and links to the archive.
  await page.locator('#view-toggle button[data-view="board"]').click();
  await expect(page.locator('.column.status-done .card', { hasText: 'Archive: old finished report' })).toHaveCount(0);
  await page.locator('.archive-link').click();
  await expect(page.locator('#status-filter button[data-status="archived"]')).toHaveAttribute('aria-pressed', 'true');

  // Insights: the tiles and the weekly table both count what was done.
  await page.locator('#user-button').click();
  await page.getByRole('menuitem', { name: 'Insights' }).click();
  const dialog = page.locator('#insights-dialog');
  await expect(dialog.locator('.ins-tile').first()).toContainText('Done, last 30 days');
  await expect(dialog.locator('.ins-chart .ins-bar-hit')).toHaveCount(12);
  await dialog.locator('summary').click();
  const weekly = await dialog.locator('.ins-details tbody tr td').allTextContents();
  expect(weekly.map(Number).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1);
  await expect(dialog.locator('.ins-section').nth(1).locator('tbody')).toContainText('No team');
  await dialog.getByRole('button', { name: 'Close' }).click();
});
