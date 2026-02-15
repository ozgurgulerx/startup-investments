import { test, expect } from '@playwright/test';

test('news nav shows region toggle on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  // Use a static marketing page so the test doesn't depend on news ingest/data.
  await page.goto('/methodology');

  await expect(page.getByRole('link', { name: 'Global' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Turkey' }).first()).toBeVisible();
});

