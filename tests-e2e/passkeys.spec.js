import { expect, test } from '@playwright/test';
import { ACCOUNT, signIn } from './helpers.js';

// A real WebAuthn ceremony: Chromium's virtual authenticator stands in for Face ID
// (user verification always succeeds), and the Worker verifies with the real library.
test('add a passkey with your password, sign out, sign in with it; removed, it no longer works', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });

  await signIn(page);
  await page.locator('#user-button').click();
  await page.getByRole('menuitem', { name: 'Face ID & passkeys' }).click();
  const dialog = page.locator('#passkeys-dialog');
  await expect(dialog.locator('#passkey-list')).toContainText('No passkeys yet');

  // The password is required, and a wrong one is refused.
  await dialog.locator('[name=password]').fill('not-my-password');
  await dialog.getByRole('button', { name: 'Add this device' }).click();
  await expect(dialog.locator('#passkeys-error')).toHaveText('Password is incorrect');

  await dialog.locator('[name=password]').fill(ACCOUNT.password);
  await dialog.getByRole('button', { name: 'Add this device' }).click();
  await expect(dialog.locator('.passkey-item')).toHaveCount(1);
  await expect(dialog.locator('.passkey-item')).toContainText('not used yet');
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Sign out, then sign in with no email or password.
  await page.locator('#user-button').click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL((u) => u.pathname === '/login');
  await page.getByRole('button', { name: 'Use Face ID or a passkey' }).click();
  await page.waitForURL((u) => u.pathname === '/');
  await expect(page.locator('#user-name')).toHaveText(ACCOUNT.name);

  // It now shows as used; remove it.
  await page.locator('#user-button').click();
  await page.getByRole('menuitem', { name: 'Face ID & passkeys' }).click();
  await expect(dialog.locator('.passkey-item')).toContainText('last used');
  page.once('dialog', (d) => d.accept());
  await dialog.getByRole('button', { name: /Remove passkey/ }).click();
  await expect(dialog.locator('#passkey-list')).toContainText('No passkeys yet');
  await dialog.getByRole('button', { name: 'Close' }).click();

  // The device still holds the key, but the site has forgotten it.
  await page.locator('#user-button').click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL((u) => u.pathname === '/login');
  await page.getByRole('button', { name: 'Use Face ID or a passkey' }).click();
  await expect(page.locator('#passkey-error')).toContainText("isn't set up for this site");
  expect(new URL(page.url()).pathname).toBe('/login');
});
