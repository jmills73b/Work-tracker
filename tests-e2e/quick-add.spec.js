import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

// The preview and the saved task must agree: the parser runs in the page, the task is
// saved by the API, and only a browser shows both.
test('quick add turns one line into a dated, prioritised task on a team', async ({ page }) => {
  await signIn(page);
  await page.keyboard.press('n');
  await page.locator('#quick-input').fill('Book flights tomorrow !high #rdh');
  const preview = page.locator('#quick-preview');
  await expect(preview.locator('.qp-title')).toHaveText('Book flights');
  await expect(preview.locator('.prio-badge')).toHaveText('High');
  await expect(preview.locator('.tag')).toHaveText('RDH');
  await page.locator('#quick-input').press('Enter');

  await expect(page.locator('#quick-dialog')).toBeHidden();
  const row = page.locator('.row', { hasText: 'Book flights' });
  await expect(row.locator('.prio-badge')).toHaveText('High');
  await expect(row.locator('.tag')).toHaveText('RDH');
  await expect(row.locator('.due')).toHaveText('Tomorrow');
});
