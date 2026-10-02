import { test, expect } from '@playwright/test';

test.describe('Proof-of-play reports (US4)', () => {
  test('reports page loads after login; can open campaign selector', async ({
    page,
  }) => {
    const email = process.env['E2E_MANAGEMENT_EMAIL'];
    const password = process.env['E2E_MANAGEMENT_PASSWORD'];
    test.skip(
      !email || !password,
      'Set E2E_MANAGEMENT_EMAIL and E2E_MANAGEMENT_PASSWORD (use finance_analyst, fleet_admin, or super_admin for /reports).'
    );

    await page.goto('/login');
    await page.locator('#login-email').fill(email!);
    await page.locator('#login-password input').fill(password!);
    await page.getByRole('button', { name: 'Login' }).click();

    await page.goto('/reports');
    await expect(
      page.getByRole('heading', { name: 'Reports', exact: true })
    ).toBeVisible();

    await expect(page.getByTestId('reports-campaign-select')).toBeVisible();
    await expect(page.getByTestId('reports-submit')).toBeVisible();
  });
});
