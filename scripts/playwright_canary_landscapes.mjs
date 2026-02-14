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

const safeUrl = (raw) => {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
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
  const requestFailures = [];

  const debug = {
    landscapesRequest: null,
    landscapes: null,
    landscapesClusterRequest: null,
    landscapesCluster: null,
    requestFailures,
    pageErrors,
    consoleErrors,
  };

  page.on('pageerror', (err) => pageErrors.push(err));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('request', (req) => {
    const u = safeUrl(req.url());
    if (!u) return;
    if (u.origin !== BASE_URL) return;
    if (u.pathname === '/api/landscapes' && !debug.landscapesRequest) {
      debug.landscapesRequest = { url: req.url(), method: req.method() };
    }
    if (u.pathname === '/api/landscapes/cluster' && !debug.landscapesClusterRequest) {
      debug.landscapesClusterRequest = { url: req.url(), method: req.method() };
    }
  });
  page.on('requestfailed', (req) => {
    const u = safeUrl(req.url());
    if (!u) return;
    if (u.origin !== BASE_URL) return;
    if (u.pathname !== '/api/landscapes' && u.pathname !== '/api/landscapes/cluster') return;
    requestFailures.push({
      url: req.url(),
      method: req.method(),
      failure: req.failure()?.errorText || 'request failed',
    });
  });

  page.on('response', async (res) => {
    const u = safeUrl(res.url());
    if (!u) return;
    if (u.origin !== BASE_URL) return;
    if (u.pathname !== '/api/landscapes' && u.pathname !== '/api/landscapes/cluster') return;

    // Only pull bodies for non-2xx responses to keep logs small.
    let body = '';
    if (!res.ok()) {
      try {
        body = truncate(await res.text(), 800);
      } catch {
        body = '';
      }
    }

    const entry = {
      url: res.url(),
      status: res.status(),
      ok: res.ok(),
      body,
    };
    if (u.pathname === '/api/landscapes') debug.landscapes = entry;
    if (u.pathname === '/api/landscapes/cluster') debug.landscapesCluster = entry;
  });

  try {
    const waitForLandscapesApi = page
      .waitForResponse((res) => {
        const u = safeUrl(res.url());
        if (!u) return false;
        return u.origin === BASE_URL && u.pathname === '/api/landscapes';
      }, { timeout: TIMEOUT_MS })
      .catch(() => null);

    console.log(`[canary] goto ${TARGET_URL}`);
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });

    const heading = page.getByRole('heading', { name: /pattern landscape map/i });
    await heading.waitFor({ timeout: TIMEOUT_MS });

    const landscapesRes = await waitForLandscapesApi;
    if (!landscapesRes) {
      throw new Error('Timed out waiting for /api/landscapes response');
    }
    debug.landscapes = debug.landscapes || {
      url: landscapesRes.url(),
      status: landscapesRes.status(),
      ok: landscapesRes.ok(),
      body: '',
    };
    if (!landscapesRes.ok()) {
      const body = truncate(await landscapesRes.text().catch(() => ''), 800);
      throw new Error(`/api/landscapes HTTP ${landscapesRes.status()}${body ? `: ${body}` : ''}`);
    }

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
  } catch (err) {
    if (err && typeof err === 'object') {
      err.debug = debug;
    }
    throw err;
  } finally {
    await browser.close().catch(() => {});
  }

  return { pageErrors, consoleErrors, debug };
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
    const debug = err && typeof err === 'object' ? err.debug : null;

    const bodyLines = [
      `*Target:* ${TARGET_URL}`,
      `*Error:* ${truncate(msg, 600)}`,
    ];
    if (debug?.landscapesRequest) {
      bodyLines.push(`*API request:* ${debug.landscapesRequest.method} ${debug.landscapesRequest.url}`);
    }
    if (debug?.landscapes) {
      const s = debug.landscapes;
      bodyLines.push(`*API:* \`/api/landscapes\` HTTP ${s.status}${s.ok ? '' : ' (not ok)'}`);
      if (s.body) bodyLines.push(`*API body:* ${truncate(s.body, 600)}`);
    }
    if (Array.isArray(debug?.requestFailures) && debug.requestFailures.length) {
      const head = debug.requestFailures.slice(0, 3)
        .map((f) => `- ${f.method} ${f.url}: ${truncate(f.failure, 120)}`)
        .join('\n');
      bodyLines.push(`*Request failures:*\n${head}`);
    }
    if (Array.isArray(debug?.consoleErrors) && debug.consoleErrors.length) {
      const head = debug.consoleErrors.slice(0, 3).map((s) => `- ${truncate(s, 220)}`).join('\n');
      bodyLines.push(`*Console errors:*\n${head}`);
    }

    // Also print a compact debug snapshot to logs for post-mortems (Slack might be unreachable).
    try {
      const dbg = debug && typeof debug === 'object' ? {
        landscapesRequest: debug.landscapesRequest || null,
        landscapes: debug.landscapes || null,
        requestFailures: Array.isArray(debug.requestFailures) ? debug.requestFailures.slice(0, 3) : [],
        consoleErrors: Array.isArray(debug.consoleErrors) ? debug.consoleErrors.slice(0, 3) : [],
      } : null;
      if (dbg) console.error(`[canary] debug: ${JSON.stringify(dbg).slice(0, 1200)}`);
    } catch {
      // ignore
    }

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
