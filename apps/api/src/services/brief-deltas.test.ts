import { describe, it, expect } from 'vitest';
import { makeBriefService, computeInputHashPure, computeSignalsHashPure, pctChange } from './brief';

// Minimal mock pool — only needed to instantiate the service for pure-function access
const mockPool = { query: async () => ({ rows: [] }), connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }) } as any;
const service = makeBriefService(mockPool);

// ============================================================================
// resolvePeriodBounds — MTD alignment
// ============================================================================

describe('resolvePeriodBounds', () => {
  it('returns full previous month for non-MTD monthly', () => {
    const b = service.resolvePeriodBounds('monthly', '2026-02');
    expect(b.prevPeriodKey).toBe('2026-01');
    // Key assertion: mtdAligned is false for non-MTD
    expect(b.mtdAligned).toBe(false);
    // prevPeriodEnd represents end of Jan (timezone may shift ±1 day in ISO conversion)
    const prevEnd = new Date(b.prevPeriodEnd + 'T12:00:00Z'); // noon to avoid TZ ambiguity
    expect(prevEnd.getUTCMonth()).toBeLessThanOrEqual(0); // January = 0 (or Dec 31 from TZ shift)
  });

  it('MTD-aligns Feb → Jan with day count matching', () => {
    const b = service.resolvePeriodBounds('monthly', '2026-02', { periodEnd: '2026-02-10' });
    expect(b.prevPeriodKey).toBe('2026-01');
    expect(b.mtdAligned).toBe(true);
    // Prev period end day should be <= 10 (MTD aligned to ~10 days into prev month)
    const prevEndDay = new Date(b.prevPeriodEnd).getDate();
    expect(prevEndDay).toBeLessThanOrEqual(11); // allow ±1 for timezone
    expect(prevEndDay).toBeGreaterThanOrEqual(9);
  });

  it('MTD-aligns Mar 1–31 → clamps to end of shorter month (Feb)', () => {
    const b = service.resolvePeriodBounds('monthly', '2026-03', { periodEnd: '2026-03-31' });
    expect(b.prevPeriodKey).toBe('2026-02');
    expect(b.mtdAligned).toBe(true);
    // Feb has 28 days in 2026; clamped so prevEnd is in Feb
    const prevEnd = new Date(b.prevPeriodEnd);
    expect(prevEnd.getMonth() + 1).toBe(2); // February
    expect(prevEnd.getDate()).toBeLessThanOrEqual(28);
  });

  it('weekly has no MTD alignment', () => {
    const b = service.resolvePeriodBounds('weekly', '2026-W06');
    expect(b.mtdAligned).toBe(false);
    // Previous week is -7 days
    const prevStart = new Date(b.prevPeriodStart);
    const currStart = new Date(b.periodStart);
    const diff = (currStart.getTime() - prevStart.getTime()) / 86400000;
    expect(diff).toBe(7);
  });
});

// ============================================================================
// computeDeltas — edge cases
// ============================================================================

describe('computeDeltas', () => {
  const baseMetrics = {
    totalFunding: 100_000_000,
    dealCount: 50,
    avgDeal: 2_000_000,
    medianDeal: 1_500_000,
    largestDeal: { company: 'Test', slug: 'test', amount: 20_000_000, stage: 'Series A' },
    genaiAdoptionRate: 40,
    analysisCount: 30,
    topPatterns: [
      { pattern: 'RAG', count: 15, prevalencePct: 50 },
      { pattern: 'Agents', count: 9, prevalencePct: 30 },
    ],
    stageMix: [
      { stage: 'Seed', amount: 20_000_000, deals: 25, pct: 20 },
      { stage: 'Series A', amount: 80_000_000, deals: 25, pct: 80 },
    ],
  };

  it('returns null when prev is null', () => {
    expect(service.computeDeltas(baseMetrics, null)).toBe(null);
  });

  it('returns null when prev.dealCount is 0', () => {
    const prev = { ...baseMetrics, dealCount: 0 };
    expect(service.computeDeltas(baseMetrics, prev)).toBe(null);
  });

  it('computes correct percentage changes', () => {
    const prev = { ...baseMetrics, totalFunding: 80_000_000, dealCount: 40, avgDeal: 1_600_000 };
    const deltas = service.computeDeltas(baseMetrics, prev)!;
    expect(deltas).not.toBeNull();
    expect(deltas.totalFunding!.pct).toBe(25); // (100-80)/80 = 25%
    expect(deltas.dealCount!.pct).toBe(25); // (50-40)/40 = 25%
    expect(deltas.avgDeal!.pct).toBe(25); // (2M-1.6M)/1.6M = 25%
  });

  it('computes pp change for genai adoption', () => {
    const prev = { ...baseMetrics, genaiAdoptionRate: 35 };
    const deltas = service.computeDeltas(baseMetrics, prev)!;
    expect(deltas.genaiAdoptionRate!.ppChange).toBe(5); // 40-35 = +5pp
  });

  it('handles pct when prev is 0 and curr > 0', () => {
    const prev = { ...baseMetrics, totalFunding: 0 };
    const deltas = service.computeDeltas(baseMetrics, prev)!;
    expect(deltas.totalFunding!.pct).toBe(100);
    expect(deltas.totalFunding!.value).toBe(100_000_000);
  });

  it('filters pattern shifts with |deltaPp| < 3', () => {
    const prev = {
      ...baseMetrics,
      topPatterns: [
        { pattern: 'RAG', count: 15, prevalencePct: 49 }, // delta = +1pp → filtered
        { pattern: 'Agents', count: 9, prevalencePct: 25 }, // delta = +5pp → kept
      ],
    };
    const deltas = service.computeDeltas(baseMetrics, prev)!;
    expect(deltas.patternShifts.length).toBe(1);
    expect(deltas.patternShifts[0].pattern).toBe('Agents');
    expect(deltas.patternShifts[0].deltaPp).toBe(5);
  });

  it('limits pattern shifts to 5 entries', () => {
    const prev = {
      ...baseMetrics,
      topPatterns: Array.from({ length: 10 }, (_, i) => ({
        pattern: `Pattern${i}`,
        count: 10,
        prevalencePct: i * 5, // large deltas for all
      })),
    };
    const curr = {
      ...baseMetrics,
      topPatterns: Array.from({ length: 10 }, (_, i) => ({
        pattern: `Pattern${i}`,
        count: 10,
        prevalencePct: (i + 3) * 5,
      })),
    };
    const deltas = service.computeDeltas(curr, prev)!;
    expect(deltas.patternShifts.length).toBeLessThanOrEqual(5);
  });

  it('sorts pattern shifts by |deltaPp| descending', () => {
    const prev = {
      ...baseMetrics,
      topPatterns: [
        { pattern: 'A', count: 5, prevalencePct: 10 },
        { pattern: 'B', count: 5, prevalencePct: 20 },
        { pattern: 'C', count: 5, prevalencePct: 30 },
      ],
    };
    const curr = {
      ...baseMetrics,
      topPatterns: [
        { pattern: 'A', count: 5, prevalencePct: 15 }, // +5pp
        { pattern: 'B', count: 5, prevalencePct: 30 }, // +10pp
        { pattern: 'C', count: 5, prevalencePct: 20 }, // -10pp
      ],
    };
    const deltas = service.computeDeltas(curr, prev)!;
    // B (+10) and C (-10) should be first, A (+5) last
    expect(Math.abs(deltas.patternShifts[0].deltaPp)).toBeGreaterThanOrEqual(
      Math.abs(deltas.patternShifts[deltas.patternShifts.length - 1].deltaPp)
    );
  });
});

// ============================================================================
// pctChange — utility
// ============================================================================

describe('pctChange', () => {
  it('returns null when both are 0', () => {
    expect(pctChange(0, 0)).toBe(null);
  });

  it('returns 100% when prev is 0 and curr > 0', () => {
    expect(pctChange(50, 0)).toEqual({ value: 50, pct: 100 });
  });

  it('computes correct percentage', () => {
    expect(pctChange(120, 100)).toEqual({ value: 20, pct: 20 });
    expect(pctChange(80, 100)).toEqual({ value: -20, pct: -20 });
  });
});

// ============================================================================
// computeSignalsHashPure — signal change detection
// ============================================================================

describe('computeSignalsHashPure', () => {
  it('empty signals → valid 64-char hex hash', () => {
    const h = computeSignalsHashPure([]);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it('order-independent: [b, a] same as [a, b]', () => {
    const h1 = computeSignalsHashPure([{ clusterId: 'b' }, { clusterId: 'a' }]);
    const h2 = computeSignalsHashPure([{ clusterId: 'a' }, { clusterId: 'b' }]);
    expect(h1).toBe(h2);
  });

  it('different IDs → different hash', () => {
    const h1 = computeSignalsHashPure([{ clusterId: 'a' }]);
    const h2 = computeSignalsHashPure([{ clusterId: 'b' }]);
    expect(h1).not.toBe(h2);
  });

  it('same IDs → same hash', () => {
    const h1 = computeSignalsHashPure([{ clusterId: 'x' }, { clusterId: 'y' }]);
    const h2 = computeSignalsHashPure([{ clusterId: 'x' }, { clusterId: 'y' }]);
    expect(h1).toBe(h2);
  });
});

// ============================================================================
// computeInputHashPure — hash stability (with signalsHash)
// ============================================================================

describe('computeInputHashPure', () => {
  const baseInputs = {
    region: 'global',
    periodType: 'monthly',
    periodStart: '2026-02-01',
    periodEnd: '2026-02-28',
    kind: 'rolling',
    metricsSnapshot: { metrics: { totalFunding: 100, dealCount: 10 } },
    promptVersion: 'brief-v2',
    signalsHash: 'abc123',
  };

  it('same inputs → same hash', () => {
    const h1 = computeInputHashPure(baseInputs);
    const h2 = computeInputHashPure({ ...baseInputs });
    expect(h1).toBe(h2);
  });

  it('different metrics → different hash', () => {
    const h1 = computeInputHashPure(baseInputs);
    const h2 = computeInputHashPure({
      ...baseInputs,
      metricsSnapshot: { metrics: { totalFunding: 200, dealCount: 10 } },
    });
    expect(h1).not.toBe(h2);
  });

  it('different signalsHash → different hash', () => {
    const h1 = computeInputHashPure(baseInputs);
    const h2 = computeInputHashPure({
      ...baseInputs,
      signalsHash: 'different_hash',
    });
    expect(h1).not.toBe(h2);
  });

  it('same signalsHash → same overall hash', () => {
    const h1 = computeInputHashPure(baseInputs);
    const h2 = computeInputHashPure({ ...baseInputs, signalsHash: 'abc123' });
    expect(h1).toBe(h2);
  });

  it('empty signalsHash is stable', () => {
    const inputs = { ...baseInputs, signalsHash: '' };
    const h1 = computeInputHashPure(inputs);
    const h2 = computeInputHashPure(inputs);
    expect(h1).toBe(h2);
  });

  it('returns a 64-char hex string (SHA-256)', () => {
    const h = computeInputHashPure(baseInputs);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
});
