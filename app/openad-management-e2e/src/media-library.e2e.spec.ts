import { test, expect } from '@playwright/test';

test.describe('Media library (T134)', () => {
  test('media route resolves (login when unauthenticated)', async ({ page }) => {
    await page.goto('/media');
    await expect(page).toHaveURL(/\/(login|media)/, { timeout: 15_000 });
    const onLogin = page.url().includes('/login');
    if (onLogin) {
      await expect(page.getByRole('heading', { name: /^OpenAD$/i })).toBeVisible();
    } else {
      await expect(page.getByRole('heading', { name: /media library/i })).toBeVisible();
    }
  });
});
