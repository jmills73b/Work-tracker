import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

// The settings round trip, and the honest "not set up" state: the local Worker has no
// VAPID secret, exactly like a fresh deployment before its first ensure-vapid run.
test('reminder settings save, survive a reload, and the screen says when push is not set up', async ({ page }) => {
  await signIn(page);
  await page.locator('#user-button').click();
  await page.getByRole('menuitem', { name: 'Reminders' }).click();
  await expect(page.locator('#reminders-status')).toHaveText('Reminders are not set up on the server yet.');
  await expect(page.locator('#push-enable')).toBeDisabled();

  const form = page.locator('#reminders-form');
  // The default is three a day: 07:30, 10:00 and 20:00.
  await expect(form.locator('[name=digest_time_1]')).toHaveValue('07:30');
  await expect(form.locator('[name=digest_time_2]')).toHaveValue('10:00');
  await expect(form.locator('[name=digest_time_3]')).toHaveValue('20:00');
  // Change one, drop one.
  await form.locator('[name=digest_time_1]').fill('08:30');
  await form.locator('[name=digest_time_2]').fill('');
  await form.locator('[name=include_tomorrow]').uncheck();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast').last()).toHaveText('Reminder settings saved');

  await page.reload();
  await page.locator('#user-button').click();
  await page.getByRole('menuitem', { name: 'Reminders' }).click();
  await expect(form.locator('[name=digest_time_1]')).toHaveValue('08:30');
  await expect(form.locator('[name=digest_time_2]')).toHaveValue('20:00');
  await expect(form.locator('[name=digest_time_3]')).toHaveValue('');
  await expect(form.locator('[name=include_tomorrow]')).not.toBeChecked();
  await expect(form.locator('[name=enabled]')).toBeChecked();
});
