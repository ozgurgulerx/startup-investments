import { describe, it, expect } from 'vitest';
import { makeBriefService, computeInputHashPure, computeSignalsHashPure, pctChange } from './brief';
import { validateBriefSnapshot } from './brief-validation';

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

// ============================================================================
// draftBuilderActions — deterministic builder actions
// ============================================================================

describe('draftBuilderActions', () => {
  const makeSignal = (overrides: Partial<{
    clusterId: string; title: string; summary: string;
    storyType: string; builderTakeaway: string; signalScore: number;
    linkedSlugs: string[]; publishedAt: string;
  }> = {}) => ({
    clusterId: overrides.clusterId || `c-${Math.random().toString(36).slice(2, 8)}`,
    title: overrides.title || 'Test Signal',
    summary: overrides.summary || 'A test signal summary.',
    storyType: overrides.storyType || 'general',
    builderTakeaway: overrides.builderTakeaway || 'Watch this space.',
    signalScore: overrides.signalScore || 0.8,
    linkedSlugs: overrides.linkedSlugs || [],
    publishedAt: overrides.publishedAt || '2026-02-10T00:00:00Z',
  });

  const basePatterns = [
    { pattern: 'RAG', prevalencePct: 50, startupCount: 15, signal: 'Dominant' },
    { pattern: 'Agents', prevalencePct: 30, startupCount: 9, signal: 'Strong' },
    { pattern: 'Fine-tuned Models', prevalencePct: 15, startupCount: 5, signal: 'Emerging' },
  ];

  const baseDeltas = {
    totalFunding: { value: 50_000_000, pct: 35 },
    dealCount: { value: 10, pct: 20 },
    avgDeal: { value: 500_000, pct: 10 },
    genaiAdoptionRate: { ppChange: 5 },
    patternShifts: [
      { pattern: 'RAG', prevPct: 40, currPct: 50, deltaPp: 10 },
      { pattern: 'Agents', prevPct: 22, currPct: 30, deltaPp: 8 },
    ],
    stageShifts: [],
  };

  it('returns 3-5 actions given valid signals + patterns + deltas', () => {
    const signals = [
      makeSignal({ storyType: 'platform' }),
      makeSignal({ storyType: 'regulation' }),
      makeSignal({ storyType: 'funding' }),
    ];
    const actions = service.draftBuilderActions(signals, basePatterns, baseDeltas, null, 'global');
    expect(actions.length).toBeGreaterThanOrEqual(3);
    expect(actions.length).toBeLessThanOrEqual(5);
  });

  it('each action has at least 1 ref', () => {
    const signals = [
      makeSignal({ storyType: 'platform' }),
      makeSignal({ storyType: 'product_launch', title: 'New Product X' }),
    ];
    const actions = service.draftBuilderActions(signals, basePatterns, baseDeltas, null, 'global');
    for (const action of actions) {
      expect(action.refs.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('no duplicate primary refs across actions', () => {
    const signals = [
      makeSignal({ storyType: 'platform', clusterId: 'c-1' }),
      makeSignal({ storyType: 'regulation', clusterId: 'c-2' }),
      makeSignal({ storyType: 'funding', clusterId: 'c-3' }),
    ];
    const actions = service.draftBuilderActions(signals, basePatterns, baseDeltas, null, 'global');
    const primaryRefIds = actions.map(a => a.refs[0]?.refId);
    const unique = new Set(primaryRefIds);
    expect(unique.size).toBe(primaryRefIds.length);
  });

  it('empty inputs → empty actions', () => {
    const actions = service.draftBuilderActions([], [], null, null, 'global');
    expect(actions).toEqual([]);
  });

  it('signal-only input produces signal-driven actions', () => {
    const signals = [
      makeSignal({ storyType: 'agents' }),
      makeSignal({ storyType: 'benchmark' }),
    ];
    const actions = service.draftBuilderActions(signals, [], null, null, 'global');
    expect(actions.length).toBeGreaterThanOrEqual(1);
    for (const action of actions) {
      expect(action.refs[0].refType).toBe('signal');
    }
  });

  it('pattern-only input produces pattern-driven actions', () => {
    const highPrevalencePatterns = [
      { pattern: 'RAG', prevalencePct: 50, startupCount: 15, signal: 'Dominant' },
    ];
    const actions = service.draftBuilderActions([], highPrevalencePatterns, null, null, 'global');
    expect(actions.length).toBeGreaterThanOrEqual(1);
    for (const action of actions) {
      expect(action.refs[0].refType).toBe('pattern');
    }
  });

  it('ref URLs are well-formed', () => {
    const signals = [
      makeSignal({ storyType: 'platform', linkedSlugs: ['acme-ai'] }),
      makeSignal({ storyType: 'product_launch' }),
    ];
    const actions = service.draftBuilderActions(signals, basePatterns, baseDeltas, null, 'global');
    for (const action of actions) {
      for (const ref of action.refs) {
        expect(ref.url).toMatch(/^\/(news\?story=|signals\?pattern=|company\/|dealbook)/);
      }
    }
  });

  it('turkey region appends ?region=turkey to URLs', () => {
    const signals = [makeSignal({ storyType: 'platform' })];
    const actions = service.draftBuilderActions(signals, [], null, null, 'turkey');
    expect(actions.length).toBeGreaterThanOrEqual(1);
    for (const action of actions) {
      for (const ref of action.refs) {
        expect(ref.url).toContain('region=turkey');
      }
    }
  });

  it('caps at 5 actions even with many inputs', () => {
    const signals = Array.from({ length: 5 }, (_, i) =>
      makeSignal({ storyType: ['platform', 'regulation', 'funding', 'acquisition', 'product_launch'][i] }),
    );
    const actions = service.draftBuilderActions(signals, basePatterns, baseDeltas, null, 'global');
    expect(actions.length).toBeLessThanOrEqual(5);
  });
});

// ============================================================================
// validateBriefSnapshot
// ============================================================================

describe('validateBriefSnapshot', () => {
  function makeValidSnapshot(): any {
    return {
      id: 'rev-1',
      editionId: 'ed-1',
      region: 'global',
      periodType: 'monthly',
      periodKey: '2026-02',
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      periodLabel: 'February 2026',
      kind: 'rolling',
      revisionNumber: 1,
      generatedAt: new Date().toISOString(),
      metrics: {
        totalFunding: 100_000_000,
        dealCount: 50,
        avgDeal: 2_000_000,
        medianDeal: 1_500_000,
        largestDeal: { company: 'Test', slug: 'test', amount: 20_000_000, stage: 'Series A' },
        genaiAdoptionRate: 40,
        analysisCount: 30,
        topPatterns: [{ pattern: 'RAG', count: 15, prevalencePct: 50 }],
        stageMix: [{ stage: 'Seed', amount: 20_000_000, deals: 25, pct: 20 }],
      },
      prevPeriod: null,
      deltas: null,
      revisionDeltas: null,
      prevPeriodBounds: null,
      newsContext: null,
      topSignals: [{ clusterId: 'c-1', title: 'Test', summary: 'A test.', storyType: 'general', builderTakeaway: 'Watch.', signalScore: 0.8, linkedSlugs: [], publishedAt: '2026-02-10T00:00:00Z' }],
      deltaBullets: ['Funding rose 25%'],
      revisionDeltaBullets: [],
      executiveSummary: 'February saw $100M deployed across 50 deals.',
      theme: { name: 'RAG Era', summaryBullets: ['50 deals'] },
      builderLessons: [{ title: 'Follow funding', text: 'Strong conviction.' }],
      whatWatching: ['Deal velocity'],
      builderActions: [{
        action: 'Monitor this signal.',
        rationale: 'Early detection advantage.',
        refs: [{ refType: 'signal', refId: 'c-1', label: 'Test', url: '/news?story=c-1' }],
      }],
      patternLandscape: [{ pattern: 'RAG', prevalencePct: 50, startupCount: 15, signal: 'Dominant' }],
      fundingByStage: [{ stage: 'Seed', amount: 20_000_000, pct: 20, deals: 25 }],
      topDeals: [{ rank: 1, company: 'Test', slug: 'test', amount: 20_000_000, stage: 'Series A', location: 'US' }],
      geography: [{ region: 'North America', deals: 30, totalFunding: 60_000_000, avgDeal: 2_000_000 }],
      investors: { mostActive: [], megaCheckWriters: [] },
      methodology: { bullets: ['Metrics derived from tracked funding rounds'] },
      status: 'ready',
    };
  }

  it('valid snapshot → valid: true, no hard errors', () => {
    const result = validateBriefSnapshot(makeValidSnapshot());
    expect(result.valid).toBe(true);
    // May have warnings but no hard errors
    const hardErrors = result.errors.filter(e => !e.startsWith('warning:'));
    expect(hardErrors).toEqual([]);
  });

  it('missing metrics → error', () => {
    const snap = makeValidSnapshot();
    snap.metrics = undefined;
    const result = validateBriefSnapshot(snap);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('metrics is missing');
  });

  it('empty executiveSummary → error', () => {
    const snap = makeValidSnapshot();
    snap.executiveSummary = '';
    const result = validateBriefSnapshot(snap);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('executiveSummary is empty');
  });

  it('invalid BuilderActionRef URL → error', () => {
    const snap = makeValidSnapshot();
    snap.builderActions = [{
      action: 'Test',
      rationale: 'Test',
      refs: [{ refType: 'signal', refId: 'c-1', label: 'Test', url: 'https://evil.com/exploit' }],
    }];
    const result = validateBriefSnapshot(snap);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('invalid BuilderActionRef URL'))).toBe(true);
  });

  it('empty topSignals → warning (still valid)', () => {
    const snap = makeValidSnapshot();
    snap.topSignals = [];
    const result = validateBriefSnapshot(snap);
    expect(result.valid).toBe(true);
    expect(result.errors).toContain('warning: topSignals is empty');
  });

  it('empty builderActions → warning (still valid)', () => {
    const snap = makeValidSnapshot();
    snap.builderActions = [];
    const result = validateBriefSnapshot(snap);
    expect(result.valid).toBe(true);
    expect(result.errors).toContain('warning: builderActions is empty');
  });

  it('invalid status → error', () => {
    const snap = makeValidSnapshot();
    snap.status = 'invalid';
    const result = validateBriefSnapshot(snap);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('invalid status'))).toBe(true);
  });

  it('empty methodology.bullets → error', () => {
    const snap = makeValidSnapshot();
    snap.methodology = { bullets: [] };
    const result = validateBriefSnapshot(snap);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('methodology.bullets is empty');
  });
});
