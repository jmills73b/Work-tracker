import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

// Teams are labels anyone can add: from the Teams screen or straight from a task's team
// picker. Each feeds the filter, the task form and quick add, and the filter narrows
// every view: wiring only a browser exercises.
test('teams are added from the menu or inline, and the team filter narrows the views', async ({ page }) => {
  await signIn(page);

  await page.locator('#user-button').click();
  await page.getByRole('menuitem', { name: 'Teams' }).click();
  const dialog = page.locator('#teams-dialog');
  const teamNames = () => dialog.locator('.team-name').evaluateAll((inputs) => inputs.map((i) => i.value));
  await expect.poll(teamNames).toEqual(expect.arrayContaining(['Dev Ops', 'RDH', 'GDS']));
  await dialog.locator('[name=name]').fill('Platform');
  await dialog.getByRole('button', { name: 'Add team' }).click();
  await expect.poll(teamNames).toContain('Platform');
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

  // A new team straight from the task: "New team…" in its picker.
  await page.locator('.row', { hasText: 'Unteamed chore' }).click();
  await page.locator('#task-summary').click();
  page.once('dialog', (d) => d.accept('Facilities'));
  await page.locator('#task-form [name=team_id]').selectOption('__new');
  await expect(page.locator('#task-summary')).toContainText('Facilities');
  await expect(page.locator('#timeline')).toContainText('Team');
  await page.keyboard.press('Escape');
  await expect(page.locator('.row', { hasText: 'Unteamed chore' }).locator('.tag')).toHaveText('Facilities');

  await page.locator('#team-filter').selectOption({ label: 'Platform' });
  await expect(page.locator('.row')).toHaveCount(1);
  await expect(page.locator('.row')).toContainText('Rotate certificates');
  await expect(page.locator('.row .tag')).toHaveText('Platform');
  await page.locator('#view-toggle button[data-view="review"]').click();
  await expect(page.locator('.review > .hint')).toHaveText('For Platform. The team filter narrows this.');

  // The choice is remembered across a reload.
  await page.reload();
  await expect(page.locator('#team-filter')).toHaveValue(/^\d+$/);
  await page.locator('#team-filter').selectOption('all');
});
