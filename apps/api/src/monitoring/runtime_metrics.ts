import type { Request, RequestHandler, Response } from 'express';

type StatusClass = '2xx' | '3xx' | '4xx' | '5xx';

export interface RuntimeMetricsSnapshot {
  timestamp: string;
  window_min: number;
  requests: {
    total: number;
    status: Record<StatusClass, number>;
    p95_ms: number;
    p99_ms: number;
    by_route_group: Array<{
      key: string;
      count: number;
      err_5xx: number;
      p95_ms: number;
    }>;
  };
}

const MAX_WINDOW_MIN = 15;
const MAX_ROUTES_PER_MINUTE = 80;
const OTHER_ROUTE_KEY = 'other';
const LATENCY_BUCKETS_MS = [50, 100, 250, 500, 1000, 2000, 5000, 10000] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_LONG_RE = /^[0-9a-f]{32,}$/i;

function minuteEpoch(tsMs: number): number {
  return Math.floor(tsMs / 60000);
}

function statusClass(code: number): StatusClass {
  if (code >= 500) return '5xx';
  if (code >= 400) return '4xx';
  if (code >= 300) return '3xx';
  return '2xx';
}

function bucketIndexForMs(ms: number): number {
  const value = Math.max(0, Number.isFinite(ms) ? ms : 0);
  for (let i = 0; i < LATENCY_BUCKETS_MS.length; i++) {
    if (value <= LATENCY_BUCKETS_MS[i]) return i;
  }
  return LATENCY_BUCKETS_MS.length; // overflow
}

function histogramQuantileMs(counts: number[], q: number): number {
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (total <= 0) return 0;
  const target = Math.max(1, Math.ceil(total * q));
  let cumulative = 0;
  for (let i = 0; i < counts.length; i++) {
    cumulative += counts[i];
    if (cumulative >= target) {
      if (i < LATENCY_BUCKETS_MS.length) return LATENCY_BUCKETS_MS[i];
      return LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1];
    }
  }
  return LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1];
}

function stringifyRoutePath(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof RegExp) return value.toString();
  if (Array.isArray(value)) return value.map(stringifyRoutePath).filter(Boolean).join('|');
  return String(value);
}

function normalizePath(raw: string): string {
  const cleaned = String(raw || '').split('?')[0];
  const parts = cleaned.split('/').filter(Boolean);
  const normalized = parts.map((seg) => {
    if (UUID_RE.test(seg)) return ':uuid';
    if (/^\d+$/.test(seg)) return ':n';
    if (HEX_LONG_RE.test(seg)) return ':hash';
    if (seg.length > 24 && /^[a-z0-9_-]+$/i.test(seg)) return ':id';
    return seg;
  });
  return '/' + normalized.join('/');
}

function requestPath(req: Request): string {
  return String(req.path || '').trim() || String(req.originalUrl || '').split('?')[0] || '';
}

function shouldIgnorePath(path: string): boolean {
  if (!path) return true;
  if (path === '/health' || path === '/healthz' || path === '/readyz') return true;
  // Avoid self-skew from monitoring calls.
  if (path.startsWith('/api/admin/monitoring')) return true;
  return false;
}

function routeGroupKey(req: Request): string {
  const method = String(req.method || 'GET').toUpperCase();
  const routePathRaw = stringifyRoutePath((req as any).route?.path);
  if (routePathRaw) {
    const base = String(req.baseUrl || '');
    return `${method} ${base}${routePathRaw}`;
  }
  const path = requestPath(req);
  return `${method} ${normalizePath(path)}`;
}

type LatencyCounts = number[]; // length: LATENCY_BUCKETS_MS.length + 1 (overflow)

interface RouteBucket {
  count: number;
  err5xx: number;
  latency: LatencyCounts;
}

interface MinuteBucket {
  minute: number;
  total: number;
  status: Record<StatusClass, number>;
  latency: LatencyCounts;
  routes: Map<string, RouteBucket>;
}

function emptyLatencyCounts(): LatencyCounts {
  return new Array(LATENCY_BUCKETS_MS.length + 1).fill(0);
}

class RuntimeMetricsStore {
  private buckets: Map<number, MinuteBucket> = new Map();

  record(params: { routeKey: string; statusCode: number; durationMs: number }) {
    const now = Date.now();
    const minute = minuteEpoch(now);
    const cls = statusClass(params.statusCode);

    let bucket = this.buckets.get(minute);
    if (!bucket) {
      bucket = {
        minute,
        total: 0,
        status: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
        latency: emptyLatencyCounts(),
        routes: new Map(),
      };
      this.buckets.set(minute, bucket);
    }

    bucket.total += 1;
    bucket.status[cls] += 1;

    const idx = bucketIndexForMs(params.durationMs);
    bucket.latency[idx] += 1;

    const key = params.routeKey || OTHER_ROUTE_KEY;
    let route = bucket.routes.get(key);
    if (!route) {
      if (bucket.routes.size >= MAX_ROUTES_PER_MINUTE) {
        route = bucket.routes.get(OTHER_ROUTE_KEY);
        if (!route) {
          route = { count: 0, err5xx: 0, latency: emptyLatencyCounts() };
          bucket.routes.set(OTHER_ROUTE_KEY, route);
        }
      } else {
        route = { count: 0, err5xx: 0, latency: emptyLatencyCounts() };
        bucket.routes.set(key, route);
      }
    }

    route.count += 1;
    if (cls === '5xx') route.err5xx += 1;
    route.latency[idx] += 1;

    this.prune(minute);
  }

  snapshot(windowMin: number): RuntimeMetricsSnapshot {
    const window = Math.max(1, Math.min(MAX_WINDOW_MIN, Math.floor(windowMin || 10)));
    const nowMinute = minuteEpoch(Date.now());
    const start = nowMinute - window + 1;

    const statusTotals: Record<StatusClass, number> = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
    const latencyTotals = emptyLatencyCounts();
    let total = 0;

    const routeAgg = new Map<string, { count: number; err5xx: number; latency: LatencyCounts }>();

    for (let m = start; m <= nowMinute; m++) {
      const bucket = this.buckets.get(m);
      if (!bucket) continue;

      total += bucket.total;
      statusTotals['2xx'] += bucket.status['2xx'];
      statusTotals['3xx'] += bucket.status['3xx'];
      statusTotals['4xx'] += bucket.status['4xx'];
      statusTotals['5xx'] += bucket.status['5xx'];

      for (let i = 0; i < latencyTotals.length; i++) {
        latencyTotals[i] += bucket.latency[i] || 0;
      }

      for (const [key, route] of bucket.routes.entries()) {
        const current = routeAgg.get(key) || { count: 0, err5xx: 0, latency: emptyLatencyCounts() };
        current.count += route.count;
        current.err5xx += route.err5xx;
        for (let i = 0; i < current.latency.length; i++) {
          current.latency[i] += route.latency[i] || 0;
        }
        routeAgg.set(key, current);
      }
    }

    const byRoute = Array.from(routeAgg.entries())
      .map(([key, agg]) => ({
        key,
        count: agg.count,
        err_5xx: agg.err5xx,
        p95_ms: histogramQuantileMs(agg.latency, 0.95),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);

    return {
      timestamp: new Date().toISOString(),
      window_min: window,
      requests: {
        total,
        status: statusTotals,
        p95_ms: histogramQuantileMs(latencyTotals, 0.95),
        p99_ms: histogramQuantileMs(latencyTotals, 0.99),
        by_route_group: byRoute,
      },
    };
  }

  private prune(nowMinute: number) {
    const minAllowed = nowMinute - MAX_WINDOW_MIN;
    for (const key of this.buckets.keys()) {
      if (key < minAllowed) this.buckets.delete(key);
    }
  }
}

const STORE = new RuntimeMetricsStore();

export function runtimeMetricsMiddleware(): RequestHandler {
  return (req: Request, res: Response, next) => {
    try {
      const path = requestPath(req);
      if (shouldIgnorePath(path)) return next();
      const startNs = process.hrtime.bigint();
      res.on('finish', () => {
        try {
          const endNs = process.hrtime.bigint();
          const durationMs = Number(endNs - startNs) / 1e6;
          STORE.record({
            routeKey: routeGroupKey(req),
            statusCode: res.statusCode || 0,
            durationMs,
          });
        } catch {
          // Metrics collection is best-effort and must never impact requests.
        }
      });
    } catch {
      // noop
    }
    next();
  };
}

export function getRuntimeMetricsSnapshot(windowMin = 10): RuntimeMetricsSnapshot {
  return STORE.snapshot(windowMin);
}

