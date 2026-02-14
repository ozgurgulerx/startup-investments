#!/usr/bin/env node
/**
 * Playwright browser canary for https://buildatlas.net/landscapes
 *
 * Runs in a container with Playwright + Chromium installed (AKS CronJob).
 * Posts to Slack only on failure.
 */

import * as os from 'node:os';
import * as dns from 'node:dns/promises';

const env = (name, def = '') => {
  const v = process.env[name];
  if (v == null) return def;
  const s = String(v).trim();
  return s === '' ? def : s;
};

const STARTED_AT_MS = Date.now();
const relMs = () => Date.now() - STARTED_AT_MS;

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

const timeoutAfter = (ms, label = 'timeout') => new Promise((_, reject) => {
  setTimeout(() => reject(new Error(label)), ms);
});

const summarizeNetworkInterfaces = () => {
  const ifaces = os.networkInterfaces();
  const out = {};

  for (const [name, infos] of Object.entries(ifaces)) {
    if (!Array.isArray(infos)) continue;

    const v4 = [];
    const v6 = [];
    for (const info of infos) {
      if (!info) continue;
      const fam = info.family;
      if (fam === 'IPv4' || fam === 4) v4.push(info.address);
      if (fam === 'IPv6' || fam === 6) v6.push(info.address);
    }

    if (v4.length || v6.length) out[name] = { v4, v6 };
  }

  return out;
};

async function dnsSnapshot(host, timeoutMs) {
  const started = Date.now();
  try {
    const results = await Promise.race([
      dns.lookup(host, { all: true }),
      timeoutAfter(timeoutMs, `dns timeout after ${timeoutMs}ms`),
    ]);
    return {
      ok: true,
      elapsed_ms: Date.now() - started,
      results: Array.isArray(results) ? results.map((r) => ({ address: r.address, family: r.family })) : [],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      elapsed_ms: Date.now() - started,
      error: truncate(msg, 280),
    };
  }
}

async function getNetworkSnapshot({ stage, attempt, error }) {
  const base = safeUrl(BASE_URL);
  const host = base?.hostname || 'buildatlas.net';

  const snapshot = {
    t_ms: relMs(),
    stage,
    attempt,
    error: truncate(error, 260),
    hostname: env('HOSTNAME', ''),
    node: process.versions.node,
    ifaces: summarizeNetworkInterfaces(),
    dns: await dnsSnapshot(host, 1500),
    http: await directFetchLandscapes({ timeoutMs: 5000 }),
  };

  return snapshot;
}

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

const isRetryableGotoError = (message) => {
  const msg = String(message || '');
  return (
    msg.includes('net::ERR_NETWORK_CHANGED')
    || msg.includes('net::ERR_NETWORK_RESET')
  );
};

async function gotoLandscapesWithRetry(page) {
  const maxAttempts = clampInt(env('GOTO_MAX_ATTEMPTS', '3'), 3, 1, 5);
  let loggedNetDiag = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[canary] goto ${TARGET_URL} (attempt ${attempt}/${maxAttempts})`);
      await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = isRetryableGotoError(msg);

      if (retryable && !loggedNetDiag) {
        loggedNetDiag = true;
        try {
          const snap = await getNetworkSnapshot({ stage: 'goto', attempt, error: msg });
          console.warn(`[canary] netdiag: ${JSON.stringify(snap).slice(0, 2600)}`);
        } catch (snapErr) {
          const s = snapErr instanceof Error ? snapErr.message : String(snapErr);
          console.warn(`[canary] netdiag failed: ${truncate(s, 220)}`);
        }
      }

      if (!retryable || attempt === maxAttempts) {
        throw err;
      }
      console.warn(`[canary] retrying goto after: ${truncate(msg, 220)}`);
      await page.waitForTimeout(500 * attempt);
    }
  }
}

async function waitForUiLoadedOrError(page, consoleErrors) {
  const start = Date.now();

  const crashOverlay = page.getByText(/Application error: a client-side exception has occurred/i);
  const headerError = page.locator('.briefing-header p.text-destructive').first();
  const loadedText = page.getByText(/patterns across/i);

  while (Date.now() - start < TIMEOUT_MS) {
    if (await crashOverlay.isVisible().catch(() => false)) {
      return { state: 'crash' };
    }
    if (await headerError.isVisible().catch(() => false)) {
      const text = ((await headerError.textContent().catch(() => '')) || '').trim();
      return { state: 'error', errorText: text };
    }
    if (await loadedText.isVisible().catch(() => false)) {
      return { state: 'loaded' };
    }
    const hasRetryableNetworkError = Array.isArray(consoleErrors)
      && consoleErrors.some((s) => isRetryableGotoError(String(s)));
    if (hasRetryableNetworkError) {
      return { state: 'retry', reason: 'network_changed' };
    }
    await page.waitForTimeout(250);
  }

  return { state: 'timeout' };
}

async function directFetchLandscapes({ timeoutMs } = {}) {
  const url = `${BASE_URL}/api/landscapes?size_by=funding`;
  const effectiveTimeoutMs = clampInt(timeoutMs, Math.min(20000, TIMEOUT_MS), 1000, 60000);

  const controller = new AbortController();
  const started = Date.now();
  const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    const elapsedMs = Date.now() - started;
    let body = '';
    let json = null;
    let isArray = false;

    if (res.ok) {
      json = await res.json().catch(() => null);
      isArray = Array.isArray(json);
    } else {
      body = truncate(await res.text().catch(() => ''), 800);
    }

    return {
      url,
      status: res.status,
      ok: res.ok,
      elapsed_ms: elapsedMs,
      is_array: isArray,
      body,
    };
  } catch (err) {
    const elapsedMs = Date.now() - started;
    const msg = err instanceof Error ? err.message : String(err);
    return {
      url,
      status: 0,
      ok: false,
      elapsed_ms: elapsedMs,
      is_array: false,
      error: truncate(msg, 400),
    };
  } finally {
    clearTimeout(timer);
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
    uiState: null,
    directFetch: null,
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
    const maxUiAttempts = clampInt(env('UI_MAX_ATTEMPTS', '2'), 2, 1, 5);

    for (let uiAttempt = 1; uiAttempt <= maxUiAttempts; uiAttempt++) {
      // Reset per-attempt state so transient failures don't poison later retries.
      pageErrors.length = 0;
      consoleErrors.length = 0;
      requestFailures.length = 0;
      debug.landscapesRequest = null;
      debug.landscapes = null;
      debug.landscapesClusterRequest = null;
      debug.landscapesCluster = null;
      debug.uiState = null;
      debug.directFetch = null;
      debug.uiAttempt = uiAttempt;
      debug.uiMaxAttempts = maxUiAttempts;

      await gotoLandscapesWithRetry(page);

      const heading = page.getByRole('heading', { name: /pattern landscape map/i });
      await heading.waitFor({ timeout: TIMEOUT_MS });

      const crashOverlay = page.getByText(/Application error: a client-side exception has occurred/i);
      if (await crashOverlay.isVisible().catch(() => false)) {
        throw new Error('Detected Next.js client error overlay on /landscapes');
      }

      const uiState = await waitForUiLoadedOrError(page, consoleErrors);
      debug.uiState = uiState;

      const sawRetryableNetworkError = consoleErrors.some((s) => isRetryableGotoError(String(s)))
        || requestFailures.some((f) => isRetryableGotoError(String(f?.failure || '')));

      if (
        (uiState.state === 'retry' || (uiState.state === 'timeout' && sawRetryableNetworkError))
        && uiAttempt < maxUiAttempts
      ) {
        const reason = uiState.state === 'retry' ? 'network_changed' : 'timeout_with_network_changed';
        console.warn(`[canary] retrying UI load after transient network change (${reason}) (${uiAttempt}/${maxUiAttempts})`);
        await page.waitForTimeout(500 * uiAttempt);
        continue;
      }

      // Always do the direct fetch when we aren't immediately retrying so failures include diagnostics.
      const direct = await directFetchLandscapes();
      debug.directFetch = direct;

      if (uiState.state === 'crash') {
        throw new Error('Detected Next.js client error overlay on /landscapes');
      }
      if (uiState.state === 'error') {
        throw new Error(`Landscapes UI error: ${uiState.errorText || 'unknown'}`);
      }
      if (uiState.state !== 'loaded') {
        throw new Error('Timed out waiting for landscapes UI to load');
      }

      if (pageErrors.length) {
        throw new Error(`pageerror: ${pageErrors[0]?.message || String(pageErrors[0])}`);
      }

      if (!direct.ok) {
        const suffix = direct.status ? ` (HTTP ${direct.status})` : '';
        const errText = direct.error ? `: ${direct.error}` : '';
        throw new Error(`Direct fetch /api/landscapes failed${suffix}${errText}`);
      }
      if (!direct.is_array) {
        throw new Error('Direct fetch /api/landscapes returned non-array JSON');
      }

      // If the browser observed a non-2xx response, treat it as a failure.
      if (debug.landscapes && !debug.landscapes.ok) {
        throw new Error(`/api/landscapes HTTP ${debug.landscapes.status}${debug.landscapes.body ? `: ${debug.landscapes.body}` : ''}`);
      }
      if (!debug.landscapesRequest || !debug.landscapes) {
        console.warn('[canary] WARN: did not observe /api/landscapes browser response event (UI loaded + direct fetch OK)');
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
      return { pageErrors, consoleErrors, debug };
    }

    throw new Error('Failed to load /landscapes after retries');
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
    if (typeof debug?.uiAttempt === 'number' && typeof debug?.uiMaxAttempts === 'number') {
      bodyLines.push(`*Attempt:* ${debug.uiAttempt}/${debug.uiMaxAttempts}`);
    }
    if (debug?.uiState) {
      if (debug.uiState.state === 'loaded') bodyLines.push('*UI:* loaded');
      else if (debug.uiState.state === 'error') bodyLines.push(`*UI error:* ${truncate(debug.uiState.errorText || '', 600)}`);
      else bodyLines.push(`*UI:* ${debug.uiState.state}`);
    }
    if (debug?.directFetch) {
      const d = debug.directFetch;
      const base = `*Direct fetch:* \`/api/landscapes\` ${d.ok ? 'OK' : 'FAIL'}${d.status ? ` HTTP ${d.status}` : ''} in ${d.elapsed_ms}ms`;
      bodyLines.push(base);
      if (!d.ok && d.body) bodyLines.push(`*Direct body:* ${truncate(d.body, 600)}`);
      if (!d.ok && d.error) bodyLines.push(`*Direct error:* ${truncate(d.error, 600)}`);
      if (d.ok && d.is_array === false) bodyLines.push('*Direct parse:* non-array JSON');
    }
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
        uiAttempt: typeof debug.uiAttempt === 'number' ? debug.uiAttempt : null,
        uiMaxAttempts: typeof debug.uiMaxAttempts === 'number' ? debug.uiMaxAttempts : null,
        uiState: debug.uiState || null,
        directFetch: debug.directFetch || null,
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
