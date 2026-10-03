import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

// Admin team management feeds three places at once (the filter, the task form and quick
// add), and the filter narrows both views: wiring only a browser exercises.
test('an admin adds a team, and the team filter narrows both the list and the board', async ({ page }) => {
  await signIn(page);

  await page.locator('#user-button').click();
  await page.getByRole('menuitem', { name: 'Teams' }).click();
  const dialog = page.locator('#teams-dialog');
  const teamNames = () => dialog.locator('.team-name').evaluateAll((inputs) => inputs.map((i) => i.value));
  await expect.poll(teamNames).toEqual(['Dev Ops', 'RDH', 'GDS']);
  await dialog.locator('[name=name]').fill('Platform');
  await dialog.getByRole('button', { name: 'Add team' }).click();
  await expect.poll(teamNames).toEqual(['Dev Ops', 'RDH', 'GDS', 'Platform']);
  await dialog.locator('[name=name]').fill('platform');
  await dialog.getByRole('button', { name: 'Add team' }).click();
  await expect(page.locator('#teams-error')).toHaveText('There is already a team with that name');
  await dialog.getByRole('button', { name: 'Done' }).click();

  for (const line of ['Rotate certificates #platform', 'Quarterly review #GDS', 'Unteamed chore']) {
    await page.keyboard.press('n');
    await page.locator('#quick-input').fill(line);
    await page.locator('#quick-input').press('Enter');
    await expect(page.locator('#quick-dialog')).toBeHidden();
  }

  await page.locator('#team-filter').selectOption({ label: 'Platform' });
  await expect(page.locator('.row')).toHaveCount(1);
  await expect(page.locator('.row')).toContainText('Rotate certificates');
  await expect(page.locator('.row .tag')).toHaveText('Platform');

  await page.getByRole('button', { name: 'Board' }).click();
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.card')).toContainText('Rotate certificates');

  await page.locator('#team-filter').selectOption({ label: 'No team' });
  await expect(page.locator('.card', { hasText: 'Unteamed chore' })).toBeVisible();
  await expect(page.locator('.card', { hasText: 'Rotate certificates' })).toHaveCount(0);

  // The choice is remembered across a reload.
  await page.reload();
  await expect(page.locator('#team-filter')).toHaveValue('none');
  await page.locator('#team-filter').selectOption('all');
  await page.getByRole('button', { name: 'List' }).click();
});
