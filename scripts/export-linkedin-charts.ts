/**
 * Export LinkedIn chart PNGs from the newsletter LinkedIn export page.
 *
 * Usage:
 *   npx playwright install chromium   # once
 *   npx tsx scripts/export-linkedin-charts.ts [period]
 *
 * Requires the dev server running: pnpm dev (port 3000)
 */

import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const period = process.argv[2] || '2026-02';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const OUTPUT_DIR = path.join(
  process.cwd(),
  'apps',
  'web',
  'data',
  period,
  'output',
  'linkedin'
);

const CHARTS = [
  { name: 'cover', width: 1920, height: 1080 },
  { name: 'capital-treemap' },
  { name: 'big5-bar' },
  { name: 'trend-radar' },
  { name: 'funding-funnel' },
  { name: 'sankey-diagram' },
  { name: 'geography-bar' },
  { name: 'genai-intensity' },
];

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch();

  for (const chart of CHARTS) {
    const isCover = chart.name === 'cover';
    const viewportWidth = isCover ? 1920 : 1200;
    const viewportHeight = isCover ? 1080 : 900;

    const context = await browser.newContext({
      viewport: { width: viewportWidth, height: viewportHeight },
      deviceScaleFactor: isCover ? 1 : 2,
    });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/newsletter/${period}/linkedin`, {
      waitUntil: 'networkidle',
    });

    // Wait for charts to render (SVGs inside the sections)
    await page.waitForTimeout(2000);

    const section = page.locator(`[data-chart="${chart.name}"]`);
    const count = await section.count();
    if (count === 0) {
      console.warn(`  [SKIP] No section found for data-chart="${chart.name}"`);
      await context.close();
      continue;
    }

    const outPath = path.join(OUTPUT_DIR, `${chart.name}.png`);
    await section.screenshot({ path: outPath, type: 'png' });

    const stats = fs.statSync(outPath);
    console.log(`  [OK] ${chart.name}.png (${(stats.size / 1024).toFixed(0)} KB)`);

    await context.close();
  }

  await browser.close();
  console.log(`\nDone. ${CHARTS.length} PNGs saved to ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
