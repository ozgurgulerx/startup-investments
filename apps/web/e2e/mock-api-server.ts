import http from 'http';

type Region = 'global' | 'turkey';

const PORT = Number(process.env.PORT || '3001');

const GLOBAL_SIGNAL_ID = '11111111-1111-1111-1111-111111111111';
const TURKEY_SIGNAL_ID = '22222222-2222-2222-2222-222222222222';

type SignalStatus = 'candidate' | 'emerging' | 'accelerating' | 'established' | 'decaying';

type SignalItem = {
  id: string;
  domain: 'architecture' | 'gtm' | 'capital' | 'org' | 'product';
  cluster_name: string | null;
  claim: string;
  region: Region;
  conviction: number;
  momentum: number;
  impact: number;
  adoption_velocity: number;
  status: SignalStatus;
  evidence_count: number;
  unique_company_count: number;
  first_seen_at: string;
  last_evidence_at: string | null;
  explain?: {
    definition: string;
    why: string;
    examples: string[];
    risk: string;
    time_horizon: string;
    top_evidence: Array<{ snippet: string; source: string; date: string; url?: string }>;
  };
  explain_generated_at?: string;
  evidence_timeline?: number[];
  evidence_timeline_meta?: {
    bin_count: number;
    timeline_start: string;
    timeline_end: string;
  };
};

type LandscapeNode = {
  name: string;
  value: number;
  count: number;
  funding: number;
  pattern?: string;
  children?: LandscapeNode[];
  startups?: Array<{ id: string; name: string; slug: string; funding: number }>;
};

type LandscapeCluster = {
  pattern: string;
  startup_count: number;
  total_funding: number;
  top_startups: Array<{ id: string; name: string; slug: string; funding: number; stage: string | null }>;
  top_investors: Array<{ name: string; deal_count: number }>;
  related_patterns: string[];
};

const NOW = new Date();
const isoDaysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
const ymd = (d: Date) => d.toISOString().slice(0, 10);

const globalSignal: SignalItem = {
  id: GLOBAL_SIGNAL_ID,
  domain: 'capital',
  cluster_name: 'Growth',
  claim: 'Mock: Global capital surge',
  region: 'global',
  conviction: 0.85,
  momentum: 0.65,
  impact: 0.9,
  adoption_velocity: 0.4,
  status: 'accelerating',
  evidence_count: 42,
  unique_company_count: 7,
  first_seen_at: isoDaysAgo(3),
  last_evidence_at: isoDaysAgo(1),
  explain: {
    definition: 'A mock global signal used for CI smoke tests.',
    why: 'Ensures signals feed renders in CI without contacting prod.',
    examples: ['alpha-ai', 'beta-ml'],
    risk: 'Mock data does not reflect production.',
    time_horizon: '0-6 months',
    top_evidence: [{ snippet: 'Mock evidence', source: 'event', date: ymd(NOW) }],
  },
  explain_generated_at: NOW.toISOString(),
  evidence_timeline: [0, 0, 0, 0, 0, 0, 10, 32],
  evidence_timeline_meta: {
    bin_count: 8,
    timeline_start: ymd(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
    timeline_end: ymd(NOW),
  },
};

const turkeySignal: SignalItem = {
  id: TURKEY_SIGNAL_ID,
  domain: 'product',
  cluster_name: 'Launches',
  claim: 'Mock: Turkey product launch spike',
  region: 'turkey',
  conviction: 0.75,
  momentum: 0.5,
  impact: 0.6,
  adoption_velocity: 0.3,
  status: 'emerging',
  evidence_count: 12,
  unique_company_count: 3,
  first_seen_at: isoDaysAgo(5),
  last_evidence_at: isoDaysAgo(2),
  explain: {
    definition: 'A mock Turkey signal used for CI smoke tests.',
    why: 'Guards region propagation in Signals -> Deep dive -> Company links.',
    examples: ['turkish-ai', 'ankara-stack'],
    risk: 'Mock data does not reflect production.',
    time_horizon: '0-6 months',
    top_evidence: [{ snippet: 'Mock TR evidence', source: 'event', date: ymd(NOW) }],
  },
  explain_generated_at: NOW.toISOString(),
  evidence_timeline: [0, 0, 0, 0, 0, 2, 4, 6],
  evidence_timeline_meta: {
    bin_count: 8,
    timeline_start: ymd(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
    timeline_end: ymd(NOW),
  },
};

const SIGNALS_BY_ID: Record<string, SignalItem> = {
  [GLOBAL_SIGNAL_ID]: globalSignal,
  [TURKEY_SIGNAL_ID]: turkeySignal,
};

const LANDSCAPE_PATTERNS: Array<Omit<LandscapeNode, 'value'>> = [
  {
    name: 'Agentic Architectures',
    count: 24,
    funding: 340_000_000,
    startups: [
      { id: 'aaaa0000-0000-0000-0000-000000000001', name: 'Alpha Agent', slug: 'alpha-agent', funding: 55_000_000 },
      { id: 'aaaa0000-0000-0000-0000-000000000002', name: 'Orchestrate AI', slug: 'orchestrate-ai', funding: 42_000_000 },
    ],
  },
  {
    name: 'RAG (Retrieval-Augmented Generation)',
    count: 18,
    funding: 210_000_000,
    startups: [
      { id: 'bbbb0000-0000-0000-0000-000000000001', name: 'VectorWorks', slug: 'vectorworks', funding: 38_000_000 },
      { id: 'bbbb0000-0000-0000-0000-000000000002', name: 'IndexHub', slug: 'indexhub', funding: 25_000_000 },
    ],
  },
  {
    name: 'Vertical Data Moats',
    count: 12,
    funding: 125_000_000,
    startups: [
      { id: 'cccc0000-0000-0000-0000-000000000001', name: 'LedgerLens', slug: 'ledgerlens', funding: 30_000_000 },
    ],
  },
  {
    name: 'Micro-model Meshes',
    count: 9,
    funding: 80_000_000,
    startups: [
      { id: 'dddd0000-0000-0000-0000-000000000001', name: 'TinyLM', slug: 'tinylm', funding: 12_000_000 },
    ],
  },
];

const LANDSCAPE_CLUSTERS: Record<string, LandscapeCluster> = Object.fromEntries(
  LANDSCAPE_PATTERNS.map((p) => [
    p.name,
    {
      pattern: p.name,
      startup_count: p.count,
      total_funding: p.funding,
      top_startups: (p.startups || []).map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        funding: s.funding,
        stage: 'Seed',
      })),
      top_investors: [
        { name: 'Mock VC', deal_count: 7 },
        { name: 'Demo Capital', deal_count: 4 },
      ],
      related_patterns: LANDSCAPE_PATTERNS.filter((x) => x.name !== p.name).slice(0, 3).map((x) => x.name),
    },
  ])
);

function readRegion(sp: URLSearchParams): Region {
  const raw = sp.get('region');
  return raw === 'turkey' ? 'turkey' : 'global';
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function notFound(res: http.ServerResponse) {
  json(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  const method = req.method || 'GET';
  if (method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { error: 'Method not allowed' });
  }

  const url = new URL(req.url || '/', 'http://localhost');
  const p = url.pathname;

  // Basic health check for debugging.
  if (p === '/health') {
    return json(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
  }

  // Signals summary (used by /signals page server loader).
  if (p === '/api/v1/signals/summary') {
    const region = readRegion(url.searchParams);
    const s = region === 'turkey' ? turkeySignal : globalSignal;
    return json(res, 200, {
      rising: [s],
      established: [],
      decaying: [],
      stats: {
        total: 1,
        by_status: { [s.status]: 1 },
        by_domain: { [s.domain]: 1 },
      },
    });
  }

  // Signals list (not currently required by the smoke tests, but cheap to support).
  if (p === '/api/v1/signals') {
    const region = readRegion(url.searchParams);
    const s = region === 'turkey' ? turkeySignal : globalSignal;
    return json(res, 200, { signals: [s], total: 1 });
  }

  // Sector metadata (used by the Signals sector filter UI).
  if (p === '/api/v1/sectors') {
    return json(res, 200, { sectors: [] });
  }

  // Landscapes treemap data (used by /landscapes page).
  if (p === '/api/v1/landscapes') {
    const sizeBy = url.searchParams.get('size_by') === 'count' ? 'count' : 'funding';
    const nodes: LandscapeNode[] = LANDSCAPE_PATTERNS.map((n) => ({
      ...n,
      value: sizeBy === 'count' ? n.count : n.funding,
    }));
    return json(res, 200, nodes);
  }

  // Landscapes cluster detail panel (used by /landscapes page).
  if (p === '/api/v1/landscapes/cluster') {
    const pattern = (url.searchParams.get('pattern') || '').trim();
    if (!pattern) return json(res, 400, { error: 'Missing pattern' });
    const detail = LANDSCAPE_CLUSTERS[pattern];
    if (!detail) return json(res, 404, { error: 'Not found' });
    return json(res, 200, detail);
  }

  const deepDiveMatch = p.match(/^\/api\/v1\/signals\/([0-9a-f-]+)\/deep-dive$/i);
  if (deepDiveMatch) {
    const id = deepDiveMatch[1].toLowerCase();
    const signal = SIGNALS_BY_ID[id];
    if (!signal) return notFound(res);

    const createdAt = isoDaysAgo(1);
    return json(res, 200, {
      deep_dive: {
        id: id === TURKEY_SIGNAL_ID ? '33333333-3333-3333-3333-333333333333' : '44444444-4444-4444-4444-444444444444',
        signal_id: id,
        version: 1,
        status: 'ready',
        content_json: {
          tldr: 'Mock deep dive summary.',
          mechanism: 'Mock mechanism text.',
          patterns: [
            {
              archetype: 'Mock Archetype',
              description: 'Mock archetype description.',
              startups: ['turkish-ai', 'ankara-stack'],
            },
          ],
          case_studies: [
            {
              startup_slug: 'turkish-ai',
              startup_name: 'Turkish AI',
              summary: 'Mock case study summary.',
              key_moves: ['product_launch: Mock launch', 'partnership: Mock partner'],
            },
          ],
          thresholds: [
            { metric: 'Evidence count', value: '10', action: 'Mock threshold action.' },
          ],
          failure_modes: [
            { mode: 'Mock failure mode', description: 'Mock description', example: null },
          ],
          watchlist: [
            { startup_slug: 'turkish-ai', why: 'Mock watchlist reason.' },
          ],
        },
        sample_startup_ids: ['00000000-0000-0000-0000-000000000000'],
        sample_count: 2,
        generation_model: 'mock',
        generation_cost_tokens: null,
        evidence_hash: null,
        created_at: createdAt,
      },
      signal,
      diff: null,
      meta: {
        schema_missing: false,
        unlinked_evidence_count: 0,
        startups_with_evidence: signal.unique_company_count,
        startups_eligible: signal.unique_company_count,
        occurrences_total: 0,
        latest_status: 'ready',
        latest_version: 1,
        latest_created_at: createdAt,
      },
    });
  }

  const relevanceMatch = p.match(/^\/api\/v1\/signals\/([0-9a-f-]+)\/relevance$/i);
  if (relevanceMatch) {
    const id = relevanceMatch[1].toLowerCase();
    const signal = SIGNALS_BY_ID[id];
    if (!signal) return notFound(res);

    const region = readRegion(url.searchParams);
    const windowDays = Number(url.searchParams.get('window_days') || '90');
    return json(res, 200, {
      signal_id: id,
      region,
      window_days: windowDays,
      relevant_rounds: [
        {
          funding_round_id: '55555555-5555-5555-5555-555555555555',
          startup_id: '66666666-6666-6666-6666-666666666666',
          startup_name: 'Turkish AI',
          startup_slug: 'turkish-ai',
          round_type: 'Seed',
          amount_usd: 1000000,
          announced_date: ymd(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)),
          lead_investor: 'Mock VC',
          occurrence_score: 0.7,
          score: 0.8,
          why: ['Mock why 1'],
        },
      ],
      related_patterns: [
        {
          pattern: 'Mock Pattern',
          count: 2,
          score: 0.5,
          why: ['Mock pattern why'],
          example_startups: [{ slug: 'turkish-ai', name: 'Turkish AI' }],
        },
      ],
      related_signals: [
        {
          signal: region === 'turkey' ? turkeySignal : globalSignal,
          overlap_count: 1,
          score: 1,
          why: ['Mock overlap'],
        },
      ],
    });
  }

  const detailMatch = p.match(/^\/api\/v1\/signals\/([0-9a-f-]+)$/i);
  if (detailMatch) {
    const id = detailMatch[1].toLowerCase();
    const signal = SIGNALS_BY_ID[id];
    if (!signal) return notFound(res);
    return json(res, 200, {
      signal,
      stage_context: null,
      evidence: [],
      evidence_total: 0,
      related: [],
    });
  }

  return notFound(res);
});

server.listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`[mock-api] listening on http://127.0.0.1:${PORT}`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
