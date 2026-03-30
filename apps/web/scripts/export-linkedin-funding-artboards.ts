import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { LINKEDIN_ASSETS } from '../lib/linkedin-funding-pack';

const BASE_URL = process.env.LINKEDIN_EXPORT_BASE_URL || 'http://127.0.0.1:3000';
const SCRIPT_DIR = path.dirname(path.resolve(process.argv[1] || '.'));
const DEFAULT_OUT_DIR = path.resolve(SCRIPT_DIR, '../public/newsletter-assets/march-2026-ai-funding');

function parseArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function waitForFonts(page: Awaited<ReturnType<typeof chromium.launch>> extends never ? never : any) {
  await page.evaluate(async () => {
    if ('fonts' in document) {
      await (document as Document & { fonts: FontFaceSet }).fonts.ready;
    }
  });
}

async function main() {
  const outDir = parseArg('--out') || DEFAULT_OUT_DIR;
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  try {
    for (const asset of LINKEDIN_ASSETS) {
      const page = await browser.newPage({
        viewport: { width: 1680, height: 1400 },
        colorScheme: 'light',
      });

      const url = `${BASE_URL}/newsletter-assets/march-2026-ai-funding?asset=${asset.slug}`;
      await page.goto(url, { waitUntil: 'networkidle' });
      await waitForFonts(page);
      const selector = `#artboard-${asset.slug}`;
      const locator = page.locator(selector);
      await locator.waitFor({ state: 'visible' });
      await page.waitForTimeout(400);
      await locator.screenshot({
        animations: 'disabled',
        path: path.join(outDir, `${asset.slug}.png`),
      });
      await page.close();
    }

    const allPage = await browser.newPage({
      viewport: { width: 1680, height: 6000 },
      colorScheme: 'light',
    });
    await allPage.goto(`${BASE_URL}/newsletter-assets/march-2026-ai-funding?asset=all`, {
      waitUntil: 'networkidle',
    });
    await waitForFonts(allPage);
    const collection = allPage.locator('#artboard-collection');
    await collection.waitFor({ state: 'visible' });
    await allPage.waitForTimeout(500);
    await collection.screenshot({
      animations: 'disabled',
      path: path.join(outDir, 'all-artboards.png'),
    });
    await allPage.close();
  } finally {
    await browser.close();
  }

  // eslint-disable-next-line no-console
  console.log(`Exported assets to ${outDir}`);
}

void main();
