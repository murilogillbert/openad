import { test, expect } from '@playwright/test';

test.describe('Inventory onboarding (US1)', () => {
  test('unauthenticated user is redirected to login from /inventory', async ({
    page,
  }) => {
    await page.goto('/inventory');
    await expect(page).toHaveURL(/\/login/);
  });

  test('after login, inventory shows Fleet Manager heading', async ({ page }) => {
    const email = process.env['E2E_MANAGEMENT_EMAIL'];
    const password = process.env['E2E_MANAGEMENT_PASSWORD'];
    test.skip(
      !email || !password,
      'Set E2E_MANAGEMENT_EMAIL and E2E_MANAGEMENT_PASSWORD (openad-api must be reachable at environment.apiBaseUrl).'
    );

    await page.goto('/login');
    await page.locator('#login-email').fill(email!);
    await page.locator('#login-password input').fill(password!);
    await page.getByRole('button', { name: 'Login' }).click();

    await page.goto('/inventory');
    await expect(
      page.getByRole('heading', { name: 'Fleet Manager' })
    ).toBeVisible();
  });
});
