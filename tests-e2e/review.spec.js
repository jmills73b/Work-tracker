import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

// Done lists newest first; Review is its own view, counting what was done.
test('Done lists newest first, and Review counts what was done by week and by team', async ({ page }) => {
  await signIn(page);
  await page.evaluate(async () => {
    const post = (p, b, m = 'POST') => fetch(`/api${p}`, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
    for (const title of ['Review: finished first', 'Review: finished second']) {
      const a = await post('/tasks', { title });
      await post(`/tasks/${a.task.id}`, { status: 'done' }, 'PATCH');
      await new Promise((r) => setTimeout(r, 1100)); // completed_at is to the second
    }
  });
  await page.reload();
  await page.locator('#status-filter button[data-status="done"]').click();
  const done = await page.locator('.row.is-done .row-title .text').allTextContents();
  expect(done.indexOf('Review: finished second')).toBeLessThan(done.indexOf('Review: finished first'));

  await page.locator('#view-toggle button[data-view="review"]').click();
  const review = page.locator('.review');
  await expect(review.locator('.ins-tile').first()).toContainText('Done, last 30 days');
  await expect(review.locator('.ins-tile', { hasText: 'Waiting' })).toBeVisible();
  await expect(review.locator('.ins-chart .ins-bar-hit')).toHaveCount(12);
  await review.locator('summary').click();
  const weekly = await review.locator('.ins-details tbody tr td').allTextContents();
  expect(weekly.map(Number).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(2);
  await expect(review.locator('.ins-section').nth(1).locator('tbody')).toContainText('No team');
  // The Tasks filters don't apply here.
  await expect(page.locator('#status-filter')).toBeHidden();
});
