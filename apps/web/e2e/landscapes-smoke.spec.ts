import { test, expect } from '@playwright/test';

test('landscapes loads without client-side exception', async ({ page }) => {
  await page.goto('/landscapes');

  await expect(page.getByRole('heading', { name: /pattern landscape map/i })).toBeVisible();

  // Wait for data-driven summary (proves the client fetch completed).
  await expect(page.getByText(/patterns across/i)).toBeVisible();

  // Next.js client crash page (what we saw on prod).
  await expect(
    page.getByText(/Application error: a client-side exception has occurred/i)
  ).toHaveCount(0);

  // Click a large treemap tile to ensure the detail panel can load.
  const agenticTile = page.locator('svg text').filter({ hasText: /agentic/i }).first();
  await expect(agenticTile).toBeVisible();
  await agenticTile.click();

  await expect(page.getByText(/top startups/i)).toBeVisible();
});

