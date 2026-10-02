import { test, expect } from '@playwright/test';

test.describe('Geo zones (005 spatial)', () => {
  test('unauthenticated user is redirected from /geo-zones', async ({ page }) => {
    await page.goto('/geo-zones');
    await expect(page).toHaveURL(/\/login/);
  });

  test('after login, geo zones page shows heading', async ({ page }) => {
    const email = process.env['E2E_MANAGEMENT_EMAIL'];
    const password = process.env['E2E_MANAGEMENT_PASSWORD'];
    test.skip(
      !email || !password,
      'Set E2E_MANAGEMENT_EMAIL and E2E_MANAGEMENT_PASSWORD for full E2E.'
    );

    await page.goto('/login');
    await page.locator('#login-email').fill(email!);
    await page.locator('#login-password input').fill(password!);
    await page.getByRole('button', { name: 'Login' }).click();

    await page.goto('/geo-zones');
    await expect(
      page.getByRole('heading', { name: 'Geo zones' })
    ).toBeVisible();
  });
});
