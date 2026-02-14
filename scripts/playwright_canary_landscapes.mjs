#!/usr/bin/env node
/**
 * Playwright browser canary for https://buildatlas.net/landscapes
 *
 * Runs in a container with Playwright + Chromium installed (AKS CronJob).
 * Posts to Slack only on failure.
 */

const env = (name, def = '') => {
  const v = process.env[name];
  if (v == null) return def;
  const s = String(v).trim();
  return s === '' ? def : s;
};

const clampInt = (raw, def, lo, hi) => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  if (i < lo) return lo;
  if (i > hi) return hi;
  return i;
};

const truncate = (s, max) => {
  const str = String(s ?? '');
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
};

const BASE_URL = env('BASE_URL', 'https://buildatlas.net').replace(/\/+$/, '');
const LANDSCAPES_PATH = env('LANDSCAPES_PATH', '/landscapes');
const TARGET_URL = `${BASE_URL}${LANDSCAPES_PATH.startsWith('/') ? '' : '/'}${LANDSCAPES_PATH}`;

const TIMEOUT_MS = clampInt(env('TIMEOUT_MS', '45000'), 45000, 5000, 300000);
const DETAIL_TIMEOUT_MS = clampInt(env('DETAIL_TIMEOUT_MS', '25000'), 25000, 2000, 120000);

const SLACK_WEBHOOK_URL = env('SLACK_WEBHOOK_URL') || env('SLACK_WEBHOOK');
const SLACK_MENTION = env('SLACK_MENTION'); // optional e.g. "<!here>"

const statusEmoji = (status) => {
  const s = String(status || '').toLowerCase();
  if (s === 'failure' || s === 'failed' || s === 'error') return '❌';
  if (s === 'warning' || s === 'warn') return '⚠️';
  if (s === 'success' || s === 'ok') return '✅';
  return 'ℹ️';
};

async function slackPost({ title, status, body, url }) {
  if (!SLACK_WEBHOOK_URL) return;

  const text = [SLACK_MENTION, body].filter(Boolean).join('\n');
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${statusEmoji(status)} ${title}`, emoji: true },
    },
    ...(text.trim()
      ? [{ type: 'section', text: { type: 'mrkdwn', text: truncate(text, 2900) } }]
      : []),
    ...(url
      ? [
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Open', emoji: true },
                url,
              },
            ],
          },
        ]
      : []),
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `*At:* ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC` }],
    },
  ];

  const payload = JSON.stringify({ blocks });
  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: payload,
  });
  if (!res.ok) {
    throw new Error(`Slack webhook HTTP ${res.status}`);
  }
}

async function run() {
  const { chromium } = await import('playwright');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox'],
  });

  const page = await browser.newPage();

  const pageErrors = [];
  const consoleErrors = [];

  page.on('pageerror', (err) => pageErrors.push(err));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  try {
    console.log(`[canary] goto ${TARGET_URL}`);
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });

    const heading = page.getByRole('heading', { name: /pattern landscape map/i });
    await heading.waitFor({ timeout: TIMEOUT_MS });

    // Proves the data fetch completed (not just static HTML).
    await page.getByText(/patterns across/i).waitFor({ timeout: TIMEOUT_MS });

    const crashOverlay = page.getByText(/Application error: a client-side exception has occurred/i);
    if (await crashOverlay.isVisible().catch(() => false)) {
      throw new Error('Detected Next.js client error overlay on /landscapes');
    }

    if (pageErrors.length) {
      throw new Error(`pageerror: ${pageErrors[0]?.message || String(pageErrors[0])}`);
    }

    // Best-effort click a visible label to ensure the detail panel can render.
    const labelCandidates = [/agentic/i, /rag/i, /data moat/i, /micro-model/i];
    for (const re of labelCandidates) {
      const label = page.locator('svg text').filter({ hasText: re }).first();
      if ((await label.count()) > 0) {
        console.log(`[canary] click label ${re}`);
        await label.click({ timeout: 5000 });
        await page.getByText(/top startups/i).waitFor({ timeout: DETAIL_TIMEOUT_MS });
        break;
      }
    }

    if (await crashOverlay.isVisible().catch(() => false)) {
      throw new Error('Detected Next.js client error overlay after interaction');
    }
    if (pageErrors.length) {
      throw new Error(`pageerror: ${pageErrors[0]?.message || String(pageErrors[0])}`);
    }

    console.log('[canary] OK');
  } finally {
    await browser.close().catch(() => {});
  }

  return { pageErrors, consoleErrors };
}

async function main() {
  try {
    const { consoleErrors } = await run();
    if (consoleErrors.length) {
      // Console errors can be noisy; log but do not fail the canary by default.
      console.log(`[canary] console.error count=${consoleErrors.length}`);
    }
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const bodyLines = [
      `*Target:* ${TARGET_URL}`,
      `*Error:* ${truncate(msg, 600)}`,
    ];

    console.error(`[canary] FAIL: ${msg}`);
    try {
      await slackPost({
        title: 'Browser Canary FAIL: /landscapes',
        status: 'failure',
        body: bodyLines.join('\n'),
        url: TARGET_URL,
      });
    } catch (slackErr) {
      const s = slackErr instanceof Error ? slackErr.message : String(slackErr);
      console.error(`[canary] Slack post failed: ${s}`);
    }
    process.exit(1);
  }
}

// eslint-disable-next-line no-void
void main();

