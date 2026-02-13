import { test, expect } from '@playwright/test';

const TR_SIGNAL_ID = '22222222-2222-2222-2222-222222222222';

test('signals deep-dive links preserve region context (turkey)', async ({ page }) => {
  await page.goto('/signals?region=turkey');

  const deepDiveLink = page
    .locator('a[href^="/signals/"]')
    .filter({ hasText: /deep dive|derin inceleme/i })
    .first();

  await expect(deepDiveLink).toBeVisible();
  await expect(deepDiveLink).toHaveAttribute('href', /region=turkey/);

  await Promise.all([
    page.waitForURL(/\/signals\/[0-9a-f-]+\?region=turkey/i),
    deepDiveLink.click(),
  ]);

  await expect(page.locator('a[href=\"/signals?region=turkey\"]').first()).toBeVisible();

  const companyLinks = page.locator('a[href^=\"/company/\"]');
  await expect(companyLinks.first()).toBeVisible();

  const n = await companyLinks.count();
  for (let i = 0; i < n; i++) {
    const href = await companyLinks.nth(i).getAttribute('href');
    expect(href).toBeTruthy();
    expect(href!).toContain('region=turkey');
  }
});

test('signals relevance proxy route is operational', async ({ request }) => {
  const res = await request.get(
    `/api/signals/${TR_SIGNAL_ID}/relevance?region=turkey&window_days=90&limit=5`
  );

  expect(res.ok()).toBeTruthy();

  const json = await res.json() as any;
  expect(json.signal_id).toBe(TR_SIGNAL_ID);
  expect(Array.isArray(json.relevant_rounds)).toBeTruthy();
  expect(Array.isArray(json.related_patterns)).toBeTruthy();
  expect(Array.isArray(json.related_signals)).toBeTruthy();
});

