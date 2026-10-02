import { test, expect } from '@playwright/test';

/**
 * Fleet map shell: main omits mobile bottom pad on /inventory; map column is a single flex-1 (no spacer strip).
 * Requires E2E_MANAGEMENT_EMAIL / E2E_MANAGEMENT_PASSWORD for authenticated DOM.
 */
test.describe('Fleet map layout (/inventory)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
  });

  test('unauthenticated: /inventory redirects to login', async ({ page }) => {
    await page.goto('/inventory');
    await expect(page).toHaveURL(/\/login/);
  });

  test('authenticated: main has no mobile bottom padding on fleet map; map host fills width', async ({
    page,
  }) => {
    const email = process.env['E2E_MANAGEMENT_EMAIL'];
    const password = process.env['E2E_MANAGEMENT_PASSWORD'];
    test.skip(
      !email || !password,
      'Set E2E_MANAGEMENT_EMAIL and E2E_MANAGEMENT_PASSWORD to assert fleet map DOM.'
    );

    await page.goto('/login');
    await page.locator('#login-email').fill(email!);
    await page.locator('#login-password input').fill(password!);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.goto('/inventory');
    await expect(page).toHaveURL(/\/inventory/);

    const main = page.locator('main');
    await expect(main).toBeVisible();
    const mainClass = await main.evaluate((el) => el.className);
    expect(mainClass).toContain('max-md:pb-0');
    expect(mainClass).not.toContain('max-md:pb-[5.5rem]');

    const fleetHost = page.locator('app-fleet-map-page');
    await expect(fleetHost).toBeVisible();
    const box = await fleetHost.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(400);

    const mapColumn = page.locator('div.fleet-map-host > div.relative.min-h-0.flex-1');
    await expect(mapColumn).toBeVisible();
    const hostH = await page
      .locator('div.fleet-map-host')
      .evaluate((el) => el.getBoundingClientRect().height);
    const colH = await mapColumn.evaluate((el) => el.getBoundingClientRect().height);
    expect(colH).toBeGreaterThan(hostH - 2);

    const statsRow = page
      .locator('app-fleet-map-page')
      .getByText(/Moving.*Idle.*Syncing.*Offline/)
      .locator('xpath=ancestor::div[contains(@class,"absolute")][1]');
    const statsTop = await statsRow.evaluate((el) => el.getBoundingClientRect().top);
    expect(statsTop).toBeGreaterThan(40);
  });
});
