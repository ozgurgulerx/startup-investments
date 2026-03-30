import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const BASE_URL = process.env.LINKEDIN_EXPORT_BASE_URL || 'http://127.0.0.1:3000';
const SCRIPT_DIR = path.dirname(path.resolve(process.argv[1] || '.'));
const DEFAULT_OUT_DIR = path.resolve(SCRIPT_DIR, '../public/newsletter-assets/march-2026-ai-funding');
const ASSETS = [
  'hero',
  'deal-ladder',
  'stage-tension',
  'capital-flow',
  'market-map',
  'daily-pulse',
  'theme-matrix',
  'theme-rank',
];

function parseArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function waitForFonts(page) {
  await page.evaluate(async () => {
    if ('fonts' in document) {
      await document.fonts.ready;
    }
  });
}

async function exportSingle(page, slug, outDir) {
  const url = `${BASE_URL}/newsletter-assets/march-2026-ai-funding?asset=${slug}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await waitForFonts(page);
  const locator = page.locator(`#artboard-${slug}`);
  await locator.waitFor({ state: 'visible' });
  await page.waitForTimeout(400);
  await locator.screenshot({
    animations: 'disabled',
    path: path.join(outDir, `${slug}.png`),
  });
}

async function main() {
  const outDir = parseArg('--out') || DEFAULT_OUT_DIR;
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  try {
    for (const slug of ASSETS) {
      const page = await browser.newPage({
        viewport: { width: 1680, height: 1400 },
        colorScheme: 'light',
      });
      await exportSingle(page, slug, outDir);
      await page.close();
    }

    const page = await browser.newPage({
      viewport: { width: 1680, height: 6000 },
      colorScheme: 'light',
    });
    await page.goto(`${BASE_URL}/newsletter-assets/march-2026-ai-funding?asset=all`, {
      waitUntil: 'networkidle',
    });
    await waitForFonts(page);
    const locator = page.locator('#artboard-collection');
    await locator.waitFor({ state: 'visible' });
    await page.waitForTimeout(500);
    await locator.screenshot({
      animations: 'disabled',
      path: path.join(outDir, 'all-artboards.png'),
    });
    await page.close();
  } finally {
    await browser.close();
  }

  console.log(`Exported assets to ${outDir}`);
}

await main();
