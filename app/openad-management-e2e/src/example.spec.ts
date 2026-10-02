import { test, expect } from '@playwright/test';

test('root resolves to login or dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/(login|dashboard)/);
});
