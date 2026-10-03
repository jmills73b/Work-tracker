import { expect, test } from '@playwright/test';
import { openTaskForm, signIn } from './helpers.js';

// The test Worker has no API key, so the real server never offers the assistant. The
// second test stubs the two calls that differ (me says it's on; /api/assist answers) and
// drives everything else for real, at iPhone 12 mini size.
test('without an API key the assistant button is not offered', async ({ page }) => {
  await signIn(page);
  await openTaskForm(page);
  await expect(page.locator('#assist-btn')).toBeHidden();
});

test('the assistant shows yours and its suggestion side by side; Keep changes nothing, Replace fills the form', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/auth/me', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), assistant: true } });
  });
  const asked = [];
  await page.route('**/api/assist', async (route) => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        title: 'Fix RDH day-one access for new starters',
        description: "New starters can't access RDH on day one.",
        reason: 'Leads with the action and drops filler.',
        changed: { title: true, description: true },
      },
    });
  });
  await signIn(page);

  await page.keyboard.press('n');
  await page.locator('#quick-input').fill('need to sort out the RDH thing asap');
  await page.locator('#quick-input').press('Enter');
  await page.locator('.row', { hasText: 'need to sort out the RDH thing asap' }).click();
  const drawer = page.locator('#drawer');
  await drawer.locator('[name=description]').fill('new starters cant get in on day 1');

  const sheet = page.locator('#assist-dialog');
  await page.locator('#assist-btn').click();
  await expect(sheet.locator('#assist-title-old')).toHaveText('need to sort out the RDH thing asap');
  await expect(sheet.locator('#assist-title-new')).toHaveText('Fix RDH day-one access for new starters');
  await expect(sheet.locator('#assist-desc-new')).toHaveText("New starters can't access RDH on day one.");
  await expect(sheet.locator('#assist-why')).toHaveText('Leads with the action and drops filler.');
  expect(asked).toEqual([{ title: 'need to sort out the RDH thing asap', description: 'new starters cant get in on day 1' }]);

  // Side by side, inside the phone's width.
  const [yours, suggested] = await sheet.locator('#assist-title-field .assist-card').evaluateAll((cards) => cards.map((c) => c.getBoundingClientRect()));
  expect(Math.abs(yours.top - suggested.top)).toBeLessThan(1);
  expect(suggested.right).toBeLessThanOrEqual(375);

  // Escape closes the sheet, not the drawer behind it; Keep original changes nothing.
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(drawer).toBeVisible();
  await page.locator('#assist-btn').click();
  await sheet.getByRole('button', { name: 'Keep original' }).click();
  await expect(drawer.locator('[name=title]')).toHaveValue('need to sort out the RDH thing asap');

  await page.locator('#assist-btn').click();
  await sheet.getByRole('button', { name: 'Replace' }).click();
  await expect(sheet).toBeHidden();
  await expect(drawer.locator('[name=title]')).toHaveValue('Fix RDH day-one access for new starters');
  await expect(drawer.locator('[name=description]')).toHaveValue("New starters can't access RDH on day one.");
  await drawer.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.row', { hasText: 'Fix RDH day-one access for new starters' })).toBeVisible();
});

test('a task that already reads clearly gets a plain answer and no Replace button', async ({ page }) => {
  await page.route('**/api/auth/me', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), assistant: true } });
  });
  await page.route('**/api/assist', (route) => route.fulfill({
    json: { title: 'Book Q3 review', description: '', reason: 'Already clear.', changed: { title: false, description: false } },
  }));
  await signIn(page);
  await page.keyboard.press('n');
  await page.locator('#quick-input').fill('Book Q3 review');
  await page.locator('#quick-input').press('Enter');
  await page.locator('.row', { hasText: 'Book Q3 review' }).click();
  await page.locator('#assist-btn').click();
  const sheet = page.locator('#assist-dialog');
  await expect(sheet.locator('#assist-status')).toHaveText('This task already reads clearly. Nothing to change.');
  await expect(sheet.getByRole('button', { name: 'Replace' })).toBeHidden();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();
});
