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
        steps: [],
        reason: 'Leads with the action and drops filler.',
        changed: { title: true, description: true, steps: [] },
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
  expect(asked).toEqual([{ title: 'need to sort out the RDH thing asap', description: 'new starters cant get in on day 1', steps: [] }]);

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
  // Replaced words save like typed ones: no save button.
  await expect(drawer.locator('#timeline')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.row', { hasText: 'Fix RDH day-one access for new starters' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.row', { hasText: 'Fix RDH day-one access for new starters' })).toBeVisible();
});

test('a task that already reads clearly gets a plain answer and no Replace button', async ({ page }) => {
  await page.route('**/api/auth/me', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), assistant: true } });
  });
  await page.route('**/api/assist', (route) => route.fulfill({
    json: { title: 'Book Q3 review', description: '', steps: [], reason: 'Already clear.', changed: { title: false, description: false, steps: [] } },
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

test('Tidy covers the steps too: each changed step has its own tick, and only ticked ones are renamed', async ({ page }) => {
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
        description: '',
        steps: ['Ask Sarah about the AD group', 'Raise a ticket for the RDH access issue'],
        reason: 'Steps lead with a verb.',
        changed: { title: false, description: false, steps: [true, true] },
      },
    });
  });
  await signIn(page);
  await page.keyboard.press('n');
  await page.locator('#quick-input').fill('Fix RDH day-one access for new starters');
  await page.locator('#quick-input').press('Enter');
  await page.locator('.row', { hasText: 'Fix RDH day-one access for new starters' }).first().click();
  const drawer = page.locator('#drawer');
  for (const [i, t] of ['done already', 'ask sarah re AD', 'ticket??'].entries()) {
    await drawer.locator('#step-input').fill(t);
    await drawer.locator('#step-input').press('Enter');
    await expect(drawer.locator('.subtask-title').nth(i)).toHaveValue(t);
  }
  await drawer.locator('.subtask').first().locator('.check').click();
  await expect(drawer.locator('#step-count')).toHaveText('1 of 3 done');
  // One ✨ for the whole task: none on the steps or the add-step box.
  await expect(drawer.locator('.subtasks .sub-assist, .subtasks .assist-btn')).toHaveCount(0);

  await page.locator('#assist-btn').click();
  const sheet = page.locator('#assist-dialog');
  await expect(sheet.locator('.assist-step')).toHaveCount(2);
  // Only the open steps are sent.
  expect(asked[0].steps).toEqual(['ask sarah re AD', 'ticket??']);
  await sheet.locator('.assist-step').first().locator('input').uncheck();
  await sheet.getByRole('button', { name: 'Replace' }).click();
  await expect(drawer.locator('.subtask-title').nth(2)).toHaveValue('Raise a ticket for the RDH access issue');
  await expect(drawer.locator('.subtask-title').nth(1)).toHaveValue('ask sarah re AD');

  // Saved straight away, like any step rename: still there after reopening.
  await page.keyboard.press('Escape');
  await page.locator('.row', { hasText: 'Fix RDH day-one access for new starters' }).first().click();
  await expect(drawer.locator('.subtask-title').nth(2)).toHaveValue('Raise a ticket for the RDH access issue');
});

test('Tidy shows your log entry and the tidied one side by side; Replace fills the box and nothing posts until Post', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/auth/me', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), assistant: true } });
  });
  const asked = [];
  await page.route('**/api/assist/update', async (route) => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({ json: { text: 'Spoke to Sarah. Ticket raised for the AD group.', reason: 'Two clear sentences.', changed: true } });
  });
  await signIn(page);
  await page.keyboard.press('n');
  await page.locator('#quick-input').fill('Tidy test task');
  await page.locator('#quick-input').press('Enter');
  await page.locator('.row', { hasText: 'Tidy test task' }).first().click();

  const drawer = page.locator('#drawer');
  await drawer.locator('#log-note').fill('spoke 2 sarah, raised ticket re AD grp');
  await drawer.getByRole('button', { name: 'Tidy this entry' }).click();
  const panel = drawer.locator('.update-suggest');
  await expect(panel.locator('.assist-card').first()).toContainText('spoke 2 sarah, raised ticket re AD grp');
  await expect(panel.locator('.assist-card.suggested')).toContainText('Spoke to Sarah. Ticket raised for the AD group.');
  expect(asked).toEqual([{ task_title: 'Tidy test task', note: 'spoke 2 sarah, raised ticket re AD grp' }]);
  const [a, b] = await panel.locator('.assist-card').evaluateAll((cards) => cards.map((c) => c.getBoundingClientRect()));
  expect(Math.abs(a.top - b.top)).toBeLessThan(1);

  await panel.getByRole('button', { name: 'Replace' }).click();
  await expect(panel).toHaveCount(0);
  await expect(drawer.locator('#log-note')).toHaveValue('Spoke to Sarah. Ticket raised for the AD group.');
  await expect(drawer.locator('#timeline')).not.toContainText('Spoke to Sarah');

  await drawer.locator('#post-log').click();
  await expect(drawer.locator('#timeline')).toContainText('Spoke to Sarah. Ticket raised for the AD group.');
});
