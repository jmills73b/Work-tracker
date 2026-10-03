import { expect } from '@playwright/test';

export const ACCOUNT = { name: 'E2E Tester', email: 'e2e@example.com', password: 'e2e-password-123' };

// Only one registration can succeed per run: the first account needs no invite code and
// the state directory is wiped before each run. So try to sign in, and register only if
// that fails. Whichever spec runs first creates the account; the rest sign in.
//
// It waits on a real outcome, never a timeout: sign-in is deliberately slow (100,000
// PBKDF2 iterations), and treating that delay as "no account yet" would register twice.
export async function signIn(page) {
  await page.goto('/login');
  await page.locator('#login-form [name=email]').fill(ACCOUNT.email);
  await page.locator('#login-form [name=password]').fill(ACCOUNT.password);
  await page.locator('#login-form button[type=submit]').click();

  const outcome = await Promise.race([
    page.waitForURL((url) => url.pathname === '/').then(() => 'signed-in'),
    page.locator('#login-error').waitFor({ state: 'visible' }).then(() => 'error'),
  ]);
  if (outcome === 'signed-in') return;

  await page.locator('#show-register').click();
  const form = page.locator('#register-form');
  await form.locator('[name=name]').fill(ACCOUNT.name);
  await form.locator('[name=email]').fill(ACCOUNT.email);
  await form.locator('[name=password]').fill(ACCOUNT.password);
  await form.locator('[name=confirm_password]').fill(ACCOUNT.password);
  await form.locator('button[type=submit]').click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.locator('#user-name')).toHaveText(ACCOUNT.name);
}

// The + button opens quick add; "Add details…" goes on to the full form.
export async function openTaskForm(page) {
  await page.locator('#new-task').click();
  await page.locator('#quick-details').click();
  await expect(page.locator('#drawer')).toBeVisible();
}
