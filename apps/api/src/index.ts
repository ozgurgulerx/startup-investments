import './telemetry';
import express, { Express } from 'express';
import compression from 'compression';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import type { PoolClient } from 'pg';
import { db, pool, testConnection, closePool, getPoolStats } from './db';
import { startups, fundingRounds, investors } from './db/schema';
import { eq, desc, sql, count, sum, and, gte, lte, ilike, or } from 'drizzle-orm';
import { logoExtractor } from './services/logo-extractor';
import {
  syncRequestSchema,
  startupsQuerySchema,
  companyQuerySchema,
  statsQuerySchema,
  periodsQuerySchema,
  dealBookQuerySchema,
  dealBookFiltersQuerySchema,
  investorsQuerySchema,
  newsLatestQuerySchema,
  newsEditionQuerySchema,
  newsTopicsQuerySchema,
  newsArchiveQuerySchema,
  newsSearchQuerySchema,
  newsSourcesQuerySchema,
  newsBriefQuerySchema,
  newsBriefArchiveQuerySchema,
  newsSignalToggleSchema,
  newsSignalBatchSchema,
  newsSignalMergeSchema,
  editorialActionSchema,
  editorialRuleCreateSchema,
  editorialRuleUpdateSchema,
  editorialReviewQuerySchema,
  editorialActionsQuerySchema,
  editorialRulesQuerySchema,
  editorialStatsQuerySchema,
  newsEditionOutputSchema,
  briefQuerySchema,
  briefListSchema,
  briefRegenerateSchema,
  signalsQuerySchema,
  signalsSummaryQuerySchema,
  deepDiveVersionQuerySchema,
  occurrencesQuerySchema,
  movesQuerySchema,
  deepDiveListQuerySchema,
  timelineQuerySchema,
  moversFeedQuerySchema,
  moversSummaryQuerySchema,
  moversUnreadQuerySchema,
  moversSeenSchema,
  startupDeltasQuerySchema,
  startupNeighborsQuerySchema,
  startupBenchmarksQuerySchema,
  benchmarksQuerySchema,
  benchmarksCompareQuerySchema,
  benchmarksCohortQuerySchema,
  investorDnaQuerySchema,
  investorScreenerQuerySchema,
  investorPortfolioQuerySchema,
  investorNetworkQuerySchema,
  startupInvestorsQuerySchema,
  startupFoundersQuerySchema,
  investorUpsertSchema,
  founderUpsertSchema,
  graphEdgeUpsertSchema,
  graphEdgesBulkUpsertSchema,
  onboardingContextCreateSchema,
  onboardingContextTemplateQuerySchema,
  landscapesQuerySchema,
  landscapesClusterQuerySchema,
  sectorsQuerySchema,
  subscriptionCreateSchema,
  subscriptionDeleteSchema,
  subscriptionsQuerySchema,
  alertsQuerySchema,
  alertUpdateSchema,
  alertBatchUpdateSchema,
  alertDigestQuerySchema,
} from './validation';
import { slugify, parseLocation, parseFundingAmount } from './utils';
import { makeNewsService } from './services/news';
import { makeSignalsService } from './services/signals';
import { makeDeepDivesService } from './services/deep-dives';
import { makeMoversService } from './services/movers';
import { makeBriefService } from './services/brief';
import { makeBenchmarksService } from './services/benchmarks';
import { makeInvestorsService } from './services/investors';
import { makeLandscapesService } from './services/landscapes';
import { CURATED_SECTORS, findSector, sectorFilterForStartups } from './shared/sectors';
import { makeSubscriptionsService } from './services/subscriptions';
import {
  getRedisClient,
  closeRedisClient,
  invalidateAll,
  invalidatePattern,
  getCacheStats,
  dealBookKey,
  companyBySlugKey,
  periodsKey,
  statsKey,
  filterOptionsKey,
  newsEditionKey,
  newsLatestDateKey,
  newsLatestKey,
  newsTopicsKey,
  newsArchiveKey,
  newsSearchKey,
  newsSourcesKey,
  newsBriefKey,
  newsBriefArchiveKey,
  briefKey as briefCacheKey,
  briefListKey as briefListCacheKey,
  hashObject,
  safeCacheParse,
  CACHE_TTL,
} from './cache/redis';

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.API_KEY;
const FRONT_DOOR_ID = process.env.FRONT_DOOR_ID;
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.API_KEY;
const newsService = makeNewsService(pool);
const signalsService = makeSignalsService(pool);
const deepDivesService = makeDeepDivesService(pool);
const moversService = makeMoversService(pool);
const briefService = makeBriefService(pool);
const benchmarksService = makeBenchmarksService(pool);
const investorsService = makeInvestorsService(pool);
const landscapesService = makeLandscapesService(pool);
const subscriptionsService = makeSubscriptionsService(pool);
const API_BUILD_SHA = (process.env.API_BUILD_SHA || process.env.GITHUB_SHA || 'unknown').trim();

// Trust proxy for correct client IP behind Azure Front Door / Load Balancer
app.set('trust proxy', true);

// Fail fast if required secrets are missing in production
if (process.env.NODE_ENV === 'production') {
  if (!process.env.API_KEY) {
    console.error('FATAL: API_KEY is required in production but not set. Exiting.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('FATAL: DATABASE_URL is required in production but not set. Exiting.');
    process.exit(1);
  }
  if (!process.env.FRONT_DOOR_ID) {
    console.error('FATAL: FRONT_DOOR_ID is required in production but not set. Exiting.');
    process.exit(1);
  }
  if (!process.env.ADMIN_KEY) {
    console.warn('WARNING: ADMIN_KEY not set in production — falling back to API_KEY for admin endpoints.');
  }
}

// Lightweight liveness probe - no I/O, for K8s liveness checks
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), build_sha: API_BUILD_SHA });
});

// Readiness probe - checks pool stats in-memory only, for K8s readiness checks
// Pool is lazy (creates connections on demand), so totalCount=0 is OK at startup.
app.get('/readyz', async (_req, res) => {
  const poolStats = getPoolStats();
  // If pool has connections, check they're not all exhausted
  if (poolStats.totalCount > 0) {
    const dbReady = poolStats.waitingCount < poolStats.totalCount;
    return res.status(dbReady ? 200 : 503).json({
      status: dbReady ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      build_sha: API_BUILD_SHA,
      pool: poolStats,
    });
  }
  // Pool has no connections yet (lazy init) — verify DB is reachable
  const dbOk = await testConnection(1, 0);
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    build_sha: API_BUILD_SHA,
    pool: poolStats,
  });
});

// Full health check - expensive, for manual diagnostics only
app.get('/health', async (_req, res) => {
  const dbConnected = await testConnection(1, 0);
  const poolStats = getPoolStats();
  const cacheStats = await getCacheStats();

  res.json({
    status: dbConnected ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    build_sha: API_BUILD_SHA,
    database: dbConnected ? 'connected' : 'disconnected',
    pool: poolStats,
    cache: cacheStats || { connected: false },
  });
});

// Helper: returns a period filter condition, or undefined for 'all' (omits the filter)
function periodFilter(period: string | undefined) {
  if (!period || period === 'all') return undefined;
  return eq(startups.period, period);
}

function normalizeStageKey(value: string | undefined | null): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function computedSlugExpr() {
  // Mirrors apps/api/src/utils.ts slugify() using SQL.
  return sql<string>`regexp_replace(
    regexp_replace(lower(${startups.name}), '[^a-z0-9]+', '-', 'g'),
    '(^-|-$)',
    '',
    'g'
  )`;
}

const GRAPH_ACTIVE_VALID_TO = '9999-12-31';
const LEAD_INVESTOR_SPLIT_RE = /\s+(?:and|ve)\s+|\s+&\s+|,|;|\/|\|/i;
const LEAD_INVESTOR_DENYLIST = new Set([
  'investor',
  'investors',
  'round',
  'funding',
  'series',
  'seed',
  'pre-seed',
  'growth',
  'bridge',
]);

function splitLeadInvestorNames(raw: string | null | undefined): string[] {
  const cleaned = String(raw || '')
    .replace(/\s+/g, ' ')
    .replace(/\b(?:with participation from|with participation by|katılımıyla|katilimiyla)\b.*$/i, '')
    .trim()
    .replace(/^[,.;\s]+|[,.;\s]+$/g, '');
  if (!cleaned) return [];

  const parts = cleaned.split(LEAD_INVESTOR_SPLIT_RE);
  const names: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const name = part.replace(/\s+/g, ' ').trim().replace(/^[,.;\s]+|[,.;\s]+$/g, '');
    if (!name) continue;
    const lower = name.toLowerCase();
    if (LEAD_INVESTOR_DENYLIST.has(lower)) continue;
    if (/^(series\s+[a-z]|pre-?seed|seed|growth|bridge)$/i.test(lower)) continue;
    if (name.length < 2) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    names.push(name);
  }
  return names;
}

function normalizeAnnouncedDateToIso(raw: string | null | undefined): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

interface AdminFundingGraphRow {
  startupId: string;
  roundType: string;
  amountUsd: number | null;
  announcedDate: string | null;
  leadInvestors: string;
}

async function syncCapitalGraphFromFundingRows(
  pgClient: PoolClient,
  datasetRegion: 'global' | 'turkey',
  rows: AdminFundingGraphRow[],
): Promise<{
  enabled: boolean;
  investorsUpserted: number;
  edgesUpserted: number;
  viewsRefreshed: boolean;
  candidateRows: number;
}> {
  const stats = {
    enabled: false,
    investorsUpserted: 0,
    edgesUpserted: 0,
    viewsRefreshed: false,
    candidateRows: 0,
  };
  if (rows.length === 0) return stats;

  const tableCheck = await pgClient.query<{
    has_graph_edges: boolean;
    has_investors: boolean;
  }>(
    `SELECT
      to_regclass('public.capital_graph_edges') IS NOT NULL AS has_graph_edges,
      to_regclass('public.investors') IS NOT NULL AS has_investors`,
  );
  const ready = Boolean(
    tableCheck.rows[0]?.has_graph_edges && tableCheck.rows[0]?.has_investors,
  );
  if (!ready) return stats;
  stats.enabled = true;

  const candidateEdges: Array<{
    startupId: string;
    investorNorm: string;
    roundType: string;
    amountUsd: number | null;
    announcedDateIso: string | null;
    leadRaw: string;
  }> = [];
  const investorDisplayByNorm = new Map<string, string>();

  for (const row of rows) {
    const names = splitLeadInvestorNames(row.leadInvestors);
    if (names.length === 0) continue;
    stats.candidateRows += 1;
    const announcedDateIso = normalizeAnnouncedDateToIso(row.announcedDate);
    for (const name of names) {
      const norm = name.toLowerCase();
      investorDisplayByNorm.set(norm, name);
      candidateEdges.push({
        startupId: row.startupId,
        investorNorm: norm,
        roundType: row.roundType,
        amountUsd: row.amountUsd,
        announcedDateIso,
        leadRaw: row.leadInvestors,
      });
    }
  }

  if (candidateEdges.length === 0) return stats;

  const investorIdByNorm = new Map<string, string>();
  const defaultCountry = datasetRegion === 'turkey' ? 'Turkey' : null;
  for (const [norm, display] of investorDisplayByNorm.entries()) {
    const investorResult = await pgClient.query<{ id: string; inserted: boolean }>(
      `INSERT INTO investors (name, type, headquarters_country)
       VALUES ($1, 'unknown', $2)
       ON CONFLICT (name)
       DO UPDATE SET
         type = COALESCE(investors.type, EXCLUDED.type),
         headquarters_country = COALESCE(investors.headquarters_country, EXCLUDED.headquarters_country)
       RETURNING id::text, (xmax = 0) AS inserted`,
      [display, defaultCountry],
    );
    const investorId = investorResult.rows[0]?.id;
    if (!investorId) continue;
    investorIdByNorm.set(norm, investorId);
    if (Boolean(investorResult.rows[0]?.inserted)) {
      stats.investorsUpserted += 1;
    }
  }

  for (const edge of candidateEdges) {
    const investorId = investorIdByNorm.get(edge.investorNorm);
    if (!investorId) continue;
    const validFrom = edge.announcedDateIso || new Date().toISOString().slice(0, 10);
    const attrs = {
      round_type: edge.roundType,
      amount_usd: edge.amountUsd,
      announced_date: edge.announcedDateIso,
      lead_investor: edge.leadRaw,
      source: 'admin_sync_csv',
    };
    await pgClient.query(
      `INSERT INTO capital_graph_edges (
         src_type, src_id, edge_type, dst_type, dst_id, region,
         attrs_json, source, source_ref, confidence, created_by, valid_from, valid_to
       )
       VALUES (
         'investor', $1::uuid, 'LEADS_ROUND', 'startup', $2::uuid, $3,
         $4::jsonb, 'admin_sync_csv', $5, $6, 'admin-sync-startups', $7::date, $8::date
       )
       ON CONFLICT (src_type, src_id, edge_type, dst_type, dst_id, region, valid_from, valid_to)
       DO UPDATE SET
         attrs_json = capital_graph_edges.attrs_json || EXCLUDED.attrs_json,
         source = EXCLUDED.source,
         source_ref = COALESCE(EXCLUDED.source_ref, capital_graph_edges.source_ref),
         confidence = GREATEST(COALESCE(capital_graph_edges.confidence, 0), COALESCE(EXCLUDED.confidence, 0)),
         created_by = COALESCE(EXCLUDED.created_by, capital_graph_edges.created_by),
         updated_at = NOW()`,
      [
        investorId,
        edge.startupId,
        datasetRegion,
        JSON.stringify(Object.fromEntries(Object.entries(attrs).filter(([, value]) => value !== null && value !== ''))),
        `admin-sync:${edge.roundType}:${validFrom}`,
        0.85,
        validFrom,
        GRAPH_ACTIVE_VALID_TO,
      ],
    );
    stats.edgesUpserted += 1;
  }

  if (stats.edgesUpserted > 0) {
    const fnExists = await pgClient.query<{ ok: boolean }>(
      `SELECT to_regprocedure('refresh_capital_graph_views()') IS NOT NULL AS ok`,
    );
    if (Boolean(fnExists.rows[0]?.ok)) {
      await pgClient.query('SELECT refresh_capital_graph_views()');
      stats.viewsRefreshed = true;
    }
  }

  return stats;
}

// CORS configuration - allow frontend domains
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://buildatlas.net',
  'http://localhost:3000',
  'http://localhost:3002',
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    // No origin = server-to-server call (will be authenticated via API key)
    // CORS is a browser security feature, not for server-side protection
    if (!origin) {
      return callback(null, true);
    }

    // Check if origin is in allowed list or matches Azure Static Web Apps pattern
    if (
      allowedOrigins.includes(origin) ||
      origin.endsWith('.azurestaticapps.net') ||
      origin.endsWith('.azurewebsites.net')
    ) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'), false);
    }
  },
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window per IP
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  skip: (req) => {
    // Skip rate limiting for authenticated server-to-server requests (e.g. frontend SSR).
    // The frontend App Service shares a single IP, so all SSR requests would otherwise
    // share one rate-limit bucket and get throttled quickly.
    const key = req.headers['x-api-key'] as string | undefined;
    return !!key && key === API_KEY;
  },
});

// Apply rate limiting to API routes
app.use('/api/', limiter);

// Security is now handled by:
// 1. CORS - blocks browser requests from unauthorized origins
// 2. API Key - authenticates all non-health API requests
// 3. Front Door ID - ensures requests come through Azure Front Door (when configured)

// Front Door ID validation middleware (ensures requests come through Front Door)
app.use((req, res, next) => {
  // Skip health/probe endpoints (needed for K8s probes and Front Door health probes)
  if (req.path === '/health' || req.path === '/healthz' || req.path === '/readyz') {
    return next();
  }

  // Skip logo endpoints (public images, allow direct access for browser requests)
  if (req.path.match(/^\/api\/startups\/[^/]+\/logo$/)) {
    return next();
  }

  // In production, validate Front Door ID
  if (process.env.NODE_ENV === 'production') {
    const frontDoorId = req.headers['x-azure-fdid'] as string;

    if (!frontDoorId || frontDoorId !== FRONT_DOOR_ID) {
      console.warn(`Request bypassing Front Door from ${req.ip} to ${req.path}`);
      return res.status(403).json({ error: 'Forbidden: Direct access not allowed' });
    }
  }

  next();
});

// API Key authentication middleware
app.use((req, res, next) => {
  // Skip health/probe endpoints (needed for K8s probes)
  if (req.path === '/health' || req.path === '/healthz' || req.path === '/readyz') {
    return next();
  }

  // Skip logo endpoints (public images, no auth needed)
  if (req.path.match(/^\/api\/startups\/[^/]+\/logo$/)) {
    return next();
  }

  // In production, always require API key (fail-fast startup ensures API_KEY exists)
  if (process.env.NODE_ENV === 'production') {
    const providedKey = req.headers['x-api-key'] as string;

    if (!providedKey || providedKey !== API_KEY) {
      console.warn(`Unauthorized API access attempt from ${req.ip} to ${req.path}`);
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    }
  }

  next();
});

// =============================================================================
// Startups API
// =============================================================================

// List all startups with pagination
app.get('/api/v1/startups', async (req, res) => {
  try {
    const parsed = startupsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const { page, limit, region } = parsed.data;
    const offset = (page - 1) * limit;

    const results = await db.select({
      id: startups.id,
      name: startups.name,
      slug: startups.slug,
      description: startups.description,
      website: startups.website,
      foundedDate: startups.foundedDate,
      headquartersCity: startups.headquartersCity,
      headquartersCountry: startups.headquartersCountry,
      continent: startups.continent,
      industry: startups.industry,
      pattern: startups.pattern,
      stage: startups.stage,
      employeeCount: startups.employeeCount,
      genaiNative: startups.genaiNative,
      logoContentType: startups.logoContentType,
      logoUpdatedAt: startups.logoUpdatedAt,
      contentHash: startups.contentHash,
      lastCrawlAt: startups.lastCrawlAt,
      crawlSuccessRate: startups.crawlSuccessRate,
      analysisData: startups.analysisData,
      period: startups.period,
      moneyRaisedUsd: startups.moneyRaisedUsd,
      fundingStage: startups.fundingStage,
      usesGenai: startups.usesGenai,
      createdAt: startups.createdAt,
      updatedAt: startups.updatedAt,
    })
      .from(startups)
      .where(eq(startups.datasetRegion, region))
      .orderBy(desc(startups.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db.select({ total: count() })
      .from(startups)
      .where(eq(startups.datasetRegion, region));

    res.json({
      data: results,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching startups:', error);
    res.status(500).json({ error: 'Failed to fetch startups' });
  }
});

// Get single startup by ID
app.get('/api/v1/startups/:id', async (req, res) => {
  try {
    const [startup] = await db.select({
      id: startups.id,
      name: startups.name,
      slug: startups.slug,
      description: startups.description,
      website: startups.website,
      foundedDate: startups.foundedDate,
      headquartersCity: startups.headquartersCity,
      headquartersCountry: startups.headquartersCountry,
      continent: startups.continent,
      industry: startups.industry,
      pattern: startups.pattern,
      stage: startups.stage,
      employeeCount: startups.employeeCount,
      genaiNative: startups.genaiNative,
      logoContentType: startups.logoContentType,
      logoUpdatedAt: startups.logoUpdatedAt,
      contentHash: startups.contentHash,
      lastCrawlAt: startups.lastCrawlAt,
      crawlSuccessRate: startups.crawlSuccessRate,
      analysisData: startups.analysisData,
      period: startups.period,
      moneyRaisedUsd: startups.moneyRaisedUsd,
      fundingStage: startups.fundingStage,
      usesGenai: startups.usesGenai,
      createdAt: startups.createdAt,
      updatedAt: startups.updatedAt,
    })
      .from(startups)
      .where(eq(startups.id, req.params.id));

    if (!startup) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    // Get funding rounds for this startup
    const rounds = await db.select()
      .from(fundingRounds)
      .where(eq(fundingRounds.startupId, req.params.id))
      .orderBy(desc(fundingRounds.announcedDate));

    res.json({ ...startup, fundingRounds: rounds });
  } catch (error) {
    console.error('Error fetching startup:', error);
    res.status(500).json({ error: 'Failed to fetch startup' });
  }
});

// =============================================================================
// Company profile by slug (used by web company pages)
// =============================================================================

app.get('/api/v1/companies/:slug', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    if (!slug || slug.length > 255) {
      return res.status(400).json({ error: 'Invalid slug' });
    }

    const parsed = companyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const { period, region } = parsed.data;
    const cacheKey = companyBySlugKey(region, period, slug);

    // Check cache first
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          const data = safeCacheParse<{ data: unknown }>(cachedData, cacheKey, redis);
          if (data) {
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
            return res.json(data);
          }
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    res.setHeader('X-Cache', redis ? 'MISS' : 'BYPASS');

    const pf = periodFilter(period);
    const slugExpr = computedSlugExpr();

    const whereForPeriod = pf
      ? and(
          eq(startups.datasetRegion, region),
          pf,
          eq(startups.onboardingStatus, 'verified'),
          or(eq(startups.slug, slug), sql`${slugExpr} = ${slug}`),
        )
      : and(
          eq(startups.datasetRegion, region),
          eq(startups.onboardingStatus, 'verified'),
          or(eq(startups.slug, slug), sql`${slugExpr} = ${slug}`),
        );

    const baseQuery = db.select({
      id: startups.id,
      name: startups.name,
      slug: startups.slug,
      description: startups.description,
      website: startups.website,
      headquartersCity: startups.headquartersCity,
      headquartersCountry: startups.headquartersCountry,
      continent: startups.continent,
      industry: startups.industry,
      fundingStage: startups.fundingStage,
      moneyRaisedUsd: startups.moneyRaisedUsd,
      usesGenai: startups.usesGenai,
      analysisData: startups.analysisData,
      period: startups.period,
      createdAt: startups.createdAt,
      updatedAt: startups.updatedAt,
    })
      .from(startups)
      .where(whereForPeriod as any)
      .orderBy(desc(startups.period), desc(startups.updatedAt), desc(startups.createdAt))
      .limit(1);

    let rows = await baseQuery;

    // If user requested a specific period but we have none for that period, fall back to latest-any.
    if ((!rows || rows.length === 0) && period !== 'all') {
      rows = await db.select({
        id: startups.id,
        name: startups.name,
        slug: startups.slug,
        description: startups.description,
        website: startups.website,
        headquartersCity: startups.headquartersCity,
        headquartersCountry: startups.headquartersCountry,
        continent: startups.continent,
        industry: startups.industry,
        fundingStage: startups.fundingStage,
        moneyRaisedUsd: startups.moneyRaisedUsd,
        usesGenai: startups.usesGenai,
        analysisData: startups.analysisData,
        period: startups.period,
        createdAt: startups.createdAt,
        updatedAt: startups.updatedAt,
      })
        .from(startups)
        .where(
          and(
            eq(startups.datasetRegion, region),
            eq(startups.onboardingStatus, 'verified'),
            or(eq(startups.slug, slug), sql`${slugExpr} = ${slug}`),
          ) as any
        )
        .orderBy(desc(startups.period), desc(startups.updatedAt), desc(startups.createdAt))
        .limit(1);
    }

    const row = rows?.[0];
    if (!row) {
      // Check if slug is an alias for a merged/renamed startup
      const aliasRow = await db.execute(sql`
        SELECT s.slug, s.dataset_region
        FROM startup_aliases sa
        JOIN startups s ON s.id = sa.startup_id
        WHERE sa.alias = ${slug}
          AND s.dataset_region = ${region}
          AND COALESCE(s.onboarding_status, 'verified') = 'verified'
        LIMIT 1
      `);
      if (aliasRow.rows.length > 0) {
        const canonical = (aliasRow.rows[0] as any).slug;
        return res.redirect(301, `/api/v1/companies/${canonical}?period=${period}&region=${region}`);
      }
      return res.status(404).json({ error: 'Not found' });
    }

    const analysis = (row.analysisData || {}) as any;
    const resolvedSlug = row.slug || slugify(row.name);
    const location = row.headquartersCity
      ? `${row.headquartersCity}, ${row.headquartersCountry || ''}`
      : row.headquartersCountry;

    // Merge DB fields over analysis defaults for consistency.
    const data = {
      ...analysis,
      company_name: row.name,
      company_slug: resolvedSlug,
      description: row.description,
      website: row.website,
      location,
      continent: row.continent,
      industry: row.industry,
      funding_stage: row.fundingStage,
      funding_amount: row.moneyRaisedUsd,
      uses_genai: row.usesGenai,
      period: row.period,
    };

    // Cache the response
    if (redis) {
      try {
        await redis.setEx(cacheKey, CACHE_TTL.STARTUP, JSON.stringify({ data }));
      } catch (cacheErr) {
        console.error('Redis cache write error:', cacheErr);
      }
    }

    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    return res.json({ data });
  } catch (error) {
    console.error('Error fetching company by slug:', error);
    return res.status(500).json({ error: 'Failed to fetch company' });
  }
});

// Get startup logo by slug
app.get('/api/startups/:slug/logo', async (req, res) => {
  try {
    // Optional dataset region (defaults to global for backward compatibility).
    const rawRegion = String((req.query as any)?.region || '').toLowerCase().trim();
    const region = rawRegion === 'turkey' || rawRegion === 'tr' ? 'turkey' : 'global';

    const slugExpr = computedSlugExpr();
    const [startup] = await db.select({
      logoData: startups.logoData,
      logoContentType: startups.logoContentType,
    })
      .from(startups)
      .where(and(
        eq(startups.datasetRegion, region),
        or(eq(startups.slug, req.params.slug), sql`${slugExpr} = ${req.params.slug}`)
      ) as any)
      .orderBy(desc(startups.period), desc(startups.updatedAt), desc(startups.createdAt))
      .limit(1);

    if (!startup || !startup.logoData) {
      return res.status(404).json({ error: 'Logo not found' });
    }

    res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day
    res.setHeader('Content-Type', startup.logoContentType || 'image/png');
    res.send(startup.logoData);
  } catch (error) {
    console.error('Error fetching logo:', error);
    res.status(500).json({ error: 'Failed to fetch logo' });
  }
});

// Get recent news signals linked to a startup
app.get('/api/v1/startups/:slug/signals', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(20, Number(req.query.limit || 5)));
    const days = Math.max(1, Math.min(90, Number(req.query.days || 30)));

    const cacheKey = `signals:company:${req.params.slug}:${limit}:${days}`;
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          const data = safeCacheParse<unknown[]>(cached, cacheKey, redis);
          if (data) return res.json(data);
        }
      } catch { /* cache miss */ }
    }

    const signals = await newsService.getCompanySignals({
      slug: req.params.slug,
      limit,
      days,
    });

    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(signals), { EX: 300 }); } catch { /* noop */ }
    }

    res.json(signals);
  } catch (error) {
    console.error('Error fetching company signals:', error);
    res.status(500).json({ error: 'Failed to fetch signals' });
  }
});

// Get dossier event timeline for a startup
app.get('/api/v1/startups/:slug/timeline', async (req, res) => {
  try {
    const parsed = timelineQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }

    const hasQuery = !!parsed.data.query;
    const cacheKey = `timeline:${req.params.slug}:${parsed.data.region}:${parsed.data.limit}:${parsed.data.cursor || ''}:${parsed.data.domain || ''}:${parsed.data.type || ''}:${parsed.data.min_confidence || ''}:${parsed.data.query || ''}`;
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          const data = safeCacheParse<{ events: unknown[]; next_cursor: string | null }>(cached, cacheKey, redis);
          if (data) return res.json(data);
        }
      } catch { /* cache miss */ }
    }

    const result = await newsService.getCompanyTimeline({
      slug: req.params.slug,
      ...parsed.data,
    });

    if (redis) {
      // Shorter TTL for search queries to avoid cache bloat
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: hasQuery ? 60 : 300 }); } catch { /* noop */ }
    }

    res.json(result);
  } catch (error) {
    console.error('Error fetching company timeline:', error);
    res.status(500).json({ error: 'Failed to fetch timeline' });
  }
});

// =============================================================================
// Stats API
// =============================================================================

app.get('/api/v1/stats', async (req, res) => {
  try {
    const parsed = statsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const { period, region } = parsed.data;
    const cacheKey = statsKey(region, period);

    // Check cache first
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          const data = safeCacheParse(cachedData, cacheKey, redis);
          if (data) {
            res.setHeader('X-Cache', 'HIT');
            return res.json(data);
          }
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    res.setHeader('X-Cache', redis ? 'MISS' : 'BYPASS');

    const pf = periodFilter(period);
    const baseWhere = pf ? and(eq(startups.datasetRegion, region), pf) : eq(startups.datasetRegion, region);

    // Total funding (always join through startups so we can filter by dataset_region)
    const [fundingResult] = await db.select({
      total: sum(fundingRounds.amountUsd),
      count: count(),
    })
      .from(fundingRounds)
      .innerJoin(startups, eq(fundingRounds.startupId, startups.id))
      .where(baseWhere as any);

    // Startup count + GenAI count in single query
    const [countResult] = await db.select({
      startupCount: count(),
      genaiCount: sql<number>`COUNT(*) FILTER (WHERE ${startups.genaiNative} = true)`,
    }).from(startups).where(baseWhere as any);

    // Pattern distribution
    const patternDistribution = await db.select({
      pattern: startups.pattern,
      count: count(),
    })
      .from(startups)
      .where(baseWhere as any)
      .groupBy(startups.pattern);

    // Stage distribution
    const stageDistribution = await db.select({
      stage: startups.stage,
      count: count(),
    })
      .from(startups)
      .where(baseWhere as any)
      .groupBy(startups.stage);

    const responseData = {
      totalFunding: fundingResult.total || 0,
      totalDeals: fundingResult.count || 0,
      totalStartups: countResult.startupCount || 0,
      genaiNativeCount: countResult.genaiCount || 0,
      genaiAdoptionRate: countResult.startupCount > 0
        ? ((countResult.genaiCount / countResult.startupCount) * 100).toFixed(1)
        : 0,
      patternDistribution: Object.fromEntries(
        patternDistribution
          .filter(p => p.pattern != null)
          .map(p => [p.pattern, p.count])
      ),
      stageDistribution: Object.fromEntries(
        stageDistribution
          .filter(s => s.stage != null)
          .map(s => [s.stage, s.count])
      ),
    };

    // Cache the response
    if (redis) {
      try {
        await redis.setEx(cacheKey, CACHE_TTL.STATS, JSON.stringify(responseData));
      } catch (cacheErr) {
        console.error('Redis cache write error:', cacheErr);
      }
    }

    res.json(responseData);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// =============================================================================
// Periods API (Available periods ordered newest -> oldest)
// =============================================================================

app.get('/api/v1/periods', async (req, res) => {
  try {
    const parsed = periodsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }

    const { region } = parsed.data;
    const cacheKey = periodsKey(region);

    // Check cache first
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          const data = safeCacheParse(cachedData, cacheKey, redis);
          if (data) {
            res.setHeader('X-Cache', 'HIT');
            return res.json(data);
          }
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    res.setHeader('X-Cache', redis ? 'MISS' : 'BYPASS');

    const rows = await db.execute<{
      period: string;
      deal_count: string;
      total_funding: string | null;
    }>(sql`
      SELECT
        ${startups.period} AS period,
        COUNT(*)::text AS deal_count,
        COALESCE(SUM(${startups.moneyRaisedUsd}), 0)::text AS total_funding
      FROM ${startups}
      WHERE ${startups.datasetRegion} = ${region}
        AND ${startups.period} IS NOT NULL AND ${startups.period} <> ''
      GROUP BY ${startups.period}
      ORDER BY ${startups.period} DESC
    `);

    const responseData = (rows.rows || []).map((r) => ({
      period: r.period,
      deal_count: parseInt(r.deal_count, 10) || 0,
      total_funding: parseInt(r.total_funding || '0', 10) || 0,
      has_newsletter: true,
    }));

    // Cache the response
    if (redis) {
      try {
        await redis.setEx(cacheKey, CACHE_TTL.PERIODS, JSON.stringify(responseData));
      } catch (cacheErr) {
        console.error('Redis cache write error:', cacheErr);
      }
    }

    res.json(responseData);
  } catch (error) {
    console.error('Error fetching periods:', error);
    res.status(500).json({ error: 'Failed to fetch periods' });
  }
});

// =============================================================================
// Dealbook API - Paginated startups with filtering
// =============================================================================

app.get('/api/v1/dealbook', async (req, res) => {
  try {
    const parsed = dealBookQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const {
      period,
      region,
      page: pageNum,
      limit: limitNum,
      stage,
      pattern,
      continent,
      vertical,
      verticalId,
      subVerticalId,
      leafId,
      minFunding,
      maxFunding,
      usesGenai,
      sortBy,
      sortOrder,
      search,
    } = parsed.data;

    const offset = (pageNum - 1) * limitNum;

    // Build cache key from query params
    const filters = { limit: limitNum, stage, pattern, continent, vertical, verticalId, subVerticalId, leafId, minFunding, maxFunding, usesGenai, sortBy, sortOrder, search };
    const filtersHash = hashObject(filters);
    const cacheKey = dealBookKey(region, period, pageNum, filtersHash);

    // Check cache first
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          const data = safeCacheParse(cachedData, cacheKey, redis);
          if (data) {
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
            return res.json(data);
          }
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    res.setHeader('X-Cache', redis ? 'MISS' : 'BYPASS');

    const latestRoundTypeExpr = sql<string | null>`(
      SELECT fr.round_type
      FROM funding_rounds fr
      WHERE fr.startup_id = ${startups.id}
      ORDER BY fr.announced_date DESC NULLS LAST, fr.created_at DESC
      LIMIT 1
    )`;
    const effectiveStageExpr = sql<string | null>`COALESCE(${latestRoundTypeExpr}, ${startups.fundingStage})`;

    // Build WHERE conditions
    const conditions: ReturnType<typeof eq>[] = [];

    // Dataset filter (global vs regional datasets)
    conditions.push(eq(startups.datasetRegion, region));
    // Verified-only publish gate for dealbook visibility
    conditions.push(eq(startups.onboardingStatus, 'verified'));

    // Period filter (omitted when 'all')
    const pf = periodFilter(period);
    if (pf) conditions.push(pf);

    // Stage filter
    if (stage) {
      const normalizedStage = normalizeStageKey(stage);
      if (normalizedStage) {
        conditions.push(
          sql`regexp_replace(
                regexp_replace(lower(coalesce(${effectiveStageExpr}, '')), '[^a-z0-9]+', '_', 'g'),
                '^_+|_+$',
                '',
                'g'
              ) LIKE ${normalizedStage + "\%"}` as ReturnType<typeof eq>
        );
      }
    }

    // Continent filter
    if (continent) {
      conditions.push(eq(startups.continent, continent));
    }

    // Vertical filter (normalized exact match against analysis_data->>'vertical')
    if (vertical) {
      const normalizedVertical = normalizeStageKey(vertical);
      if (normalizedVertical) {
        conditions.push(
          sql`regexp_replace(
                regexp_replace(lower(coalesce(${startups.analysisData}->>'vertical', '')), '[^a-z0-9]+', '_', 'g'),
                '^_+|_+$',
                '',
                'g'
              ) = ${normalizedVertical}` as ReturnType<typeof eq>
        );
      }
    }

    // New: Flexible vertical taxonomy filters (exact match on IDs)
    if (verticalId) {
      conditions.push(
        sql`${startups.analysisData}->'vertical_taxonomy'->'primary'->>'vertical_id' = ${verticalId}` as ReturnType<typeof eq>
      );
    }
    if (subVerticalId) {
      conditions.push(
        sql`${startups.analysisData}->'vertical_taxonomy'->'primary'->>'sub_vertical_id' = ${subVerticalId}` as ReturnType<typeof eq>
      );
    }
    if (leafId) {
      conditions.push(
        sql`${startups.analysisData}->'vertical_taxonomy'->'primary'->>'leaf_id' = ${leafId}` as ReturnType<typeof eq>
      );
    }

    // Funding range filters (already validated as numbers by Zod)
    if (minFunding != null) {
      conditions.push(gte(startups.moneyRaisedUsd, minFunding));
    }
    if (maxFunding != null) {
      conditions.push(lte(startups.moneyRaisedUsd, maxFunding));
    }

    // GenAI filter
    if (usesGenai === 'true') {
      conditions.push(eq(startups.usesGenai, true));
    } else if (usesGenai === 'false') {
      conditions.push(eq(startups.usesGenai, false));
    }

    // Pattern filter (uses JSONB containment)
    let patternCondition: ReturnType<typeof sql> | null = null;
    if (pattern) {
      patternCondition = sql`${startups.analysisData}->'build_patterns' @> ${JSON.stringify([{ name: pattern }])}::jsonb`;
    }

    // Search filter — multi-field with relevance scoring
    // Escape ILIKE meta-characters in user input
    const escapedSearch = search ? search.replace(/[%_\\]/g, '\\$&') : '';
    const containsPattern = search ? `%${escapedSearch}%` : '';
    const prefixPattern = search ? `${escapedSearch}%` : '';

    if (search) {
      conditions.push(
        or(
          ilike(startups.name, containsPattern),
          ilike(startups.description, containsPattern),
          ilike(startups.industry, containsPattern),
          sql`${startups.analysisData}->>'vertical' ILIKE ${containsPattern}`,
          sql`${startups.analysisData}->>'sub_vertical' ILIKE ${containsPattern}`,
          sql`${startups.analysisData}->>'sub_sub_vertical' ILIKE ${containsPattern}`,
        ) as ReturnType<typeof eq>
      );
    }

    // Relevance score expression (only computed when search is active)
    const searchScoreExpr = search
      ? sql<number>`(
          CASE WHEN ${startups.name} ILIKE ${search} THEN 100
               WHEN ${startups.name} ILIKE ${prefixPattern} THEN 80
               WHEN ${startups.name} ILIKE ${containsPattern} THEN 60
               ELSE 0 END
          + CASE WHEN ${startups.industry} ILIKE ${containsPattern} THEN 30 ELSE 0 END
          + CASE WHEN ${startups.analysisData}->>'vertical' ILIKE ${containsPattern} THEN 20 ELSE 0 END
          + CASE WHEN ${startups.analysisData}->>'sub_vertical' ILIKE ${containsPattern} THEN 15 ELSE 0 END
          + CASE WHEN ${startups.analysisData}->>'sub_sub_vertical' ILIKE ${containsPattern} THEN 12 ELSE 0 END
          + CASE WHEN ${startups.description} ILIKE ${containsPattern} THEN 10 ELSE 0 END
        )`
      : null;

    // Combine all conditions
    const whereClause = patternCondition
      ? and(...conditions, patternCondition)
      : conditions.length > 0
        ? and(...conditions)
        : undefined;

    // Determine sort order — relevance-first when searching
    // For funding sort, use NULLS LAST so auto-discovered startups with no data don't dominate
    const defaultOrderDir = sortBy === 'funding'
      ? (sortOrder === 'asc'
          ? sql`${startups.moneyRaisedUsd} ASC NULLS LAST`
          : sql`${startups.moneyRaisedUsd} DESC NULLS LAST`)
      : sortBy === 'name'
        ? (sortOrder === 'asc' ? startups.name : desc(startups.name))
        : (sortOrder === 'asc' ? startups.createdAt : desc(startups.createdAt));
    // When user is searching, sort by relevance score first, then by the chosen sort
    const orderDir = searchScoreExpr
      ? [desc(searchScoreExpr), defaultOrderDir]
      : [defaultOrderDir];

    // Execute query with pagination - only select fields needed by frontend
    // Use SQL JSONB operators to extract specific fields instead of full JSONB
    const slugExpr = sql<string>`COALESCE(${startups.slug}, ${computedSlugExpr()})`;
    const results = await db.select({
      name: startups.name,
      slug: slugExpr,
      description: startups.description,
      website: startups.website,
      headquartersCity: startups.headquartersCity,
      headquartersCountry: startups.headquartersCountry,
      continent: startups.continent,
      industry: startups.industry,
      fundingStage: effectiveStageExpr,
      moneyRaisedUsd: startups.moneyRaisedUsd,
      usesGenai: startups.usesGenai,
      // Extract from JSONB (columns exist but aren't always populated by sync)
      vertical: sql<string | null>`${startups.analysisData}->>'vertical'`,
      marketType: sql<string | null>`${startups.analysisData}->>'market_type'`,
      subVertical: sql<string | null>`${startups.analysisData}->>'sub_vertical'`,
      subSubVertical: sql<string | null>`${startups.analysisData}->>'sub_sub_vertical'`,
      verticalTaxonomy: sql<unknown>`${startups.analysisData}->'vertical_taxonomy'`,
      buildPatterns: sql<unknown>`${startups.analysisData}->'build_patterns'`,
      confidenceScore: sql<number | null>`(${startups.analysisData}->>'confidence_score')::float`,
      newsletterPotential: sql<string | null>`${startups.analysisData}->>'newsletter_potential'`,
      // Relevance score included when search is active (0 otherwise)
      searchScore: searchScoreExpr ?? sql<number>`0`,
    })
      .from(startups)
      .where(whereClause)
      .orderBy(...orderDir)
      .limit(limitNum)
      .offset(offset);

    // Get total count for pagination
    const [countResult] = await db.select({ total: count() })
      .from(startups)
      .where(whereClause);

    const total = countResult?.total || 0;

    // Determine which field the search matched on (for frontend highlighting)
    function getSearchMatch(row: Record<string, unknown>, term: string): string | undefined {
      if (!term) return undefined;
      const t = term.toLowerCase();
      if ((row.name as string || '').toLowerCase().includes(t)) return 'name';
      if ((row.industry as string || '').toLowerCase().includes(t)) return 'industry';
      if ((row.vertical as string || '').toLowerCase().includes(t)) return 'vertical';
      if ((row.subVertical as string || '').toLowerCase().includes(t)) return 'sub_vertical';
      if ((row.subSubVertical as string || '').toLowerCase().includes(t)) return 'sub_sub_vertical';
      if ((row.description as string || '').toLowerCase().includes(t)) return 'description';
      return 'fuzzy'; // trigram match
    }

    // Transform results to match frontend StartupAnalysis interface
    const data = results.map((row) => ({
      company_name: row.name,
      company_slug: row.slug,
      description: row.description,
      website: row.website,
      location: row.headquartersCity
        ? `${row.headquartersCity}, ${row.headquartersCountry || ''}`
        : row.headquartersCountry,
      continent: row.continent,
      vertical: row.vertical,
      market_type: row.marketType,
      sub_vertical: row.subVertical,
      sub_sub_vertical: row.subSubVertical,
      vertical_taxonomy: row.verticalTaxonomy as any,
      funding_amount: row.moneyRaisedUsd,
      funding_stage: row.fundingStage,
      uses_genai: row.usesGenai,
      build_patterns: row.buildPatterns as Array<{ name: string; confidence: number }> | null,
      confidence_score: row.confidenceScore,
      newsletter_potential: row.newsletterPotential,
      ...(search ? { search_match: getSearchMatch(row as Record<string, unknown>, search) } : {}),
    }));

    // Build response
    const responseData = {
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
      filters: {
        period,
        region,
        stage: stage || null,
        pattern: pattern || null,
        continent: continent || null,
        vertical: vertical || null,
        verticalId: verticalId || null,
        subVerticalId: subVerticalId || null,
        leafId: leafId || null,
        minFunding: minFunding ?? null,
        maxFunding: maxFunding ?? null,
        usesGenai: usesGenai || null,
        search: search || null,
      },
    };

    // Cache the response
    if (redis) {
      try {
        await redis.setEx(cacheKey, CACHE_TTL.DEALBOOK, JSON.stringify(responseData));
      } catch (cacheErr) {
        console.error('Redis cache write error:', cacheErr);
      }
    }

    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    res.json(responseData);
  } catch (error) {
    console.error('Error fetching dealbook:', error);
    res.status(500).json({ error: 'Failed to fetch dealbook data' });
  }
});

// Get filter options for dealbook (available stages, patterns, continents)
app.get('/api/v1/dealbook/filters', async (req, res) => {
  try {
	    const parsed = dealBookFiltersQuerySchema.safeParse(req.query);
	    if (!parsed.success) {
	      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
	    }
	    const { period, region, verticalId, subVerticalId } = parsed.data;
	    const cacheKey = `${filterOptionsKey(region, period)}:${hashObject({ verticalId, subVerticalId })}`;

    // Check cache first
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          const data = safeCacheParse(cachedData, cacheKey, redis);
          if (data) {
            res.setHeader('X-Cache', 'HIT');
            return res.json(data);
          }
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    res.setHeader('X-Cache', redis ? 'MISS' : 'BYPASS');

	    // Get distinct stages (prefer latest funding round type, fallback to startup funding_stage)
	    const pf = periodFilter(period);
	    const baseWhere = pf
	      ? and(eq(startups.datasetRegion, region), eq(startups.onboardingStatus, 'verified'), pf)
	      : and(eq(startups.datasetRegion, region), eq(startups.onboardingStatus, 'verified'));
	    const stageRows = await db.execute<{ stage: string }>(
	      pf
	        ? sql`
	            SELECT DISTINCT COALESCE(lr.round_type, s.funding_stage) AS stage
	            FROM startups s
            LEFT JOIN LATERAL (
              SELECT fr.round_type
              FROM funding_rounds fr
              WHERE fr.startup_id = s.id
              ORDER BY fr.announced_date DESC NULLS LAST, fr.created_at DESC
              LIMIT 1
	            ) lr ON TRUE
	            WHERE ${pf}
	              AND s.dataset_region = ${region}
	              AND COALESCE(s.onboarding_status, 'verified') = 'verified'
	              AND COALESCE(lr.round_type, s.funding_stage) IS NOT NULL
	          `
	        : sql`
	            SELECT DISTINCT COALESCE(lr.round_type, s.funding_stage) AS stage
	            FROM startups s
            LEFT JOIN LATERAL (
              SELECT fr.round_type
              FROM funding_rounds fr
              WHERE fr.startup_id = s.id
              ORDER BY fr.announced_date DESC NULLS LAST, fr.created_at DESC
              LIMIT 1
	            ) lr ON TRUE
	            WHERE s.dataset_region = ${region}
	              AND COALESCE(s.onboarding_status, 'verified') = 'verified'
	              AND COALESCE(lr.round_type, s.funding_stage) IS NOT NULL
	          `
	    );

    // Get distinct continents
	    const continents = await db.selectDistinct({ continent: startups.continent })
	      .from(startups)
	      .where(and(baseWhere, sql`${startups.continent} IS NOT NULL`) as any);

    // Get pattern counts from JSONB (aggregated in SQL)
    const pf2 = periodFilter(period);
	    const patternRows = await db.execute<{ pattern: string; count: string }>(
	      pf2
	        ? sql`SELECT elem->>'name' AS pattern, COUNT(*) AS count
	              FROM startups s, jsonb_array_elements(s.analysis_data->'build_patterns') AS elem
	              WHERE ${pf2}
	                AND s.dataset_region = ${region}
	                AND COALESCE(s.onboarding_status, 'verified') = 'verified'
	                AND elem->>'name' IS NOT NULL
	              GROUP BY elem->>'name'
	              ORDER BY count DESC`
	        : sql`SELECT elem->>'name' AS pattern, COUNT(*) AS count
	              FROM startups s, jsonb_array_elements(s.analysis_data->'build_patterns') AS elem
	              WHERE s.dataset_region = ${region}
	                AND COALESCE(s.onboarding_status, 'verified') = 'verified'
	                AND elem->>'name' IS NOT NULL
	              GROUP BY elem->>'name'
	              ORDER BY count DESC`
	    );

    // Distinct verticals (legacy string field in analysis JSON)
	    const verticalRows = await db.execute<{ vertical: string }>(
	      pf2
	        ? sql`SELECT DISTINCT s.analysis_data->>'vertical' AS vertical
	              FROM startups s
	              WHERE ${pf2}
	                AND s.dataset_region = ${region}
	                AND COALESCE(s.onboarding_status, 'verified') = 'verified'
	                AND s.analysis_data->>'vertical' IS NOT NULL
	                AND s.analysis_data->>'vertical' <> ''`
	        : sql`SELECT DISTINCT s.analysis_data->>'vertical' AS vertical
	              FROM startups s
	              WHERE s.dataset_region = ${region}
	                AND COALESCE(s.onboarding_status, 'verified') = 'verified'
	                AND s.analysis_data->>'vertical' IS NOT NULL
	                AND s.analysis_data->>'vertical' <> ''`
	    );

    // New: Vertical taxonomy options (IDs + labels + counts)
	    const taxonomyVerticalRows = await db.execute<{ id: string; label: string; count: string }>(
	      pf2
	        ? sql`SELECT
	                s.analysis_data->'vertical_taxonomy'->'primary'->>'vertical_id' AS id,
	                s.analysis_data->'vertical_taxonomy'->'primary'->>'vertical_label' AS label,
	                COUNT(*) AS count
	              FROM startups s
	              WHERE ${pf2}
	                AND s.dataset_region = ${region}
	                AND COALESCE(s.onboarding_status, 'verified') = 'verified'
	                AND s.analysis_data->'vertical_taxonomy'->'primary'->>'vertical_id' IS NOT NULL
	                AND s.analysis_data->'vertical_taxonomy'->'primary'->>'vertical_id' <> ''
	              GROUP BY 1, 2
	              ORDER BY COUNT(*) DESC`
	        : sql`SELECT
	                s.analysis_data->'vertical_taxonomy'->'primary'->>'vertical_id' AS id,
	                s.analysis_data->'vertical_taxonomy'->'primary'->>'vertical_label' AS label,
	                COUNT(*) AS count
	              FROM startups s
	              WHERE s.dataset_region = ${region}
	                AND COALESCE(s.onboarding_status, 'verified') = 'verified'
	                AND s.analysis_data->'vertical_taxonomy'->'primary'->>'vertical_id' IS NOT NULL
	                AND s.analysis_data->'vertical_taxonomy'->'primary'->>'vertical_id' <> ''
	              GROUP BY 1, 2
	              ORDER BY COUNT(*) DESC`
	    );

	    const taxonomySubRows = verticalId
	      ? await db.execute<{ id: string; label: string; count: string }>(
	          pf2
	            ? sql`SELECT
	                    s.analysis_data->'vertical_taxonomy'->'primary'->>'sub_vertical_id' AS id,
	                    s.analysis_data->'vertical_taxonomy'->'primary'->>'sub_vertical_label' AS label,
	                    COUNT(*) AS count
	                  FROM startups s
	                  WHERE ${pf2}
	                    AND s.dataset_region = ${region}
	                    AND COALESCE(s.onboarding_status, 'verified') = 'verified'
	                    AND s.analysis_data->'vertical_taxonomy'->'primary'->>'vertical_id' = ${verticalId}
	                    AND s.analysis_data->'vertical_taxonomy'->'primary'->>'sub_vertical_id' IS NOT NULL
	                    AND s.analysis_data->'vertical_taxonomy'->'primary'->>'sub_vertical_id' <> ''
	                  GROUP BY 1, 2
	                  ORDER BY COUNT(*) DESC`
	            : sql`SELECT
	                    s.analysis_data->'vertical_taxonomy'->'primary'->>'sub_vertical_id' AS id,
	                    s.analysis_data->'vertical_taxonomy'->'primary'->>'sub_vertical_label' AS label,
	                    COUNT(*) AS count
	                  FROM startups s
	                  WHERE s.dataset_region = ${region}
	                    AND COALESCE(s.onboarding_status, 'verified') = 'verified'
	                    AND s.analysis_data->'vertical_taxonomy'->'primary'->>'vertical_id' = ${verticalId}
	                    AND s.analysis_data->'vertical_taxonomy'->'primary'->>'sub_vertical_id' IS NOT NULL
	                    AND s.analysis_data->'vertical_taxonomy'->'primary'->>'sub_vertical_id' <> ''
	                  GROUP BY 1, 2
	                  ORDER BY COUNT(*) DESC`
	        )
      : { rows: [] as Array<{ id: string; label: string; count: string }> };

	    const taxonomyLeafRows = subVerticalId
	      ? await db.execute<{ id: string; label: string; count: string }>(
	          pf2
	            ? sql`SELECT
	                    s.analysis_data->'vertical_taxonomy'->'primary'->>'leaf_id' AS id,
	                    s.analysis_data->'vertical_taxonomy'->'primary'->>'leaf_label' AS label,
	                    COUNT(*) AS count
	                  FROM startups s
	                  WHERE ${pf2}
	                    AND s.dataset_region = ${region}
	                    AND COALESCE(s.onboarding_status, 'verified') = 'verified'
	                    AND s.analysis_data->'vertical_taxonomy'->'primary'->>'sub_vertical_id' = ${subVerticalId}
	                    AND s.analysis_data->'vertical_taxonomy'->'primary'->>'leaf_id' IS NOT NULL
	                    AND s.analysis_data->'vertical_taxonomy'->'primary'->>'leaf_id' <> ''
	                  GROUP BY 1, 2
	                  ORDER BY COUNT(*) DESC`
	            : sql`SELECT
	                    s.analysis_data->'vertical_taxonomy'->'primary'->>'leaf_id' AS id,
	                    s.analysis_data->'vertical_taxonomy'->'primary'->>'leaf_label' AS label,
	                    COUNT(*) AS count
	                  FROM startups s
	                  WHERE s.dataset_region = ${region}
	                    AND COALESCE(s.onboarding_status, 'verified') = 'verified'
	                    AND s.analysis_data->'vertical_taxonomy'->'primary'->>'sub_vertical_id' = ${subVerticalId}
	                    AND s.analysis_data->'vertical_taxonomy'->'primary'->>'leaf_id' IS NOT NULL
	                    AND s.analysis_data->'vertical_taxonomy'->'primary'->>'leaf_id' <> ''
	                  GROUP BY 1, 2
	                  ORDER BY COUNT(*) DESC`
	        )
      : { rows: [] as Array<{ id: string; label: string; count: string }> };

    const responseData = {
      stages: Array.from(new Set((stageRows.rows || []).map(s => s.stage).filter(Boolean))).sort(),
      continents: continents.map(c => c.continent).filter(Boolean).sort(),
      patterns: (patternRows.rows || []).map((r: { pattern: string; count: string }) => ({
        name: r.pattern,
        count: parseInt(r.count, 10),
      })),
      verticals: Array.from(new Set((verticalRows.rows || []).map(v => v.vertical).filter(Boolean))).sort(),
      vertical_taxonomy: {
        verticals: (taxonomyVerticalRows.rows || []).map(r => ({ id: r.id, label: r.label, count: parseInt(r.count, 10) })),
        sub_verticals: (taxonomySubRows.rows || []).map(r => ({ id: r.id, label: r.label, count: parseInt(r.count, 10) })),
        leaves: (taxonomyLeafRows.rows || []).map(r => ({ id: r.id, label: r.label, count: parseInt(r.count, 10) })),
      },
    };

    // Cache the response
    if (redis) {
      try {
        await redis.setEx(cacheKey, CACHE_TTL.FILTERS, JSON.stringify(responseData));
      } catch (cacheErr) {
        console.error('Redis cache write error:', cacheErr);
      }
    }

    res.json(responseData);
  } catch (error) {
    console.error('Error fetching dealbook filters:', error);
    res.status(500).json({ error: 'Failed to fetch filter options' });
  }
});

// =============================================================================
// Investors API
// =============================================================================

app.get('/api/v1/investors', async (req, res) => {
  try {
    const parsed = investorsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const { page, limit: limitNum } = parsed.data;
    const offset = (page - 1) * limitNum;

    const results = await db.select()
      .from(investors)
      .orderBy(investors.name)
      .limit(limitNum)
      .offset(offset);

    const [{ total }] = await db.select({ total: count() }).from(investors);

    res.json({
      data: results,
      pagination: { page, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    console.error('Error fetching investors:', error);
    res.status(500).json({ error: 'Failed to fetch investors' });
  }
});

// =============================================================================
// News API (read-only, cached)
// =============================================================================

app.get('/api/v1/news/latest-date', async (req, res) => {
  try {
    const parsed = newsSourcesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const { region } = parsed.data;

    const cacheKey = newsLatestDateKey(region);
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          const data = safeCacheParse<{ edition_date: string | null }>(cachedData, cacheKey, redis);
          if (data) {
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=60');
            return res.json(data);
          }
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    res.setHeader('X-Cache', redis ? 'MISS' : 'BYPASS');

    const edition_date = await newsService.getLatestEditionDate({ region });
    const responseData = { edition_date };

    if (redis) {
      try {
        await redis.setEx(cacheKey, CACHE_TTL.NEWS_LATEST_DATE, JSON.stringify(responseData));
      } catch (cacheErr) {
        console.error('Redis cache write error:', cacheErr);
      }
    }

    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=60');
    return res.json(responseData);
  } catch (error) {
    console.error('Error fetching latest news edition date:', error);
    return res.status(500).json({ error: 'Failed to fetch latest news edition date' });
  }
});

app.get('/api/v1/news/latest', async (req, res) => {
  try {
    const parsed = newsLatestQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const { region, limit } = parsed.data;

    const cacheKey = newsLatestKey(region, limit);
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          if (cachedData === 'null') {
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=60');
            return res.status(404).json({ error: 'No news edition available' });
          }
          const data = safeCacheParse<unknown>(cachedData, cacheKey, redis);
          if (data !== null) {
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
            return res.json(data);
          }
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    res.setHeader('X-Cache', redis ? 'MISS' : 'BYPASS');

    const edition = await newsService.getNewsEdition({ region, limit });
    if (!edition) {
      if (redis) {
        try { await redis.setEx(cacheKey, 60, JSON.stringify(null)); } catch { /* best effort */ }
      }
      return res.status(404).json({ error: 'No news edition available' });
    }

    if (redis) {
      try { await redis.setEx(cacheKey, CACHE_TTL.NEWS_EDITION, JSON.stringify(edition)); } catch { /* best effort */ }
    }

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    return res.json(edition);
  } catch (error) {
    console.error('Error fetching latest news edition:', error);
    return res.status(500).json({ error: 'Failed to fetch latest news edition' });
  }
});

app.get('/api/v1/news', async (req, res) => {
  try {
    const parsed = newsEditionQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const { region, date, topic, limit } = parsed.data;

    const redis = await getRedisClient();

    // If no date is provided, resolve via a cached "latest-date" pointer to reduce DB pressure.
    let resolvedDate = date;
    if (!resolvedDate && redis) {
      try {
        const pointerRaw = await redis.get(newsLatestDateKey(region));
        if (pointerRaw) {
          const pointer = safeCacheParse<{ edition_date: string | null }>(pointerRaw, newsLatestDateKey(region), redis);
          if (pointer?.edition_date) {
            resolvedDate = pointer.edition_date;
          }
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    if (!resolvedDate) {
      resolvedDate = await newsService.getLatestEditionDate({ region }) || undefined;
      if (redis) {
        try {
          await redis.setEx(
            newsLatestDateKey(region),
            CACHE_TTL.NEWS_LATEST_DATE,
            JSON.stringify({ edition_date: resolvedDate || null })
          );
        } catch (cacheErr) {
          console.error('Redis cache write error:', cacheErr);
        }
      }
    }
    if (!resolvedDate) {
      return res.status(404).json({ error: 'No news edition available' });
    }

    const cacheKey = newsEditionKey({ region, date: resolvedDate, topic: topic || null, limit });
    if (redis) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          if (cachedData === 'null') {
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=60');
            return res.status(404).json({ error: 'No news edition available' });
          }
          const data = safeCacheParse<unknown>(cachedData, cacheKey, redis);
          if (data !== null) {
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
            return res.json(data);
          }
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    res.setHeader('X-Cache', redis ? 'MISS' : 'BYPASS');

    // Pass user-explicit date only — when auto-resolved, let service handle fallback for empty editions
    const edition = await newsService.getNewsEdition({ region, date: date || undefined, topic, limit });

    if (process.env.NODE_ENV !== 'production' && edition) {
      const contractResult = newsEditionOutputSchema.safeParse(edition);
      if (!contractResult.success) {
        console.warn('[news-contract] Edition output failed validation:', contractResult.error.issues);
      }
    }

    if (!edition) {
      if (redis) {
        try { await redis.setEx(cacheKey, 60, JSON.stringify(null)); } catch { /* best effort */ }
      }
      return res.status(404).json({ error: 'No news edition available' });
    }

    if (redis) {
      try { await redis.setEx(cacheKey, CACHE_TTL.NEWS_EDITION, JSON.stringify(edition)); } catch { /* best effort */ }
    }

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    return res.json(edition);
  } catch (error) {
    console.error('Error fetching news edition:', error);
    return res.status(500).json({ error: 'Failed to fetch news edition' });
  }
});

app.get('/api/v1/news/topics', async (req, res) => {
  try {
    const parsed = newsTopicsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const { region, date, limit } = parsed.data;

    const redis = await getRedisClient();

    let resolvedDate = date;
    if (!resolvedDate && redis) {
      try {
        const pointerRaw = await redis.get(newsLatestDateKey(region));
        if (pointerRaw) {
          const pointer = safeCacheParse<{ edition_date: string | null }>(pointerRaw, newsLatestDateKey(region), redis);
          if (pointer?.edition_date) resolvedDate = pointer.edition_date;
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    if (!resolvedDate) {
      resolvedDate = await newsService.getLatestEditionDate({ region }) || undefined;
      if (redis) {
        try {
          await redis.setEx(
            newsLatestDateKey(region),
            CACHE_TTL.NEWS_LATEST_DATE,
            JSON.stringify({ edition_date: resolvedDate || null })
          );
        } catch (cacheErr) {
          console.error('Redis cache write error:', cacheErr);
        }
      }
    }
    if (!resolvedDate) {
      return res.json([]);
    }

    const cacheKey = newsTopicsKey({ region, date: resolvedDate, limit });
    if (redis) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          const data = safeCacheParse<unknown>(cachedData, cacheKey, redis);
          if (data !== null) {
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
            return res.json(data);
          }
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    res.setHeader('X-Cache', redis ? 'MISS' : 'BYPASS');

    const topics = await newsService.getNewsTopics({ region, date: resolvedDate, limit });
    if (redis) {
      try { await redis.setEx(cacheKey, CACHE_TTL.NEWS_TOPICS, JSON.stringify(topics)); } catch { /* best effort */ }
    }

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    return res.json(topics);
  } catch (error) {
    console.error('Error fetching news topics:', error);
    return res.status(500).json({ error: 'Failed to fetch news topics' });
  }
});

app.get('/api/v1/news/archive', async (req, res) => {
  try {
    const parsed = newsArchiveQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const { region, limit, offset } = parsed.data;

    const cacheKey = newsArchiveKey({ region, limit, offset });
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          const data = safeCacheParse<unknown>(cachedData, cacheKey, redis);
          if (data !== null) {
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=60');
            return res.json(data);
          }
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    res.setHeader('X-Cache', redis ? 'MISS' : 'BYPASS');

    const archive = await newsService.getNewsArchive({ region, limit, offset });
    if (redis) {
      try { await redis.setEx(cacheKey, CACHE_TTL.NEWS_ARCHIVE, JSON.stringify(archive)); } catch { /* best effort */ }
    }

    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=60');
    return res.json(archive);
  } catch (error) {
    console.error('Error fetching news archive:', error);
    return res.status(500).json({ error: 'Failed to fetch news archive' });
  }
});

app.get('/api/v1/news/search', async (req, res) => {
  try {
    const parsed = newsSearchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const { q, region, limit, story_type, topic, date_from, date_to } = parsed.data;

    const cacheKey = newsSearchKey({ query: q, region, limit, story_type, topic, date_from, date_to });
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          const data = safeCacheParse<unknown>(cachedData, cacheKey, redis);
          if (data !== null) {
            res.setHeader('X-Cache', 'HIT');
            return res.json(data);
          }
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    res.setHeader('X-Cache', redis ? 'MISS' : 'BYPASS');

    const results = await newsService.searchNewsClusters({
      query: q, region, limit, story_type, topic, date_from, date_to,
    });

    if (redis) {
      try { await redis.setEx(cacheKey, CACHE_TTL.NEWS_SEARCH, JSON.stringify(results)); } catch { /* best effort */ }
    }

    return res.json(results);
  } catch (error) {
    console.error('Error searching news:', error);
    return res.status(500).json({ error: 'Search failed' });
  }
});

app.get('/api/v1/news/sources', async (req, res) => {
  try {
    const parsed = newsSourcesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const { region } = parsed.data;

    const cacheKey = newsSourcesKey(region);
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          const data = safeCacheParse<unknown>(cachedData, cacheKey, redis);
          if (data !== null) {
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=7200');
            return res.json(data);
          }
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    res.setHeader('X-Cache', redis ? 'MISS' : 'BYPASS');

    const sources = await newsService.getActiveNewsSources({ region });
    if (redis) {
      try { await redis.setEx(cacheKey, CACHE_TTL.NEWS_SOURCES, JSON.stringify(sources)); } catch { /* best effort */ }
    }

    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=7200');
    return res.json(sources);
  } catch (error) {
    console.error('Error fetching news sources:', error);
    return res.status(500).json({ error: 'Failed to fetch news sources' });
  }
});

// =============================================================================
// Periodic Briefs API (weekly / monthly, read-only, cached)
// =============================================================================

app.get('/api/v1/news/briefs/weekly', async (req, res) => {
  try {
    const parsed = newsBriefQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const { region } = parsed.data;

    const cacheKey = newsBriefKey({ region, periodType: 'weekly' });
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          if (cachedData === 'null') {
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=1800');
            return res.status(404).json({ error: 'No weekly brief available' });
          }
          const data = safeCacheParse<unknown>(cachedData, cacheKey, redis);
          if (data !== null) {
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
            return res.json(data);
          }
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    res.setHeader('X-Cache', redis ? 'MISS' : 'BYPASS');

    const brief = await newsService.getPeriodicBrief({ region, periodType: 'weekly' });
    if (!brief) {
      if (redis) {
        try { await redis.setEx(cacheKey, 300, JSON.stringify(null)); } catch { /* best effort */ }
      }
      return res.status(404).json({ error: 'No weekly brief available' });
    }

    if (redis) {
      try { await redis.setEx(cacheKey, CACHE_TTL.NEWS_BRIEF, JSON.stringify(brief)); } catch { /* best effort */ }
    }
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
    return res.json(brief);
  } catch (error) {
    console.error('Error fetching weekly brief:', error);
    return res.status(500).json({ error: 'Failed to fetch weekly brief' });
  }
});

app.get('/api/v1/news/briefs/weekly/:date', async (req, res) => {
  try {
    const dateParam = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return res.status(400).json({ error: 'Invalid date format, expected YYYY-MM-DD' });
    }
    const parsed = newsBriefQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const { region } = parsed.data;

    const cacheKey = newsBriefKey({ region, periodType: 'weekly', date: dateParam });
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          if (cachedData === 'null') {
            res.setHeader('X-Cache', 'HIT');
            return res.status(404).json({ error: 'Weekly brief not found for this date' });
          }
          const data = safeCacheParse<unknown>(cachedData, cacheKey, redis);
          if (data !== null) {
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
            return res.json(data);
          }
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    res.setHeader('X-Cache', redis ? 'MISS' : 'BYPASS');

    const brief = await newsService.getPeriodicBrief({ region, periodType: 'weekly', date: dateParam });
    if (!brief) {
      if (redis) {
        try { await redis.setEx(cacheKey, 300, JSON.stringify(null)); } catch { /* best effort */ }
      }
      return res.status(404).json({ error: 'Weekly brief not found for this date' });
    }

    if (redis) {
      try { await redis.setEx(cacheKey, CACHE_TTL.NEWS_BRIEF, JSON.stringify(brief)); } catch { /* best effort */ }
    }
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.json(brief);
  } catch (error) {
    console.error('Error fetching weekly brief by date:', error);
    return res.status(500).json({ error: 'Failed to fetch weekly brief' });
  }
});

app.get('/api/v1/news/briefs/monthly', async (req, res) => {
  try {
    const parsed = newsBriefQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const { region } = parsed.data;

    const cacheKey = newsBriefKey({ region, periodType: 'monthly' });
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          if (cachedData === 'null') {
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=1800');
            return res.status(404).json({ error: 'No monthly brief available' });
          }
          const data = safeCacheParse<unknown>(cachedData, cacheKey, redis);
          if (data !== null) {
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
            return res.json(data);
          }
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    res.setHeader('X-Cache', redis ? 'MISS' : 'BYPASS');

    const brief = await newsService.getPeriodicBrief({ region, periodType: 'monthly' });
    if (!brief) {
      if (redis) {
        try { await redis.setEx(cacheKey, 300, JSON.stringify(null)); } catch { /* best effort */ }
      }
      return res.status(404).json({ error: 'No monthly brief available' });
    }

    if (redis) {
      try { await redis.setEx(cacheKey, CACHE_TTL.NEWS_BRIEF, JSON.stringify(brief)); } catch { /* best effort */ }
    }
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
    return res.json(brief);
  } catch (error) {
    console.error('Error fetching monthly brief:', error);
    return res.status(500).json({ error: 'Failed to fetch monthly brief' });
  }
});

app.get('/api/v1/news/briefs/monthly/:date', async (req, res) => {
  try {
    const dateParam = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return res.status(400).json({ error: 'Invalid date format, expected YYYY-MM-DD' });
    }
    const parsed = newsBriefQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const { region } = parsed.data;

    const cacheKey = newsBriefKey({ region, periodType: 'monthly', date: dateParam });
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          if (cachedData === 'null') {
            res.setHeader('X-Cache', 'HIT');
            return res.status(404).json({ error: 'Monthly brief not found for this date' });
          }
          const data = safeCacheParse<unknown>(cachedData, cacheKey, redis);
          if (data !== null) {
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
            return res.json(data);
          }
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    res.setHeader('X-Cache', redis ? 'MISS' : 'BYPASS');

    const brief = await newsService.getPeriodicBrief({ region, periodType: 'monthly', date: dateParam });
    if (!brief) {
      if (redis) {
        try { await redis.setEx(cacheKey, 300, JSON.stringify(null)); } catch { /* best effort */ }
      }
      return res.status(404).json({ error: 'Monthly brief not found for this date' });
    }

    if (redis) {
      try { await redis.setEx(cacheKey, CACHE_TTL.NEWS_BRIEF, JSON.stringify(brief)); } catch { /* best effort */ }
    }
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.json(brief);
  } catch (error) {
    console.error('Error fetching monthly brief by date:', error);
    return res.status(500).json({ error: 'Failed to fetch monthly brief' });
  }
});

app.get('/api/v1/news/briefs/archive', async (req, res) => {
  try {
    const parsed = newsBriefArchiveQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const { region, type, limit, offset } = parsed.data;

    const cacheKey = newsBriefArchiveKey({ region, periodType: type, limit, offset });
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          const data = safeCacheParse<unknown>(cachedData, cacheKey, redis);
          if (data !== null) {
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=7200');
            return res.json(data);
          }
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    res.setHeader('X-Cache', redis ? 'MISS' : 'BYPASS');

    const archive = await newsService.getPeriodicBriefArchive({ region, periodType: type, limit, offset });
    if (redis) {
      try { await redis.setEx(cacheKey, CACHE_TTL.NEWS_BRIEF_ARCHIVE, JSON.stringify(archive)); } catch { /* best effort */ }
    }

    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=7200');
    return res.json(archive);
  } catch (error) {
    console.error('Error fetching brief archive:', error);
    return res.status(500).json({ error: 'Failed to fetch brief archive' });
  }
});

// =============================================================================
// News Signals API (upvote / save / hide / not_useful)
// =============================================================================

app.post('/api/v1/news/signals', async (req, res) => {
  try {
    const parsed = newsSignalToggleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }
    const { cluster_id, action_type, user_id, anon_id } = parsed.data;
    const result = await newsService.toggleSignal({ cluster_id, action_type, user_id, anon_id });
    return res.json(result);
  } catch (error) {
    console.error('Error toggling news signal:', error);
    return res.status(500).json({ error: 'Failed to toggle signal' });
  }
});

app.post('/api/v1/news/signals/batch', async (req, res) => {
  try {
    const parsed = newsSignalBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }
    const { cluster_ids, user_id, anon_id } = parsed.data;
    const signals = await newsService.getUserSignals({ cluster_ids, user_id, anon_id });
    return res.json(signals);
  } catch (error) {
    console.error('Error fetching user signals:', error);
    return res.status(500).json({ error: 'Failed to fetch signals' });
  }
});

// =============================================================================
// SIGNAL INTELLIGENCE API (service: signalsService)
// =============================================================================

// GET /api/v1/signals — List signals with filtering
app.get('/api/v1/signals', async (req, res) => {
  try {
    const parsed = signalsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }

    const { region, status, domain, sector, sort, window, limit, offset } = parsed.data;
    const cacheKey = `signals:list:${region || 'global'}:${status || 'all'}:${domain || 'all'}:${sector || 'all'}:${sort}:${window || 'all'}:${limit}:${offset}`;

    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          res.setHeader('X-Cache', 'HIT');
          return res.json(JSON.parse(cached));
        }
      } catch { /* noop */ }
    }

    const result = await signalsService.getSignalsList({ region, status, domain, sector, sort, window, limit, offset });

    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: 300 }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching signals:', error);
    return res.status(500).json({ error: 'Failed to fetch signals' });
  }
});

// GET /api/v1/signals/summary — Dashboard summary (rising/established/decaying)
app.get('/api/v1/signals/summary', async (req, res) => {
  try {
    const parsed = signalsSummaryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }

    const { region, sector, window } = parsed.data;
    const cacheKey = `signals:summary:${region || 'global'}:${sector || 'all'}:${window || 'all'}`;

    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          res.setHeader('X-Cache', 'HIT');
          return res.json(JSON.parse(cached));
        }
      } catch { /* noop */ }
    }

    const result = await signalsService.getSignalsSummary({ region, sector, window });

    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: 300 }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching signals summary:', error);
    return res.status(500).json({ error: 'Failed to fetch signals summary' });
  }
});

// GET /api/v1/signals/similar-companies — Find startups with similar architecture profiles
// MUST be registered before /api/v1/signals/:id to avoid matching as :id param
app.get('/api/v1/signals/similar-companies', async (req, res) => {
  try {
    const startupId = req.query.startup_id as string;
    if (!startupId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(startupId)) {
      return res.status(400).json({ error: 'Invalid startup_id (must be UUID)' });
    }

    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 10, 20));
    const cacheKey = `signals:similar:${startupId}:${limit}`;
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          res.setHeader('X-Cache', 'HIT');
          return res.json(JSON.parse(cached));
        }
      } catch { /* noop */ }
    }

    const result = await signalsService.getSimilarCompanies({ startupId, limit });

    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: 600 }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching similar companies:', error);
    return res.status(500).json({ error: 'Failed to fetch similar companies' });
  }
});

// NO CACHE — user-specific endpoint
// GET /api/v1/signals/follows — Get user's followed signal IDs
// MUST be registered before /api/v1/signals/:id
app.get('/api/v1/signals/follows', async (req, res) => {
  try {
    const userId = req.query.user_id as string;
    if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      return res.status(400).json({ error: 'Invalid user_id (must be UUID)' });
    }
    const result = await signalsService.getUserSignalFollows({ userId });
    res.json(result);
  } catch (error) {
    console.error('Error fetching signal follows:', error);
    return res.status(500).json({ error: 'Failed to fetch signal follows' });
  }
});

// NO CACHE — user-specific endpoint
// GET /api/v1/signals/recommendations — Recommend signals to follow
// MUST be registered before /api/v1/signals/:id
app.get('/api/v1/signals/recommendations', async (req, res) => {
  try {
    const userId = req.query.user_id as string;
    if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      return res.status(400).json({ error: 'Invalid user_id (must be UUID)' });
    }
    const region = req.query.region as string | undefined;
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 12) : 6;
    const result = await signalsService.getSignalRecommendations({ userId, region, limit });
    res.json(result);
  } catch (error) {
    console.error('Error fetching signal recommendations:', error);
    return res.status(500).json({ error: 'Failed to fetch signal recommendations' });
  }
});

// NO CACHE — user-specific endpoint
// GET /api/v1/signals/updates — Count new/changed signals since timestamp
// MUST be registered before /api/v1/signals/:id
app.get('/api/v1/signals/updates', async (req, res) => {
  try {
    const since = req.query.since as string;
    const region = req.query.region as string | undefined;
    if (!since) {
      return res.status(400).json({ error: 'since query parameter is required (ISO timestamp)' });
    }
    const result = await signalsService.getSignalUpdates({ since, region });
    res.json(result);
  } catch (error) {
    console.error('Error fetching signal updates:', error);
    return res.status(500).json({ error: 'Failed to fetch signal updates' });
  }
});

// NO CACHE — user-specific endpoint
// POST /api/v1/signals/:id/follow — Toggle follow on a signal
app.post('/api/v1/signals/:id/follow', async (req, res) => {
  try {
    const signalId = req.params.id;
    if (!signalId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(signalId)) {
      return res.status(400).json({ error: 'Invalid signal ID' });
    }
    const userId = req.body?.user_id as string;
    if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      return res.status(400).json({ error: 'Invalid user_id (must be UUID)' });
    }
    const result = await signalsService.toggleSignalFollow({ userId, signalId });
    res.json(result);
  } catch (error) {
    console.error('Error toggling signal follow:', error);
    return res.status(500).json({ error: 'Failed to toggle signal follow' });
  }
});

// NO CACHE — user-specific endpoint
// PATCH /api/v1/signals/seen — Update user's last_seen_signals_at timestamp
// MUST be registered before /api/v1/signals/:id
app.patch('/api/v1/signals/seen', async (req, res) => {
  try {
    const userId = req.body?.user_id as string;
    if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      return res.status(400).json({ error: 'Invalid user_id (must be UUID)' });
    }
    await signalsService.markSignalsSeen({ userId });
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking signals seen:', error);
    return res.status(500).json({ error: 'Failed to mark signals seen' });
  }
});

// =============================================================================
// SIGNAL DEEP DIVES (service: deepDivesService)
// MUST be registered BEFORE /api/v1/signals/:id to avoid matching
// =============================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/v1/deep-dives — List all available deep dives
app.get('/api/v1/deep-dives', async (req, res) => {
  try {
    const parsed = deepDiveListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }

    const cacheKey = `deep-dives:list:${parsed.data.region || 'all'}:${parsed.data.limit}`;
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(JSON.parse(cached)); }
      } catch { /* noop */ }
    }

    const result = await deepDivesService.listDeepDives({
      region: parsed.data.region || undefined,
      limit: parsed.data.limit,
    });

    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: 900 }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error listing deep dives:', error);
    return res.status(500).json({ error: 'Failed to list deep dives' });
  }
});

// GET /api/v1/signals/:id/deep-dive — Latest deep dive for a signal
app.get('/api/v1/signals/:id/deep-dive', async (req, res) => {
  try {
    const signalId = req.params.id;
    if (!signalId || !UUID_REGEX.test(signalId)) {
      return res.status(400).json({ error: 'Invalid signal ID' });
    }

    const cacheKey = `deep-dive:${signalId}:latest`;
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(JSON.parse(cached)); }
      } catch { /* noop */ }
    }

    const result = await deepDivesService.getLatestDeepDive(signalId);
    if (!result.signal) {
      return res.status(404).json({ error: 'Signal not found' });
    }

    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: 900 }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching deep dive:', error);
    return res.status(500).json({ error: 'Failed to fetch deep dive' });
  }
});

// GET /api/v1/signals/:id/deep-dive/v/:version — Specific version
app.get('/api/v1/signals/:id/deep-dive/v/:version', async (req, res) => {
  try {
    const signalId = req.params.id;
    if (!signalId || !UUID_REGEX.test(signalId)) {
      return res.status(400).json({ error: 'Invalid signal ID' });
    }
    const parsed = deepDiveVersionQuerySchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid version', details: parsed.error.issues });
    }

    const cacheKey = `deep-dive:${signalId}:v${parsed.data.version}`;
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(JSON.parse(cached)); }
      } catch { /* noop */ }
    }

    const result = await deepDivesService.getDeepDiveVersion(signalId, parsed.data.version);
    if (!result) {
      return res.status(404).json({ error: 'Deep dive version not found' });
    }

    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: 3600 }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching deep dive version:', error);
    return res.status(500).json({ error: 'Failed to fetch deep dive version' });
  }
});

// GET /api/v1/signals/:id/deep-dive/versions — Version history + diffs
app.get('/api/v1/signals/:id/deep-dive/versions', async (req, res) => {
  try {
    const signalId = req.params.id;
    if (!signalId || !UUID_REGEX.test(signalId)) {
      return res.status(400).json({ error: 'Invalid signal ID' });
    }

    const cacheKey = `deep-dive:${signalId}:versions`;
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(JSON.parse(cached)); }
      } catch { /* noop */ }
    }

    const result = await deepDivesService.getVersionHistory(signalId);

    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: 900 }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching deep dive versions:', error);
    return res.status(500).json({ error: 'Failed to fetch version history' });
  }
});

// GET /api/v1/signals/:id/occurrences — Per-startup scores
app.get('/api/v1/signals/:id/occurrences', async (req, res) => {
  try {
    const signalId = req.params.id;
    if (!signalId || !UUID_REGEX.test(signalId)) {
      return res.status(400).json({ error: 'Invalid signal ID' });
    }
    const parsed = occurrencesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }

    const cacheKey = `deep-dive:${signalId}:occ:${parsed.data.limit}:${parsed.data.offset}`;
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(JSON.parse(cached)); }
      } catch { /* noop */ }
    }

    const result = await deepDivesService.getOccurrences(signalId, parsed.data.limit, parsed.data.offset);

    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: 600 }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching occurrences:', error);
    return res.status(500).json({ error: 'Failed to fetch occurrences' });
  }
});

// GET /api/v1/signals/:id/moves — Extracted moves
app.get('/api/v1/signals/:id/moves', async (req, res) => {
  try {
    const signalId = req.params.id;
    if (!signalId || !UUID_REGEX.test(signalId)) {
      return res.status(400).json({ error: 'Invalid signal ID' });
    }
    const parsed = movesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }

    const cacheKey = `deep-dive:${signalId}:moves:${parsed.data.startup_id || 'all'}:${parsed.data.limit}`;
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(JSON.parse(cached)); }
      } catch { /* noop */ }
    }

    const result = await deepDivesService.getMoves(signalId, {
      startup_id: parsed.data.startup_id || undefined,
      limit: parsed.data.limit,
    });

    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: 600 }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching moves:', error);
    return res.status(500).json({ error: 'Failed to fetch moves' });
  }
});

// GET /api/v1/signals/:id — Signal detail with evidence (supports pagination)
app.get('/api/v1/signals/:id', async (req, res) => {
  try {
    const signalId = req.params.id;
    if (!signalId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(signalId)) {
      return res.status(400).json({ error: 'Invalid signal ID' });
    }

    const evidenceOffset = parseInt(req.query.evidence_offset as string) || 0;
    const evidenceLimit = parseInt(req.query.evidence_limit as string) || 10;

    // Only cache first page (no offset) to avoid cache bloat
    const isCacheable = evidenceOffset === 0;
    const cacheKey = `signals:detail:${signalId}:${evidenceLimit}`;
    const redis = await getRedisClient();

    if (isCacheable && redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          res.setHeader('X-Cache', 'HIT');
          return res.json(JSON.parse(cached));
        }
      } catch { /* noop */ }
    }

    const result = await signalsService.getSignalDetail({
      id: signalId,
      evidence_offset: evidenceOffset,
      evidence_limit: evidenceLimit,
    });
    if (!result.signal) {
      return res.status(404).json({ error: 'Signal not found' });
    }

    if (isCacheable && redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: 300 }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching signal detail:', error);
    return res.status(500).json({ error: 'Failed to fetch signal detail' });
  }
});

// =============================================================================
// MOVERS / CHANGEFEED API
// =============================================================================

app.get('/api/v1/movers', async (req, res) => {
  try {
    const parsed = moversFeedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const params = parsed.data;
    const cacheKey = `movers:feed:${params.region}:${params.delta_type || 'all'}:${params.domain || 'all'}:${params.sector || 'all'}:${params.period || 'all'}:${params.startup_id || 'all'}:${params.min_magnitude ?? 'any'}:${params.limit}:${params.offset}`;

    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          res.setHeader('X-Cache', 'HIT');
          return res.json(JSON.parse(cached));
        }
      } catch { /* noop */ }
    }

    const result = await moversService.getDeltaFeed(params);
    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: CACHE_TTL.MOVERS_FEED }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching movers feed:', error);
    return res.status(500).json({ error: 'Failed to fetch movers feed' });
  }
});

app.get('/api/v1/movers/summary', async (req, res) => {
  try {
    const parsed = moversSummaryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const params = parsed.data;
    const cacheKey = `movers:summary:${params.region}:${params.sector || 'all'}:${params.period || 'all'}:${params.limit}`;

    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          res.setHeader('X-Cache', 'HIT');
          return res.json(JSON.parse(cached));
        }
      } catch { /* noop */ }
    }

    const result = await moversService.getMoversSummary(params);
    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: CACHE_TTL.MOVERS_SUMMARY }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching movers summary:', error);
    return res.status(500).json({ error: 'Failed to fetch movers summary' });
  }
});

app.get('/api/v1/movers/unread', async (req, res) => {
  try {
    const parsed = moversUnreadQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const result = await moversService.getUnreadCount({
      userId: parsed.data.user_id,
      region: parsed.data.region,
    });
    res.json(result);
  } catch (error) {
    console.error('Error fetching unread count:', error);
    return res.status(500).json({ error: 'Failed to fetch unread count' });
  }
});

app.patch('/api/v1/movers/seen', async (req, res) => {
  try {
    const parsed = moversSeenSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }
    await moversService.markFeedSeen({
      userId: parsed.data.user_id,
      region: parsed.data.region,
      seenAt: parsed.data.seen_at,
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error marking feed seen:', error);
    return res.status(500).json({ error: 'Failed to mark feed seen' });
  }
});

app.get('/api/v1/companies/:slug/deltas', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    if (!slug || slug.length > 255) {
      return res.status(400).json({ error: 'Invalid slug' });
    }
    const parsed = startupDeltasQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const cacheKey = `movers:startup:${slug}:${parsed.data.region}:${parsed.data.limit}`;
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          res.setHeader('X-Cache', 'HIT');
          return res.json(JSON.parse(cached));
        }
      } catch { /* noop */ }
    }

    const events = await moversService.getStartupDeltas({
      startupSlug: slug,
      region: parsed.data.region,
      limit: parsed.data.limit,
    });
    const result = { events };
    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: CACHE_TTL.MOVERS_FEED }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching startup deltas:', error);
    return res.status(500).json({ error: 'Failed to fetch startup deltas' });
  }
});

app.get('/api/v1/companies/:slug/neighbors', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    if (!slug || slug.length > 255) {
      return res.status(400).json({ error: 'Invalid slug' });
    }
    const parsed = startupNeighborsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const cacheKey = `neighbors:${parsed.data.region}:${slug}:${parsed.data.period || 'latest'}:${parsed.data.limit}`;
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          res.setHeader('X-Cache', 'HIT');
          return res.json(JSON.parse(cached));
        }
      } catch { /* noop */ }
    }

    // Resolve slug to startup ID
    const startupResult = await pool.query(
      `SELECT id FROM startups WHERE slug = $1 AND dataset_region = $2 LIMIT 1`,
      [slug, parsed.data.region],
    );
    if (!startupResult.rows[0]) {
      return res.status(404).json({ error: 'Startup not found' });
    }
    const startupId = startupResult.rows[0].id;

    const result = await signalsService.getStartupNeighbors({
      startupId,
      period: parsed.data.period,
      limit: parsed.data.limit,
    });
    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: CACHE_TTL.NEIGHBORS }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching startup neighbors:', error);
    return res.status(500).json({ error: 'Failed to fetch startup neighbors' });
  }
});

app.get('/api/v1/companies/:slug/benchmarks', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    if (!slug || slug.length > 255) {
      return res.status(400).json({ error: 'Invalid slug' });
    }
    const parsed = startupBenchmarksQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const cacheKey = `benchmarks:${parsed.data.region}:${slug}:${parsed.data.period || 'latest'}`;
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          res.setHeader('X-Cache', 'HIT');
          return res.json(JSON.parse(cached));
        }
      } catch { /* noop */ }
    }

    // Resolve slug to startup ID
    const startupResult = await pool.query(
      `SELECT id FROM startups WHERE slug = $1 AND dataset_region = $2 LIMIT 1`,
      [slug, parsed.data.region],
    );
    if (!startupResult.rows[0]) {
      return res.status(404).json({ error: 'Startup not found' });
    }
    const startupId = startupResult.rows[0].id;

    const result = await signalsService.getStartupBenchmarks({
      startupId,
      period: parsed.data.period,
      region: parsed.data.region,
    });
    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: CACHE_TTL.BENCHMARKS }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching startup benchmarks:', error);
    return res.status(500).json({ error: 'Failed to fetch startup benchmarks' });
  }
});

// =============================================================================
// BENCHMARKS (standalone page)
// =============================================================================

app.get('/api/v1/benchmarks', async (req, res) => {
  try {
    const parsed = benchmarksQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const cacheKey = `benchmarks:list:${parsed.data.region}:${parsed.data.cohort_type || 'all'}:${parsed.data.cohort_key || 'all'}:${parsed.data.sector || 'all'}:${parsed.data.period || 'latest'}:${parsed.data.metric || 'all'}`;
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(JSON.parse(cached)); }
      } catch { /* noop */ }
    }
    // Translate sector into cohort_type/cohort_key if no explicit cohort provided
    const params = { ...parsed.data };
    if (params.sector && !params.cohort_key) {
      const sectorDef = findSector(params.sector);
      if (sectorDef) {
        params.cohort_type = 'vertical';
        // Use the first verticalId or subVerticalId as cohort key
        const vertKey = sectorDef.verticalIds[0] || sectorDef.subVerticalIds[0];
        if (vertKey) params.cohort_key = `vertical:${vertKey}`;
      }
    }
    const result = await benchmarksService.getBenchmarks(params);
    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: CACHE_TTL.BENCHMARKS }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching benchmarks:', error);
    return res.status(500).json({ error: 'Failed to fetch benchmarks' });
  }
});

app.get('/api/v1/benchmarks/compare', async (req, res) => {
  try {
    const parsed = benchmarksCompareQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const cacheKey = `benchmarks:compare:${parsed.data.startup_id}:${parsed.data.region}:${parsed.data.period || 'latest'}`;
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(JSON.parse(cached)); }
      } catch { /* noop */ }
    }
    const result = await benchmarksService.getCompare(parsed.data);
    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: CACHE_TTL.BENCHMARKS }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching benchmark compare:', error);
    return res.status(500).json({ error: 'Failed to fetch benchmark compare' });
  }
});

app.get('/api/v1/benchmarks/cohorts', async (req, res) => {
  try {
    const parsed = benchmarksCohortQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const cacheKey = `benchmarks:cohorts:${parsed.data.region}:${parsed.data.period || 'latest'}`;
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(JSON.parse(cached)); }
      } catch { /* noop */ }
    }
    const result = await benchmarksService.getCohorts(parsed.data);
    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: CACHE_TTL.BENCHMARKS }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching benchmark cohorts:', error);
    return res.status(500).json({ error: 'Failed to fetch benchmark cohorts' });
  }
});

// =============================================================================
// INVESTOR DNA
// =============================================================================

app.get('/api/v1/investors/screener', async (req, res) => {
  try {
    const parsed = investorScreenerQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const cacheKey = `investors:screener:${parsed.data.scope}:${parsed.data.pattern || 'all'}:${parsed.data.stage || 'all'}:${parsed.data.min_deals}:${parsed.data.sort}:${parsed.data.limit}:${parsed.data.offset}`;
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(JSON.parse(cached)); }
      } catch { /* noop */ }
    }
    const result = await investorsService.screener(parsed.data);
    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: CACHE_TTL.BENCHMARKS }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching investor screener:', error);
    return res.status(500).json({ error: 'Failed to fetch investor screener' });
  }
});

app.get('/api/v1/investors/:id/dna', async (req, res) => {
  try {
    const investorId = String(req.params.id || '').trim();
    if (!investorId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(investorId)) {
      return res.status(400).json({ error: 'Invalid investor ID (must be UUID)' });
    }
    const parsed = investorDnaQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const cacheKey = `investors:dna:${investorId}:${parsed.data.scope}:${parsed.data.window}`;
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(JSON.parse(cached)); }
      } catch { /* noop */ }
    }
    const result = await investorsService.getDNA({ investorId, ...parsed.data });
    if (!result) {
      return res.status(404).json({ error: 'Investor not found' });
    }
    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: CACHE_TTL.BENCHMARKS }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching investor DNA:', error);
    return res.status(500).json({ error: 'Failed to fetch investor DNA' });
  }
});

app.get('/api/v1/investors/:id/portfolio', async (req, res) => {
  try {
    const investorId = String(req.params.id || '').trim();
    if (!investorId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(investorId)) {
      return res.status(400).json({ error: 'Invalid investor ID (must be UUID)' });
    }
    const parsed = investorPortfolioQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const cacheKey = `investors:portfolio:${investorId}:${parsed.data.scope}:${parsed.data.limit}:${parsed.data.offset}`;
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(JSON.parse(cached)); }
      } catch { /* noop */ }
    }
    const result = await investorsService.getPortfolio({ investorId, ...parsed.data });
    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: CACHE_TTL.BENCHMARKS }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching investor portfolio:', error);
    return res.status(500).json({ error: 'Failed to fetch investor portfolio' });
  }
});

app.post('/api/v1/news/signals/merge', async (req, res) => {
  try {
    const parsed = newsSignalMergeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }
    const { user_id, anon_id } = parsed.data;
    const result = await newsService.mergeAnonSignals({ user_id, anon_id });
    return res.json(result);
  } catch (error) {
    console.error('Error merging news signals:', error);
    return res.status(500).json({ error: 'Failed to merge signals' });
  }
});

app.get('/api/v1/investors/:id/network', async (req, res) => {
  try {
    const investorId = String(req.params.id || '').trim();
    if (!investorId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(investorId)) {
      return res.status(400).json({ error: 'Invalid investor ID (must be UUID)' });
    }
    const parsed = investorNetworkQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }

    const cacheKey = `investors:network:${investorId}:${parsed.data.scope}:${parsed.data.depth}:${parsed.data.limit}`;
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(JSON.parse(cached)); }
      } catch { /* noop */ }
    }

    const result = await investorsService.getNetwork({ investorId, ...parsed.data });
    if (!result) {
      return res.status(404).json({ error: 'Investor not found' });
    }

    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: CACHE_TTL.BENCHMARKS }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching investor network:', error);
    return res.status(500).json({ error: 'Failed to fetch investor network' });
  }
});

app.get('/api/v1/startups/:id/investors', async (req, res) => {
  try {
    const startupId = String(req.params.id || '').trim();
    if (!startupId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(startupId)) {
      return res.status(400).json({ error: 'Invalid startup ID (must be UUID)' });
    }
    const parsed = startupInvestorsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }

    const cacheKey = `startups:investors:${startupId}:${parsed.data.scope}:${parsed.data.limit}:${parsed.data.offset}`;
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(JSON.parse(cached)); }
      } catch { /* noop */ }
    }

    const result = await investorsService.getStartupInvestors({
      startupId,
      scope: parsed.data.scope,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: CACHE_TTL.BENCHMARKS }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching startup investors:', error);
    return res.status(500).json({ error: 'Failed to fetch startup investors' });
  }
});

app.get('/api/v1/startups/:id/founders', async (req, res) => {
  try {
    const startupId = String(req.params.id || '').trim();
    if (!startupId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(startupId)) {
      return res.status(400).json({ error: 'Invalid startup ID (must be UUID)' });
    }

    const parsed = startupFoundersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }

    let normalizedRows: { rows: any[] } = { rows: [] };
    try {
      normalizedRows = await pool.query(
        `SELECT
            f.id::text AS founder_id,
            f.full_name,
            f.slug,
            f.linkedin_url,
            f.x_url,
            f.website,
            f.bio,
            f.primary_country,
            sf.role,
            sf.is_current,
            sf.start_date::text,
            sf.end_date::text,
            sf.ownership_pct,
            sf.confidence,
            sf.source
         FROM startup_founders sf
         JOIN founders f ON f.id = sf.founder_id
         JOIN startups s ON s.id = sf.startup_id
         WHERE sf.startup_id = $1::uuid
           AND s.dataset_region = $2
         ORDER BY sf.is_current DESC, sf.created_at ASC`,
        [startupId, parsed.data.scope],
      );
    } catch (error: any) {
      if (error?.code !== '42P01') throw error;
    }

    if (normalizedRows.rows.length > 0) {
      return res.json({
        startup_id: startupId,
        scope: parsed.data.scope,
        source: 'normalized',
        founders: normalizedRows.rows,
      });
    }

    const fallback = await pool.query(
      `SELECT analysis_data
       FROM startups
       WHERE id = $1::uuid
         AND dataset_region = $2
       LIMIT 1`,
      [startupId, parsed.data.scope],
    );

    const analysisData = fallback.rows[0]?.analysis_data || {};
    const founders = (analysisData?.team_analysis?.founders || []) as unknown[];

    return res.json({
      startup_id: startupId,
      scope: parsed.data.scope,
      source: 'analysis_data',
      founders,
    });
  } catch (error) {
    console.error('Error fetching startup founders:', error);
    return res.status(500).json({ error: 'Failed to fetch startup founders' });
  }
});

app.get('/api/v1/founders/:id', async (req, res) => {
  try {
    const founderId = String(req.params.id || '').trim();
    if (!founderId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(founderId)) {
      return res.status(400).json({ error: 'Invalid founder ID (must be UUID)' });
    }

    const parsed = startupFoundersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }

    let founderResult: { rows: any[] };
    try {
      founderResult = await pool.query(
        `SELECT
            id::text,
            full_name,
            slug,
            linkedin_url,
            x_url,
            website,
            bio,
            primary_country,
            source,
            created_at,
            updated_at
         FROM founders
         WHERE id = $1::uuid
         LIMIT 1`,
        [founderId],
      );
    } catch (error: any) {
      if (error?.code === '42P01') {
        return res.status(503).json({ error: 'Founder tables are not available yet. Apply migrations first.' });
      }
      throw error;
    }

    if (!founderResult.rows[0]) {
      return res.status(404).json({ error: 'Founder not found' });
    }

    let startupsResult: { rows: any[] } = { rows: [] };
    try {
      startupsResult = await pool.query(
        `SELECT
            s.id::text AS startup_id,
            s.name,
            s.slug,
            s.dataset_region,
            sf.role,
            sf.is_current,
            sf.start_date::text,
            sf.end_date::text,
            sf.ownership_pct,
            sf.confidence,
            sf.source
         FROM startup_founders sf
         JOIN startups s ON s.id = sf.startup_id
         WHERE sf.founder_id = $1::uuid
           AND s.dataset_region = $2
         ORDER BY sf.is_current DESC, sf.created_at ASC`,
        [founderId, parsed.data.scope],
      );
    } catch (error: any) {
      if (error?.code !== '42P01') throw error;
    }

    res.json({
      founder: founderResult.rows[0],
      scope: parsed.data.scope,
      startups: startupsResult.rows,
    });
  } catch (error) {
    console.error('Error fetching founder profile:', error);
    return res.status(500).json({ error: 'Failed to fetch founder profile' });
  }
});

// =============================================================================
// CURATED SECTORS
// =============================================================================

app.get('/api/v1/sectors', async (req, res) => {
  try {
    const parsed = sectorsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const { region } = parsed.data;
    const cacheKey = `sectors:list:${region}`;

    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(JSON.parse(cached)); }
      } catch { /* noop */ }
    }

    // Count startups per sector
    const sectors = await Promise.all(
      CURATED_SECTORS.map(async (sector) => {
        const sf = sectorFilterForStartups(sector, 's', 2);
        const countResult = await pool.query(
          `SELECT COUNT(*) AS cnt FROM startups s WHERE s.dataset_region = $1 AND ${sf.clause}`,
          [region, ...sf.values],
        );
        return {
          id: sector.id,
          label: sector.label,
          count: parseInt(countResult.rows[0]?.cnt || '0', 10),
        };
      }),
    );

    const result = { sectors: sectors.filter(s => s.count > 0) };

    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: 300 }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching sectors:', error);
    return res.status(500).json({ error: 'Failed to fetch sectors' });
  }
});

// =============================================================================
// PATTERN LANDSCAPES
// =============================================================================

app.get('/api/v1/landscapes', async (req, res) => {
  try {
    const parsed = landscapesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const cacheKey = `landscapes:treemap:${parsed.data.scope}:${parsed.data.period || 'latest'}:${parsed.data.sector || 'all'}:${parsed.data.size_by}:${parsed.data.stage || 'all'}`;
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(JSON.parse(cached)); }
      } catch { /* noop */ }
    }
    const result = await landscapesService.getTreemap(parsed.data);
    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: 1800 }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching landscapes:', error);
    return res.status(500).json({ error: 'Failed to fetch landscapes' });
  }
});

app.get('/api/v1/landscapes/cluster', async (req, res) => {
  try {
    const parsed = landscapesClusterQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const cacheKey = `landscapes:cluster:${parsed.data.scope}:${parsed.data.pattern}:${parsed.data.period || 'latest'}`;
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) { res.setHeader('X-Cache', 'HIT'); return res.json(JSON.parse(cached)); }
      } catch { /* noop */ }
    }
    const result = await landscapesService.getClusterDetail(parsed.data);
    if (!result) {
      return res.status(404).json({ error: 'Pattern not found' });
    }
    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(result), { EX: 1800 }); } catch { /* noop */ }
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching landscape cluster:', error);
    return res.status(500).json({ error: 'Failed to fetch landscape cluster' });
  }
});

// =============================================================================
// SUBSCRIPTIONS & ALERTS (Watchlist Intelligence)
// =============================================================================

app.get('/api/v1/subscriptions', async (req, res) => {
  try {
    const parsed = subscriptionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return res.status(401).json({ error: 'User ID required' });
    const result = await subscriptionsService.getSubscriptions({ userId, scope: parsed.data.scope });
    res.json(result);
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    return res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

app.post('/api/v1/subscriptions', async (req, res) => {
  try {
    const parsed = subscriptionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return res.status(401).json({ error: 'User ID required' });
    const result = await subscriptionsService.createSubscription({
      userId, objectType: parsed.data.object_type, objectId: parsed.data.object_id, scope: parsed.data.scope,
    });
    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating subscription:', error);
    return res.status(500).json({ error: 'Failed to create subscription' });
  }
});

app.delete('/api/v1/subscriptions', async (req, res) => {
  try {
    const parsed = subscriptionDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return res.status(401).json({ error: 'User ID required' });
    await subscriptionsService.deleteSubscription({
      userId, objectType: parsed.data.object_type, objectId: parsed.data.object_id, scope: parsed.data.scope,
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting subscription:', error);
    return res.status(500).json({ error: 'Failed to delete subscription' });
  }
});

app.get('/api/v1/alerts', async (req, res) => {
  try {
    const parsed = alertsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return res.status(401).json({ error: 'User ID required' });
    const result = await subscriptionsService.getAlerts({
      userId, scope: parsed.data.scope, status: parsed.data.status,
      severityMin: parsed.data.severity_min, type: parsed.data.type,
      limit: parsed.data.limit, offset: parsed.data.offset,
    });
    res.json(result);
  } catch (error) {
    console.error('Error fetching alerts:', error);
    return res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

app.patch('/api/v1/alerts/batch', async (req, res) => {
  try {
    const parsed = alertBatchUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return res.status(401).json({ error: 'User ID required' });
    await subscriptionsService.batchUpdateAlertStatus({
      alertIds: parsed.data.ids, userId, status: parsed.data.status,
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error batch updating alerts:', error);
    return res.status(500).json({ error: 'Failed to batch update alerts' });
  }
});

app.get('/api/v1/alerts/digest', async (req, res) => {
  try {
    const parsed = alertDigestQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return res.status(401).json({ error: 'User ID required' });
    const result = await subscriptionsService.getLatestDigest({ userId, scope: parsed.data.scope });
    res.json(result || { digest: null });
  } catch (error) {
    console.error('Error fetching alert digest:', error);
    return res.status(500).json({ error: 'Failed to fetch alert digest' });
  }
});

app.patch('/api/v1/alerts/:id', async (req, res) => {
  try {
    const alertId = String(req.params.id || '').trim();
    if (!alertId) return res.status(400).json({ error: 'Invalid alert ID' });
    const parsed = alertUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return res.status(401).json({ error: 'User ID required' });
    await subscriptionsService.updateAlertStatus({ alertId, userId, status: parsed.data.status });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error updating alert:', error);
    return res.status(500).json({ error: 'Failed to update alert' });
  }
});

// =============================================================================
// Dealbook Living Brief API — Edition + Revision model
// =============================================================================

app.get('/api/v1/brief', async (req, res) => {
  try {
    const parsed = briefQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const { edition_id, region, period_type, period_start, kind, revision } = parsed.data;
    const cacheKey = briefCacheKey({ editionId: edition_id, region, periodType: period_type, periodStart: period_start, kind, revision });

    const redis = await getRedisClient();
    if (redis) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          const data = safeCacheParse(cachedData, cacheKey, redis);
          if (data) {
            res.setHeader('X-Cache', 'HIT');
            return res.json(data);
          }
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    res.setHeader('X-Cache', redis ? 'MISS' : 'BYPASS');

    const snapshot = await briefService.getEditionBrief({
      editionId: edition_id,
      region,
      periodType: period_type,
      periodStart: period_start,
      kind,
      revision,
    });
    if (!snapshot) {
      return res.status(404).json({ error: 'No brief edition found' });
    }

    if (redis) {
      try {
        await redis.setEx(cacheKey, CACHE_TTL.BRIEF, JSON.stringify(snapshot));
      } catch (cacheErr) {
        console.error('Redis cache write error:', cacheErr);
      }
    }

    res.json(snapshot);
  } catch (error) {
    console.error('Error fetching brief:', error);
    res.status(500).json({ error: 'Failed to fetch brief' });
  }
});

// List brief editions (new canonical endpoint)
app.get('/api/v1/briefs/list', async (req, res) => {
  try {
    const parsed = briefListSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const { region, period_type, kind, limit, offset } = parsed.data;
    const cacheKey = briefListCacheKey({ region, periodType: period_type, kind, limit, offset });

    const redis = await getRedisClient();
    if (redis) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          const data = safeCacheParse(cachedData, cacheKey, redis);
          if (data) {
            res.setHeader('X-Cache', 'HIT');
            return res.json(data);
          }
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    res.setHeader('X-Cache', redis ? 'MISS' : 'BYPASS');

    const editions = await briefService.listEditions({ region, periodType: period_type, kind, limit, offset });

    if (redis) {
      try {
        await redis.setEx(cacheKey, CACHE_TTL.BRIEF_ARCHIVE, JSON.stringify(editions));
      } catch (cacheErr) {
        console.error('Redis cache write error:', cacheErr);
      }
    }

    res.json(editions);
  } catch (error) {
    console.error('Error listing brief editions:', error);
    res.status(500).json({ error: 'Failed to list brief editions' });
  }
});

// Backward compat alias: /api/v1/brief/archive → /api/v1/briefs/list
app.get('/api/v1/brief/archive', async (req, res) => {
  try {
    const parsed = briefListSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
    }
    const { region, period_type, kind, limit, offset } = parsed.data;
    const editions = await briefService.listEditions({ region, periodType: period_type, kind, limit, offset });
    res.json(editions);
  } catch (error) {
    console.error('Error fetching brief archive:', error);
    res.status(500).json({ error: 'Failed to fetch brief archive' });
  }
});

app.post('/api/v1/briefs/regenerate', async (req, res) => {
  if (!ADMIN_KEY) {
    return res.status(500).json({ error: 'ADMIN_KEY is not configured' });
  }
  const providedKey = req.headers['x-admin-key'] as string;
  if (!providedKey || providedKey !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid admin key' });
  }

  try {
    const parsed = briefRegenerateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }
    const { region, period_type, period_start, period_end, kind, force } = parsed.data;

    console.log(`Brief: Generating ${period_type} edition for ${region} (${period_start} → ${period_end}, kind=${kind}, force=${force})`);
    const result = await briefService.generateEditionRevision({
      region, periodType: period_type, periodStart: period_start,
      periodEnd: period_end, kind, force,
    });

    // Invalidate related caches
    await invalidatePattern('brief:v2:*');
    await invalidatePattern('brief:v1:*'); // clean up any legacy keys

    if (result.wasSkipped) {
      console.log(`Brief: Skipped — data unchanged (rev ${result.revision})`);
    } else {
      console.log(`Brief: Created rev ${result.revision} for edition ${result.editionId}`);
    }

    res.json({
      editionId: result.editionId,
      revisionId: result.revisionId,
      revision: result.revision,
      wasSkipped: result.wasSkipped,
      inputHash: result.inputHash,
      signalsHash: result.signalsHash,
      validationErrors: result.validationErrors,
    });
  } catch (error) {
    console.error('Error generating brief:', error);
    res.status(500).json({ error: 'Failed to generate brief' });
  }
});

app.get('/api/v1/onboarding/context-template', async (req, res) => {
  const parsed = onboardingContextTemplateQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
  }

  const startupId = parsed.data.startupId || '';
  const traceEventId = parsed.data.traceEventId || '';
  let startup: Record<string, unknown> | null = null;

  if (startupId) {
    try {
      const startupResult = await pool.query(
        `SELECT id::text AS id, name, slug, dataset_region, COALESCE(onboarding_status, 'verified') AS onboarding_status
         FROM startups
         WHERE id = $1::uuid
         LIMIT 1`,
        [startupId],
      );
      startup = startupResult.rows[0] || null;
    } catch (error) {
      console.warn('Could not load startup for onboarding context template:', error);
    }
  }

  const payload = {
    startupId: startupId || '<startup-uuid>',
    contextText: 'Add your deep-research context here (facts, links, missing data, caveats).',
    traceEventId: traceEventId || undefined,
    source: 'slack',
    createdBy: 'ops',
    enqueueResearch: true,
    metadata: {
      source: 'slack_followup',
      notes: 'Operator-supplied context',
    },
  };

  const endpointPath = '/api/admin/v1/onboarding/context';
  // Prefer an explicit public base (Front Door) to avoid returning an origin IP
  // that would fail Front Door header enforcement when users run the curl command.
  const apiBase = (
    process.env.API_URL
    || process.env.NEXT_PUBLIC_API_URL
    || 'https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net'
  ).replace(/\/+$/, '');
  const curlCommand = [
    `curl -X POST "${apiBase}${endpointPath}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "X-API-Key: <API_KEY>" \\`,
    `  -H "X-Admin-Key: <ADMIN_KEY>" \\`,
    `  -d '${JSON.stringify(payload)}'`,
  ].join('\n');

  return res.json({
    startup,
    endpoint: endpointPath,
    method: 'POST',
    required_headers: ['X-API-Key', 'X-Admin-Key'],
    sample_payload: payload,
    curl_command: curlCommand,
    notes: [
      'Submit context to enrich deep research prompt context.',
      'If enqueueResearch=true and no active queue item exists, startup is requeued.',
    ],
  });
});

// =============================================================================
// Admin API - Logo Extraction & Data Sync
// =============================================================================

app.post('/api/admin/v1/onboarding/context', async (req, res) => {
  if (!ADMIN_KEY) {
    return res.status(500).json({ error: 'ADMIN_KEY is not configured' });
  }
  const providedKey = req.headers['x-admin-key'] as string;
  if (!providedKey || providedKey !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid admin key' });
  }

  const parsed = onboardingContextCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
  }

  const pgClient = await pool.connect();
  try {
    await pgClient.query('BEGIN');

    const startupResult = await pgClient.query<{
      id: string;
      name: string;
      slug: string | null;
      dataset_region: 'global' | 'turkey';
      onboarding_status: string;
    }>(
      `SELECT
          id::text AS id,
          name,
          slug,
          dataset_region,
          COALESCE(onboarding_status, 'verified') AS onboarding_status
       FROM startups
       WHERE id = $1::uuid
       LIMIT 1`,
      [parsed.data.startupId],
    );
    const startup = startupResult.rows[0];
    if (!startup) {
      await pgClient.query('ROLLBACK');
      return res.status(404).json({ error: 'Startup not found' });
    }
    if (['merged', 'rejected'].includes(String(startup.onboarding_status || ''))) {
      await pgClient.query('ROLLBACK');
      return res.status(400).json({ error: `Cannot add context for startup status=${startup.onboarding_status}` });
    }

    const contextInsert = await pgClient.query<{ id: string }>(
      `INSERT INTO startup_onboarding_context (startup_id, source, context_text, metadata_json, created_by)
       VALUES ($1::uuid, $2, $3, $4::jsonb, $5)
       RETURNING id::text`,
      [
        parsed.data.startupId,
        parsed.data.source || 'admin',
        parsed.data.contextText,
        JSON.stringify(parsed.data.metadata || {}),
        parsed.data.createdBy || null,
      ],
    );
    const contextId = contextInsert.rows[0]?.id;

    try {
      await pgClient.query(
        `INSERT INTO startup_onboarding_attempts
           (startup_id, entity_name, region, stage, success, reason, metadata_json)
         VALUES
           ($1::uuid, $2, $3, 'human_context_added', TRUE, 'manual_context', $4::jsonb)`,
        [
          parsed.data.startupId,
          startup.name,
          startup.dataset_region,
          JSON.stringify({
            trace_event_id: parsed.data.traceEventId || null,
            source: parsed.data.source || 'admin',
            enqueue_research: Boolean(parsed.data.enqueueResearch),
          }),
        ],
      );
    } catch (error) {
      console.warn('Failed to persist startup_onboarding_attempts for manual context:', error);
    }

    try {
      await pgClient.query(
        `INSERT INTO onboarding_trace_events
          (startup_id, queue_item_id, trace_type, stage, status, severity, reason_code, message, payload_json, dedupe_key, should_notify, notification_channel)
         VALUES
          ($1::uuid, NULL, 'context', 'human_context_added', 'success', 'info', 'manual_context', $2, $3::jsonb, $4, FALSE, 'slack')
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [
          parsed.data.startupId,
          `Manual context added for ${startup.name}`,
          JSON.stringify({
            context_id: contextId,
            trace_event_id: parsed.data.traceEventId || null,
            source: parsed.data.source || 'admin',
          }),
          `human_context_added:${contextId || parsed.data.startupId}`,
        ],
      );
    } catch (error) {
      console.warn('Failed to persist onboarding trace for manual context:', error);
    }

    let queueItemId: string | null = null;
    if (parsed.data.enqueueResearch) {
      const queueResult = await pgClient.query<{ id: string }>(
        `INSERT INTO deep_research_queue (startup_id, priority, reason, research_depth, focus_areas)
         SELECT id, 2, 'human_context', 'standard', $2::jsonb
         FROM startups
         WHERE id = $1::uuid
           AND COALESCE(onboarding_status, 'verified') NOT IN ('merged', 'rejected')
         ON CONFLICT DO NOTHING
         RETURNING id::text`,
        [parsed.data.startupId, JSON.stringify(['manual_context'])],
      );
      queueItemId = queueResult.rows[0]?.id || null;

      if (queueItemId) {
        try {
          await pgClient.query(
            `INSERT INTO onboarding_trace_events
              (startup_id, queue_item_id, trace_type, stage, status, severity, reason_code, message, payload_json, dedupe_key, should_notify, notification_channel)
             VALUES
              ($1::uuid, $2::uuid, 'onboarding', 'research_requeued_by_human', 'success', 'info', 'human_context', $3, $4::jsonb, $5, TRUE, 'slack')
             ON CONFLICT (dedupe_key) DO NOTHING`,
            [
              parsed.data.startupId,
              queueItemId,
              `Deep research requeued by human context for ${startup.name}`,
              JSON.stringify({
                context_id: contextId,
                source: parsed.data.source || 'admin',
              }),
              `research_requeued_by_human:${queueItemId}`,
            ],
          );
        } catch (error) {
          console.warn('Failed to persist onboarding trace for human requeue:', error);
        }
      }
    }

    await pgClient.query('COMMIT');
    return res.json({
      ok: true,
      startup: {
        id: startup.id,
        name: startup.name,
        slug: startup.slug,
        region: startup.dataset_region,
        onboarding_status: startup.onboarding_status,
      },
      context_id: contextId || null,
      deep_research_queue_item_id: queueItemId,
      requeued: Boolean(queueItemId),
    });
  } catch (error) {
    await pgClient.query('ROLLBACK');
    console.error('Error adding onboarding context:', error);
    return res.status(500).json({ error: 'Failed to add onboarding context' });
  } finally {
    pgClient.release();
  }
});

app.post('/api/admin/v1/investors/upsert', async (req, res) => {
  if (!ADMIN_KEY) {
    return res.status(500).json({ error: 'ADMIN_KEY is not configured' });
  }
  const providedKey = req.headers['x-admin-key'] as string;
  if (!providedKey || providedKey !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid admin key' });
  }

  const parsed = investorUpsertSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
  }

  const pgClient = await pool.connect();
  try {
    await pgClient.query('BEGIN');

    const investorResult = await pgClient.query<{ id: string }>(
      `INSERT INTO investors (name, type, website, headquarters_country)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name)
       DO UPDATE SET
         type = COALESCE(EXCLUDED.type, investors.type),
         website = COALESCE(EXCLUDED.website, investors.website),
         headquarters_country = COALESCE(EXCLUDED.headquarters_country, investors.headquarters_country)
       RETURNING id::text`,
      [
        parsed.data.name,
        parsed.data.type || null,
        parsed.data.website || null,
        parsed.data.headquarters_country || null,
      ],
    );
    const investorId = investorResult.rows[0]?.id;
    if (!investorId) {
      throw new Error('Failed to upsert investor');
    }

    const aliases = Array.from(new Set(parsed.data.aliases.map((a) => a.trim()).filter(Boolean)));
    for (const alias of aliases) {
      await pgClient.query(
        `INSERT INTO investor_aliases (investor_id, alias, alias_type, source, confidence)
         VALUES ($1::uuid, $2, 'name_variant', $3, $4)
         ON CONFLICT ((lower(regexp_replace(trim(alias), '\\s+', ' ', 'g'))))
         DO UPDATE SET
           investor_id = EXCLUDED.investor_id,
           source = EXCLUDED.source,
           confidence = EXCLUDED.confidence`,
        [investorId, alias, parsed.data.source || 'manual', parsed.data.confidence ?? null],
      );
    }

    await pgClient.query('COMMIT');
    res.json({
      investor_id: investorId,
      aliases_upserted: aliases.length,
      source: parsed.data.source || 'manual',
    });
  } catch (error) {
    await pgClient.query('ROLLBACK');
    console.error('Error upserting investor:', error);
    return res.status(500).json({ error: 'Failed to upsert investor' });
  } finally {
    pgClient.release();
  }
});

app.post('/api/admin/v1/founders/upsert', async (req, res) => {
  if (!ADMIN_KEY) {
    return res.status(500).json({ error: 'ADMIN_KEY is not configured' });
  }
  const providedKey = req.headers['x-admin-key'] as string;
  if (!providedKey || providedKey !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid admin key' });
  }

  const parsed = founderUpsertSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
  }

  const pgClient = await pool.connect();
  try {
    await pgClient.query('BEGIN');

    const existing = await pgClient.query<{ id: string }>(
      `SELECT id::text
       FROM founders
       WHERE ($1::text IS NOT NULL AND linkedin_url = $1)
          OR ($2::text IS NOT NULL AND x_url = $2)
          OR ($3::text IS NOT NULL AND slug = $3)
          OR lower(regexp_replace(trim(full_name), '\\s+', ' ', 'g')) = lower(regexp_replace(trim($4), '\\s+', ' ', 'g'))
       ORDER BY
         CASE
           WHEN $1::text IS NOT NULL AND linkedin_url = $1 THEN 1
           WHEN $2::text IS NOT NULL AND x_url = $2 THEN 2
           WHEN $3::text IS NOT NULL AND slug = $3 THEN 3
           ELSE 4
         END ASC
       LIMIT 1`,
      [
        parsed.data.linkedin_url || null,
        parsed.data.x_url || null,
        parsed.data.slug || null,
        parsed.data.full_name,
      ],
    );

    let founderId = existing.rows[0]?.id || null;
    if (founderId) {
      const updateResult = await pgClient.query<{ id: string }>(
        `UPDATE founders
         SET
           full_name = $2,
           slug = COALESCE($3, slug),
           linkedin_url = COALESCE($4, linkedin_url),
           x_url = COALESCE($5, x_url),
           website = COALESCE($6, website),
           bio = COALESCE($7, bio),
           primary_country = COALESCE($8, primary_country),
           source = COALESCE($9, source),
           updated_at = NOW()
         WHERE id = $1::uuid
         RETURNING id::text`,
        [
          founderId,
          parsed.data.full_name,
          parsed.data.slug || null,
          parsed.data.linkedin_url || null,
          parsed.data.x_url || null,
          parsed.data.website || null,
          parsed.data.bio || null,
          parsed.data.primary_country || null,
          parsed.data.source || 'manual',
        ],
      );
      founderId = updateResult.rows[0]?.id || founderId;
    } else {
      const insertResult = await pgClient.query<{ id: string }>(
        `INSERT INTO founders
          (full_name, slug, linkedin_url, x_url, website, bio, primary_country, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id::text`,
        [
          parsed.data.full_name,
          parsed.data.slug || null,
          parsed.data.linkedin_url || null,
          parsed.data.x_url || null,
          parsed.data.website || null,
          parsed.data.bio || null,
          parsed.data.primary_country || null,
          parsed.data.source || 'manual',
        ],
      );
      founderId = insertResult.rows[0]?.id || null;
    }

    if (!founderId) {
      throw new Error('Failed to upsert founder');
    }

    const aliases = Array.from(new Set(parsed.data.aliases.map((a) => a.trim()).filter(Boolean)));
    for (const alias of aliases) {
      await pgClient.query(
        `INSERT INTO founder_aliases (founder_id, alias, alias_type, source, confidence)
         VALUES ($1::uuid, $2, 'name_variant', $3, $4)
         ON CONFLICT ((lower(regexp_replace(trim(alias), '\\s+', ' ', 'g'))))
         DO UPDATE SET
           founder_id = EXCLUDED.founder_id,
           source = EXCLUDED.source,
           confidence = EXCLUDED.confidence`,
        [founderId, alias, parsed.data.source || 'manual', parsed.data.confidence ?? null],
      );
    }

    await pgClient.query('COMMIT');
    res.json({
      founder_id: founderId,
      aliases_upserted: aliases.length,
      source: parsed.data.source || 'manual',
    });
  } catch (error) {
    await pgClient.query('ROLLBACK');
    console.error('Error upserting founder:', error);
    return res.status(500).json({ error: 'Failed to upsert founder' });
  } finally {
    pgClient.release();
  }
});

app.post('/api/admin/v1/graph-edges/upsert', async (req, res) => {
  if (!ADMIN_KEY) {
    return res.status(500).json({ error: 'ADMIN_KEY is not configured' });
  }
  const providedKey = req.headers['x-admin-key'] as string;
  if (!providedKey || providedKey !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid admin key' });
  }

  const parsed = graphEdgeUpsertSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
  }
  if (parsed.data.valid_to < parsed.data.valid_from) {
    return res.status(400).json({ error: 'valid_to must be greater than or equal to valid_from' });
  }

  const pgClient = await pool.connect();
  try {
    await pgClient.query('BEGIN');

    const edge = await pgClient.query<{ id: string }>(
      `INSERT INTO capital_graph_edges
         (src_type, src_id, edge_type, dst_type, dst_id, region, attrs_json, source, source_ref, confidence, created_by, valid_from, valid_to)
       VALUES ($1, $2::uuid, $3, $4, $5::uuid, $6, $7::jsonb, $8, $9, $10, $11, $12::date, $13::date)
       ON CONFLICT (src_type, src_id, edge_type, dst_type, dst_id, region, valid_from, valid_to)
       DO UPDATE SET
         attrs_json = EXCLUDED.attrs_json,
         source = EXCLUDED.source,
         source_ref = EXCLUDED.source_ref,
         confidence = EXCLUDED.confidence,
         created_by = EXCLUDED.created_by,
         updated_at = NOW()
       RETURNING id::text`,
      [
        parsed.data.src_type,
        parsed.data.src_id,
        parsed.data.edge_type,
        parsed.data.dst_type,
        parsed.data.dst_id,
        parsed.data.region,
        JSON.stringify(parsed.data.attrs_json || {}),
        parsed.data.source || 'manual',
        parsed.data.source_ref || null,
        parsed.data.confidence ?? null,
        parsed.data.created_by || null,
        parsed.data.valid_from,
        parsed.data.valid_to,
      ],
    );

    await pgClient.query('SELECT refresh_capital_graph_views()');
    await pgClient.query('COMMIT');

    res.json({
      edge_id: edge.rows[0]?.id || null,
      refreshed_views: true,
    });
  } catch (error) {
    await pgClient.query('ROLLBACK');
    console.error('Error upserting graph edge:', error);
    return res.status(500).json({ error: 'Failed to upsert graph edge' });
  } finally {
    pgClient.release();
  }
});

app.post('/api/admin/v1/graph-edges/bulk', async (req, res) => {
  if (!ADMIN_KEY) {
    return res.status(500).json({ error: 'ADMIN_KEY is not configured' });
  }
  const providedKey = req.headers['x-admin-key'] as string;
  if (!providedKey || providedKey !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid admin key' });
  }

  const parsed = graphEdgesBulkUpsertSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
  }

  for (const edge of parsed.data.edges) {
    if (edge.valid_to < edge.valid_from) {
      return res.status(400).json({
        error: `Invalid date window for edge ${edge.src_type}:${edge.src_id} -> ${edge.dst_type}:${edge.dst_id}`,
      });
    }
  }

  const pgClient = await pool.connect();
  try {
    await pgClient.query('BEGIN');

    let processed = 0;
    for (const edge of parsed.data.edges) {
      await pgClient.query(
        `INSERT INTO capital_graph_edges
           (src_type, src_id, edge_type, dst_type, dst_id, region, attrs_json, source, source_ref, confidence, created_by, valid_from, valid_to)
         VALUES ($1, $2::uuid, $3, $4, $5::uuid, $6, $7::jsonb, $8, $9, $10, $11, $12::date, $13::date)
         ON CONFLICT (src_type, src_id, edge_type, dst_type, dst_id, region, valid_from, valid_to)
         DO UPDATE SET
           attrs_json = EXCLUDED.attrs_json,
           source = EXCLUDED.source,
           source_ref = EXCLUDED.source_ref,
           confidence = EXCLUDED.confidence,
           created_by = EXCLUDED.created_by,
           updated_at = NOW()`,
        [
          edge.src_type,
          edge.src_id,
          edge.edge_type,
          edge.dst_type,
          edge.dst_id,
          edge.region,
          JSON.stringify(edge.attrs_json || {}),
          edge.source || 'manual',
          edge.source_ref || null,
          edge.confidence ?? null,
          edge.created_by || null,
          edge.valid_from,
          edge.valid_to,
        ],
      );
      processed += 1;
    }

    if (parsed.data.refresh_views) {
      await pgClient.query('SELECT refresh_capital_graph_views()');
    }

    await pgClient.query('COMMIT');
    res.json({
      processed,
      refreshed_views: parsed.data.refresh_views,
    });
  } catch (error) {
    await pgClient.query('ROLLBACK');
    console.error('Error bulk upserting graph edges:', error);
    return res.status(500).json({ error: 'Failed to bulk upsert graph edges' });
  } finally {
    pgClient.release();
  }
});

// Sync startups from CSV data (admin only)
app.post('/api/admin/sync-startups', async (req, res) => {
  if (!ADMIN_KEY) {
    return res.status(500).json({ error: 'ADMIN_KEY is not configured' });
  }
  const providedKey = req.headers['x-admin-key'] as string;
  if (!providedKey || providedKey !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid admin key' });
  }

  // Dataset region (global|turkey). Defaults to global for backward compatibility.
  const rawRegion = String((req.query as any)?.region || '').toLowerCase().trim();
  if (rawRegion && rawRegion !== 'global' && rawRegion !== 'turkey' && rawRegion !== 'tr') {
    return res.status(400).json({ error: 'Invalid region (expected global|turkey)' });
  }
  const datasetRegion = rawRegion === 'turkey' || rawRegion === 'tr' ? 'turkey' : 'global';

  const parseResult = syncRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid request payload',
      details: parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
    });
  }
  const startupData = parseResult.data.startups;

  console.log(`Syncing ${startupData.length} startups (region=${datasetRegion})...`);

  const results = {
    total: startupData.length,
    inserted: 0,
    updated: 0,
    failed: [] as { name: string; error: string }[],
    graph: {
      enabled: false,
      investorsUpserted: 0,
      edgesUpserted: 0,
      viewsRefreshed: false,
      candidateRows: 0,
      error: null as string | null,
    },
  };
  const graphFundingRows: AdminFundingGraphRow[] = [];

  // Pre-process all startups (validated by Zod schema)
  const parsed = startupData.map((startup) => {
    const slug = slugify(startup.name);
    const location = parseLocation(startup.location);
    return {
      raw: startup,
      slug,
      name: startup.name,
      description: startup.description || null,
      website: startup.website || null,
      city: location.city,
      country: location.country,
      continent: location.continent,
      industry: startup.industries.split(',').map((s) => s.trim()).find(Boolean) || null,
      stage: startup.fundingStage || null,
    };
  });

  // Single query to find all existing slugs
  const allSlugs = parsed.map((p: { slug: string }) => p.slug);
  const existingRows = await db.select({ id: startups.id, slug: startups.slug })
    .from(startups)
    .where(and(
      eq(startups.datasetRegion, datasetRegion),
      sql`${startups.slug} = ANY(${allSlugs})`
    ) as any);
  const existingMap = new Map(existingRows.map(r => [r.slug, r.id]));

  // Split into inserts and updates
  const toInsert = parsed.filter((p: { slug: string }) => !existingMap.has(p.slug));
  const toUpdate = parsed.filter((p: { slug: string }) => existingMap.has(p.slug));

  // Use a single connection for the entire sync operation
  const CHUNK_SIZE = 250;
  const pgClient = await pool.connect();
  try {
    // Batch inserts in chunks
    for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
      const chunk = toInsert.slice(i, i + CHUNK_SIZE);
      try {
        await pgClient.query('BEGIN');

        const params: unknown[] = [];
        const placeholders: string[] = [];
        let idx = 1;
        for (const s of chunk) {
          placeholders.push(
            `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
          );
          params.push(datasetRegion, s.name, s.slug, s.description, s.website, s.city, s.country, s.continent, s.industry, s.stage);
        }

        const insertResult = await pgClient.query(
          `INSERT INTO startups (dataset_region, name, slug, description, website, headquarters_city, headquarters_country, continent, industry, stage)
           VALUES ${placeholders.join(', ')}
           RETURNING id, slug`,
          params
        );

        const newSlugToId = new Map(insertResult.rows.map((r: { slug: string; id: string }) => [r.slug, r.id]));
        results.inserted += insertResult.rowCount || 0;

        // Batch insert funding rounds for new startups
        const fParams: unknown[] = [];
        const fPlaceholders: string[] = [];
        let fIdx = 1;
        for (const s of chunk) {
          if (!s.raw.amountUsd || !s.raw.roundType) continue;
          const startupId = newSlugToId.get(s.slug);
          if (!startupId) continue;
          const fundingAmount = parseFundingAmount(s.raw.amountUsd);
          fPlaceholders.push(`($${fIdx++}, $${fIdx++}, $${fIdx++}, $${fIdx++}, $${fIdx++})`);
          fParams.push(startupId, s.raw.roundType, fundingAmount, s.raw.announcedDate || null, s.raw.leadInvestors || null);
          if (s.raw.leadInvestors) {
            graphFundingRows.push({
              startupId,
              roundType: s.raw.roundType,
              amountUsd: fundingAmount,
              announcedDate: s.raw.announcedDate || null,
              leadInvestors: s.raw.leadInvestors,
            });
          }
        }
        if (fPlaceholders.length > 0) {
          await pgClient.query(
            `INSERT INTO funding_rounds (startup_id, round_type, amount_usd, announced_date, lead_investor)
             VALUES ${fPlaceholders.join(', ')}
             ON CONFLICT DO NOTHING`,
            fParams
          );
        }

        await pgClient.query('COMMIT');
      } catch (error) {
        await pgClient.query('ROLLBACK');
        console.error('Batch insert failed, falling back to individual processing:', error);
        for (const s of chunk) {
          try {
            const [newStartup] = await db.insert(startups).values({
              datasetRegion,
              name: s.name, slug: s.slug, description: s.description, website: s.website,
              headquartersCity: s.city, headquartersCountry: s.country, continent: s.continent, industry: s.industry, stage: s.stage,
            }).returning({ id: startups.id });
            results.inserted++;
            if (newStartup && s.raw.amountUsd && s.raw.roundType) {
              const fundingAmount = parseFundingAmount(s.raw.amountUsd);
              await db.insert(fundingRounds).values({
                startupId: newStartup.id, roundType: s.raw.roundType,
                amountUsd: fundingAmount, announcedDate: s.raw.announcedDate || null, leadInvestor: s.raw.leadInvestors || null,
              });
              if (s.raw.leadInvestors) {
                graphFundingRows.push({
                  startupId: newStartup.id,
                  roundType: s.raw.roundType,
                  amountUsd: fundingAmount,
                  announcedDate: s.raw.announcedDate || null,
                  leadInvestors: s.raw.leadInvestors,
                });
              }
            }
          } catch (innerError) {
            results.failed.push({ name: s.name, error: String(innerError) });
          }
        }
      }
    }

    // Batch updates in chunks
    for (let i = 0; i < toUpdate.length; i += CHUNK_SIZE) {
      const chunk = toUpdate.slice(i, i + CHUNK_SIZE);
      try {
        await pgClient.query('BEGIN');

        // Update each startup using a single UPDATE FROM VALUES
        const params: unknown[] = [];
        const valueParts: string[] = [];
        let idx = 1;
        for (const s of chunk) {
          const id = existingMap.get(s.slug);
          valueParts.push(`($${idx++}::uuid, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
          params.push(id, s.description, s.website, s.city, s.country, s.continent, s.industry, s.stage);
        }

        await pgClient.query(
          `UPDATE startups SET
            description = COALESCE(v.description, startups.description),
            website = COALESCE(v.website, startups.website),
            headquarters_city = v.city,
            headquarters_country = v.country,
            continent = v.continent,
            industry = v.industry,
            stage = v.stage,
            onboarding_status = CASE
              WHEN COALESCE(startups.onboarding_status, 'verified') = 'merged' THEN startups.onboarding_status
              ELSE 'verified'
            END,
            updated_at = NOW()
          FROM (VALUES ${valueParts.join(', ')})
            AS v(id, description, website, city, country, continent, industry, stage)
          WHERE startups.id = v.id::uuid`,
          params
        );
        results.updated += chunk.length;

        // Batch insert funding rounds for updated startups
        const fParams: unknown[] = [];
        const fPlaceholders: string[] = [];
        let fIdx = 1;
        for (const s of chunk) {
          if (!s.raw.amountUsd || !s.raw.roundType) continue;
          const startupId = existingMap.get(s.slug);
          if (!startupId) continue;
          const fundingAmount = parseFundingAmount(s.raw.amountUsd);
          fPlaceholders.push(`($${fIdx++}, $${fIdx++}, $${fIdx++}, $${fIdx++}, $${fIdx++})`);
          fParams.push(startupId, s.raw.roundType, fundingAmount, s.raw.announcedDate || null, s.raw.leadInvestors || null);
          if (s.raw.leadInvestors) {
            graphFundingRows.push({
              startupId,
              roundType: s.raw.roundType,
              amountUsd: fundingAmount,
              announcedDate: s.raw.announcedDate || null,
              leadInvestors: s.raw.leadInvestors,
            });
          }
        }
        if (fPlaceholders.length > 0) {
          await pgClient.query(
            `INSERT INTO funding_rounds (startup_id, round_type, amount_usd, announced_date, lead_investor)
             VALUES ${fPlaceholders.join(', ')}
             ON CONFLICT DO NOTHING`,
            fParams
          );
        }

        await pgClient.query('COMMIT');
      } catch (error) {
        await pgClient.query('ROLLBACK');
        console.error('Batch update failed, falling back to individual processing:', error);
        for (const s of chunk) {
          try {
            const id = existingMap.get(s.slug);
            if (id) {
              await db.update(startups).set({
                description: s.description, website: s.website, headquartersCity: s.city,
                headquartersCountry: s.country, continent: s.continent, industry: s.industry, stage: s.stage,
                onboardingStatus: sql`CASE
                  WHEN COALESCE(${startups.onboardingStatus}, 'verified') = 'merged' THEN ${startups.onboardingStatus}
                  ELSE 'verified'
                END` as any,
                updatedAt: new Date(),
              }).where(eq(startups.id, id));
              results.updated++;
              if (s.raw.amountUsd && s.raw.roundType) {
                const fundingAmount = parseFundingAmount(s.raw.amountUsd);
                await db.insert(fundingRounds).values({
                  startupId: id, roundType: s.raw.roundType,
                  amountUsd: fundingAmount, announcedDate: s.raw.announcedDate || null, leadInvestor: s.raw.leadInvestors || null,
                }).onConflictDoNothing();
                if (s.raw.leadInvestors) {
                  graphFundingRows.push({
                    startupId: id,
                    roundType: s.raw.roundType,
                    amountUsd: fundingAmount,
                    announcedDate: s.raw.announcedDate || null,
                    leadInvestors: s.raw.leadInvestors,
                  });
                }
              }
            }
          } catch (innerError) {
            results.failed.push({ name: s.name, error: String(innerError) });
          }
        }
      }
    }

    try {
      await pgClient.query('BEGIN');
      const graphSync = await syncCapitalGraphFromFundingRows(pgClient, datasetRegion, graphFundingRows);
      await pgClient.query('COMMIT');
      results.graph = {
        ...graphSync,
        error: null,
      };
    } catch (graphError) {
      await pgClient.query('ROLLBACK');
      const message = String(graphError);
      console.error('Capital graph sync failed after startup sync:', graphError);
      results.graph = {
        enabled: false,
        investorsUpserted: 0,
        edgesUpserted: 0,
        viewsRefreshed: false,
        candidateRows: 0,
        error: message,
      };
    }
  } finally {
    pgClient.release();
  }

  console.log(`Sync complete: ${results.inserted} inserted, ${results.updated} updated, ${results.failed.length} failed`);

  // Invalidate all cached data after sync
  try {
    await invalidateAll();
    console.log('Cache invalidated after data sync');
  } catch (cacheErr) {
    console.error('Cache invalidation error:', cacheErr);
  }

  res.json({
    message: 'Sync completed',
    results,
    cacheInvalidated: true,
  });
});

// Extract logos for all startups (admin only)
app.post('/api/admin/extract-logos', async (req, res) => {
  if (!ADMIN_KEY) {
    return res.status(500).json({ error: 'ADMIN_KEY is not configured' });
  }
  const providedKey = req.headers['x-admin-key'] as string;
  if (!providedKey || providedKey !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid admin key' });
  }

  const force = req.query.force === 'true';
  const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

  console.log(`Logo extraction started - force: ${force}, limit: ${limit || 'all'}`);

  try {
    // Run extraction (this may take a while)
    const results = await logoExtractor.extractAll({ force, limit });

    res.json({
      message: 'Logo extraction completed',
      results: {
        total: results.total,
        success: results.success.length,
        failed: results.failed.length,
        skipped: results.skipped.length,
      },
      details: {
        success: results.success,
        failed: results.failed,
        skipped: results.skipped,
      },
    });
  } catch (error) {
    console.error('Logo extraction error:', error);
    res.status(500).json({ error: 'Logo extraction failed' });
  }
});

// Get logo extraction status
app.get('/api/admin/logo-status', async (req, res) => {
  if (!ADMIN_KEY) {
    return res.status(500).json({ error: 'ADMIN_KEY is not configured' });
  }
  const providedKey = req.headers['x-admin-key'] as string;
  if (!providedKey || providedKey !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid admin key' });
  }

  try {
    const [stats] = await db.select({
      total: count(),
      withLogos: sql<number>`COUNT(CASE WHEN logo_data IS NOT NULL THEN 1 END)`.as('with_logos'),
      withWebsites: sql<number>`COUNT(CASE WHEN website IS NOT NULL THEN 1 END)`.as('with_websites'),
    }).from(startups);

    res.json({
      total: stats.total,
      withLogos: stats.withLogos,
      withoutLogos: stats.total - stats.withLogos,
      withWebsites: stats.withWebsites,
      coverage: stats.total > 0 ? ((stats.withLogos / stats.total) * 100).toFixed(1) + '%' : '0%',
    });
  } catch (error) {
    console.error('Error fetching logo status:', error);
    res.status(500).json({ error: 'Failed to fetch logo status' });
  }
});

// =============================================================================
// Source Health Monitoring (Admin)
// =============================================================================

app.get('/api/admin/monitoring/sources', async (req, res) => {
  if (!ADMIN_KEY) {
    return res.status(500).json({ error: 'ADMIN_KEY is not configured' });
  }
  const providedKey = req.headers['x-admin-key'] as string;
  if (!providedKey || providedKey !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid admin key' });
  }

  try {
    const pgClient = await pool.connect();
    try {
      const sourcesResult = await pgClient.query(`
        SELECT source_key, display_name, source_type, base_url, region, is_active,
               credibility_weight, last_fetch_at, last_success_at, last_error_at,
               last_error, consecutive_failures, total_fetches, total_successes,
               last_items_fetched, last_fetch_duration_ms, last_alerted_at,
               created_at, updated_at
        FROM news_sources
        ORDER BY consecutive_failures DESC, display_name
      `);

      const lastRunResult = await pgClient.query(`
        SELECT id, started_at, completed_at, status, sources_attempted,
               items_fetched, items_kept, clusters_built, errors_json
        FROM news_ingestion_runs
        ORDER BY started_at DESC
        LIMIT 1
      `);

      const sources = sourcesResult.rows;
      const active = sources.filter((s: any) => s.is_active);
      const healthy = active.filter((s: any) => s.consecutive_failures === 0);
      const degraded = active.filter((s: any) => s.consecutive_failures > 0 && s.consecutive_failures < 5);
      const down = active.filter((s: any) => s.consecutive_failures >= 5);

      res.json({
        summary: {
          total: active.length,
          healthy: healthy.length,
          degraded: degraded.length,
          down: down.length,
        },
        sources,
        lastRun: lastRunResult.rows[0] || null,
      });
    } finally {
      pgClient.release();
    }
  } catch (error) {
    console.error('Error fetching source monitoring:', error);
    res.status(500).json({ error: 'Failed to fetch source monitoring data' });
  }
});

app.get('/api/admin/monitoring/frontier', async (req, res) => {
  if (!ADMIN_KEY) {
    return res.status(500).json({ error: 'ADMIN_KEY is not configured' });
  }
  const providedKey = req.headers['x-admin-key'] as string;
  if (!providedKey || providedKey !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid admin key' });
  }

  try {
    const pgClient = await pool.connect();
    try {
      let domainsResult;
      try {
        domainsResult = await pgClient.query(`
          SELECT dp.domain, dp.blocked, dp.crawl_delay_ms, dp.max_concurrent,
                dp.proxy_tier, dp.render_required, dp.block_rate, dp.consecutive_blocks,
                dp.last_blocked_at, dp.last_provider_success_at,
                ds.error_rate, ds.consecutive_errors, ds.avg_response_ms,
                ds.total_requests, ds.successful_requests, ds.requires_js,
                ds.last_error_at AS stats_last_error_at, ds.updated_at AS stats_updated_at
          FROM domain_policies dp
          LEFT JOIN domain_stats ds ON dp.domain = ds.domain
          ORDER BY dp.blocked DESC, dp.block_rate DESC
          LIMIT 200
        `);
      } catch (err) {
        // Older DBs may not have domain_stats (009_crawler_improvements.sql). Keep endpoint usable.
        console.warn('Frontier monitoring: domain_stats join failed, falling back:', err);
        domainsResult = await pgClient.query(`
          SELECT dp.domain, dp.blocked, dp.crawl_delay_ms, dp.max_concurrent,
                dp.proxy_tier, dp.render_required, dp.block_rate, dp.consecutive_blocks,
                dp.last_blocked_at, dp.last_provider_success_at,
                NULL::float AS error_rate, NULL::int AS consecutive_errors, NULL::int AS avg_response_ms,
                NULL::int AS total_requests, NULL::int AS successful_requests, NULL::boolean AS requires_js,
                NULL::timestamptz AS stats_last_error_at, NULL::timestamptz AS stats_updated_at
          FROM domain_policies dp
          ORDER BY dp.blocked DESC, dp.block_rate DESC
          LIMIT 200
        `);
      }

      const urlCountResult = await pgClient.query(`
        SELECT COUNT(*) AS total FROM crawl_frontier_urls
      `);
      const urlCoverageResult = await pgClient.query(`
        SELECT
          COUNT(*)::int AS total_urls,
          COUNT(*) FILTER (WHERE last_crawled_at IS NOT NULL)::int AS crawled_urls,
          COUNT(*) FILTER (WHERE last_crawled_at IS NULL)::int AS never_crawled,
          COALESCE(
            EXTRACT(EPOCH FROM (NOW() - MAX(last_crawled_at))) / 60.0,
            NULL
          )::float AS mins_since_latest_crawl,
          COALESCE(
            EXTRACT(EPOCH FROM (NOW() - MIN(last_crawled_at))) / 3600.0,
            NULL
          )::float AS hours_since_oldest_crawl
        FROM crawl_frontier_urls
      `);
      const queueStatsResult = await pgClient.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (
            WHERE leased_at IS NULL
              AND available_at <= NOW()
          )::int AS due,
          COUNT(*) FILTER (WHERE leased_at IS NOT NULL)::int AS leased,
          COUNT(*) FILTER (
            WHERE leased_at IS NOT NULL
              AND leased_at < NOW() - INTERVAL '30 minutes'
          )::int AS stale_leases,
          COALESCE(
            PERCENTILE_CONT(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (NOW() - available_at))
            ) FILTER (
              WHERE leased_at IS NULL
                AND available_at <= NOW()
            ),
            0
          )::float AS due_age_p50_seconds,
          COALESCE(
            PERCENTILE_CONT(0.95) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (NOW() - available_at))
            ) FILTER (
              WHERE leased_at IS NULL
                AND available_at <= NOW()
            ),
            0
          )::float AS due_age_p95_seconds
        FROM crawl_frontier_queue
      `);
      let runMode: 'crawl_logs' | 'frontier_urls' = 'crawl_logs';
      let runStatsResult = await pgClient.query(`
        SELECT
          COUNT(*)::int AS total_attempts,
          COUNT(*) FILTER (WHERE status = 'success')::int AS success,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
          COUNT(*) FILTER (WHERE status = 'blocked')::int AS blocked,
          COALESCE(
            ROUND(AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL), 1),
            0
          )::float AS avg_duration_ms,
	          COALESCE(
	            ROUND(
	              (
	                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)
	                  FILTER (WHERE duration_ms IS NOT NULL)
	              )::numeric,
	              1
	            ),
	            0
	          )::float AS p95_duration_ms,
          COUNT(*) FILTER (WHERE http_status BETWEEN 200 AND 299)::int AS http_2xx,
          COUNT(*) FILTER (WHERE http_status = 304)::int AS http_304,
          COUNT(*) FILTER (WHERE http_status BETWEEN 400 AND 499)::int AS http_4xx,
          COUNT(*) FILTER (WHERE http_status >= 500)::int AS http_5xx
        FROM crawl_logs
        WHERE COALESCE(crawl_started_at, created_at) >= NOW() - INTERVAL '24 hours'
      `);
      const runStatsRowRaw = runStatsResult.rows[0] || {};
      const runAttempts = Number.parseInt(String(runStatsRowRaw.total_attempts ?? '0'), 10) || 0;
      if (runAttempts === 0) {
        runMode = 'frontier_urls';
        runStatsResult = await pgClient.query(`
          SELECT
            COUNT(*) FILTER (WHERE last_crawled_at >= NOW() - INTERVAL '24 hours')::int AS total_attempts,
            COUNT(*) FILTER (
              WHERE last_crawled_at >= NOW() - INTERVAL '24 hours'
                AND (last_status_code BETWEEN 200 AND 299 OR last_status_code = 304)
            )::int AS success,
            COUNT(*) FILTER (
              WHERE last_crawled_at >= NOW() - INTERVAL '24 hours'
                AND (last_status_code IS NULL OR last_status_code >= 400)
            )::int AS failed,
            COUNT(*) FILTER (
              WHERE last_crawled_at >= NOW() - INTERVAL '24 hours'
                AND COALESCE(last_blocked_detected, FALSE) = TRUE
            )::int AS blocked,
            COALESCE(
              ROUND(AVG(last_response_ms) FILTER (
                WHERE last_crawled_at >= NOW() - INTERVAL '24 hours'
                  AND last_response_ms IS NOT NULL
              ), 1),
              0
            )::float AS avg_duration_ms,
	            COALESCE(
	              ROUND(
	                (
	                  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY last_response_ms)
	                    FILTER (
	                      WHERE last_crawled_at >= NOW() - INTERVAL '24 hours'
	                        AND last_response_ms IS NOT NULL
	                    )
	                )::numeric,
	                1
	              ),
	              0
	            )::float AS p95_duration_ms,
            COUNT(*) FILTER (
              WHERE last_crawled_at >= NOW() - INTERVAL '24 hours'
                AND last_status_code BETWEEN 200 AND 299
            )::int AS http_2xx,
            COUNT(*) FILTER (
              WHERE last_crawled_at >= NOW() - INTERVAL '24 hours'
                AND last_status_code = 304
            )::int AS http_304,
            COUNT(*) FILTER (
              WHERE last_crawled_at >= NOW() - INTERVAL '24 hours'
                AND last_status_code BETWEEN 400 AND 499
            )::int AS http_4xx,
            COUNT(*) FILTER (
              WHERE last_crawled_at >= NOW() - INTERVAL '24 hours'
                AND last_status_code >= 500
            )::int AS http_5xx
          FROM crawl_frontier_urls
        `);
      }

      const domains = domainsResult.rows;
      const blocked = domains.filter((d: any) => d.blocked);
      const highBlockRate = domains.filter((d: any) => !d.blocked && d.block_rate > 0.5);
      const queueStatsRow = queueStatsResult.rows[0] || {};
      const runStatsRow = runStatsResult.rows[0] || {};
      const coverageRow = urlCoverageResult.rows[0] || {};
      const toInt = (value: unknown): number => {
        const parsed = Number.parseInt(String(value ?? '0'), 10);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const toFloat = (value: unknown): number => {
        const parsed = Number.parseFloat(String(value ?? '0'));
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const totalAttempts = toInt(runStatsRow.total_attempts);
      const success = toInt(runStatsRow.success);
      const failed = toInt(runStatsRow.failed);
      const blockedAttempts = toInt(runStatsRow.blocked);
      const successRatePct = totalAttempts > 0
        ? Number(((success / totalAttempts) * 100).toFixed(1))
        : 0;

      res.json({
        summary: {
          totalDomains: domains.length,
          blocked: blocked.length,
          highBlockRate: highBlockRate.length,
          totalUrls: parseInt(urlCountResult.rows[0]?.total || '0', 10),
          totalQueue: toInt(queueStatsRow.total),
          dueQueue: toInt(queueStatsRow.due),
          leasedQueue: toInt(queueStatsRow.leased),
          staleLeases: toInt(queueStatsRow.stale_leases),
          dueAgeP50Minutes: Number((toFloat(queueStatsRow.due_age_p50_seconds) / 60).toFixed(1)),
          dueAgeP95Minutes: Number((toFloat(queueStatsRow.due_age_p95_seconds) / 60).toFixed(1)),
          runSuccessRate24h: successRatePct,
          crawledUrls: toInt(coverageRow.crawled_urls),
          neverCrawled: toInt(coverageRow.never_crawled),
          crawledPct: toInt(coverageRow.total_urls) > 0
            ? Number(((toInt(coverageRow.crawled_urls) / toInt(coverageRow.total_urls)) * 100).toFixed(1))
            : 0,
          minsSinceLatestCrawl: coverageRow.mins_since_latest_crawl == null ? null : Number(toFloat(coverageRow.mins_since_latest_crawl).toFixed(1)),
        },
        queue: {
          total: toInt(queueStatsRow.total),
          due: toInt(queueStatsRow.due),
          leased: toInt(queueStatsRow.leased),
          staleLeases: toInt(queueStatsRow.stale_leases),
          dueAgeP50Seconds: Number(toFloat(queueStatsRow.due_age_p50_seconds).toFixed(1)),
          dueAgeP95Seconds: Number(toFloat(queueStatsRow.due_age_p95_seconds).toFixed(1)),
        },
        urls: {
          total: toInt(coverageRow.total_urls),
          crawled: toInt(coverageRow.crawled_urls),
          neverCrawled: toInt(coverageRow.never_crawled),
          crawledPct: toInt(coverageRow.total_urls) > 0
            ? Number(((toInt(coverageRow.crawled_urls) / toInt(coverageRow.total_urls)) * 100).toFixed(1))
            : 0,
          minsSinceLatestCrawl: coverageRow.mins_since_latest_crawl == null ? null : Number(toFloat(coverageRow.mins_since_latest_crawl).toFixed(1)),
          hoursSinceOldestCrawl: coverageRow.hours_since_oldest_crawl == null ? null : Number(toFloat(coverageRow.hours_since_oldest_crawl).toFixed(1)),
        },
        runs24h: {
          mode: runMode,
          totalAttempts,
          success,
          failed,
          blocked: blockedAttempts,
          successRatePct,
          avgDurationMs: Number(toFloat(runStatsRow.avg_duration_ms).toFixed(1)),
          p95DurationMs: Number(toFloat(runStatsRow.p95_duration_ms).toFixed(1)),
        },
        http24h: {
          status2xx: toInt(runStatsRow.http_2xx),
          status304: toInt(runStatsRow.http_304),
          status4xx: toInt(runStatsRow.http_4xx),
          status5xx: toInt(runStatsRow.http_5xx),
        },
        domains,
      });
    } finally {
      pgClient.release();
    }
  } catch (error) {
    console.error('Error fetching frontier monitoring:', error);
    res.status(500).json({ error: 'Failed to fetch frontier monitoring data' });
  }
});

// =============================================================================
// Admin API - Editorial Feedback
// =============================================================================

// GET /api/admin/editorial/review — recent clusters with gating decisions (review queue)
app.get('/api/admin/editorial/review', async (req, res) => {
  if (!ADMIN_KEY) return res.status(500).json({ error: 'ADMIN_KEY is not configured' });
  const providedKey = req.headers['x-admin-key'] as string;
  if (!providedKey || providedKey !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });

  const parsed = editorialReviewQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid query', details: parsed.error.issues });
  const { region, limit } = parsed.data;

  try {
    const pgClient = await pool.connect();
    try {
      const clusters = await pgClient.query(`
        SELECT c.id::text, c.cluster_key, c.title, c.summary, c.story_type, c.topic_tags, c.entities,
               c.rank_score, c.trust_score, c.published_at, c.region,
               d.decision AS gating_decision, d.score_composite AS composite_score, d.decision_reason,
               s.upvote_count, s.save_count, s.not_useful_count,
               ea.action AS editorial_action, ea.reason_category, ea.created_at AS action_at,
               (SELECT ns.source_key FROM news_cluster_items nci
                JOIN news_items_raw nir ON nir.id = nci.raw_item_id
                JOIN news_sources ns ON ns.id = nir.source_id
                WHERE nci.cluster_id = c.id AND nci.is_primary LIMIT 1) AS source_key,
               (SELECT ns.display_name FROM news_cluster_items nci
                JOIN news_items_raw nir ON nir.id = nci.raw_item_id
                JOIN news_sources ns ON ns.id = nir.source_id
                WHERE nci.cluster_id = c.id AND nci.is_primary LIMIT 1) AS source_name
        FROM news_clusters c
        LEFT JOIN news_item_decisions d ON d.cluster_id = c.id AND d.region = c.region
        LEFT JOIN news_item_stats s ON s.cluster_id = c.id
        LEFT JOIN news_editorial_actions ea ON ea.cluster_id = c.id
        WHERE c.published_at > now() - interval '48 hours'
          AND c.region = $1
        ORDER BY c.rank_score DESC, c.published_at DESC
        LIMIT $2
      `, [region, limit]);

      res.json({ clusters: clusters.rows });
    } finally {
      pgClient.release();
    }
  } catch (error) {
    console.error('Error fetching editorial review queue:', error);
    res.status(500).json({ error: 'Failed to fetch review queue' });
  }
});

// POST /api/admin/editorial/actions — create editorial action (reject/approve/flag/pin)
app.post('/api/admin/editorial/actions', async (req, res) => {
  if (!ADMIN_KEY) return res.status(500).json({ error: 'ADMIN_KEY is not configured' });
  const providedKey = req.headers['x-admin-key'] as string;
  if (!providedKey || providedKey !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });

  const parsed = editorialActionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body', details: parsed.error.issues });
  const { cluster_id, action, reason_category, reason_text, title_keywords } = parsed.data;

  try {
    const pgClient = await pool.connect();
    try {
      // Fetch cluster metadata for snapshot
      const cluster = await pgClient.query(`
        SELECT c.region, c.topic_tags, c.entities,
               d.decision, d.score_composite,
               (SELECT ns.source_key FROM news_cluster_items nci
                JOIN news_items_raw nir ON nir.id = nci.raw_item_id
                JOIN news_sources ns ON ns.id = nir.source_id
                WHERE nci.cluster_id = c.id AND nci.is_primary LIMIT 1) AS source_key
        FROM news_clusters c
        LEFT JOIN news_item_decisions d ON d.cluster_id = c.id AND d.region = c.region
        WHERE c.id = $1::uuid
      `, [cluster_id]);

      if (cluster.rows.length === 0) {
        return res.status(404).json({ error: 'Cluster not found' });
      }
      const meta = cluster.rows[0];

      // Insert editorial action
      const result = await pgClient.query(`
        INSERT INTO news_editorial_actions
          (cluster_id, action, reason_category, reason_text, region, source_key,
           topic_tags, entities, title_keywords, system_decision, system_composite_score)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (cluster_id, admin_id, action) DO UPDATE
        SET reason_category = EXCLUDED.reason_category,
            reason_text = EXCLUDED.reason_text,
            title_keywords = EXCLUDED.title_keywords,
            created_at = now()
        RETURNING id::text, created_at
      `, [
        cluster_id, action, reason_category || null, reason_text || null,
        meta.region || 'global', meta.source_key || null,
        meta.topic_tags || [], meta.entities || [],
        title_keywords || [], meta.decision || null,
        meta.score_composite || null,
      ]);

      // If reject: remove from current edition
      if (action === 'reject') {
        await pgClient.query(`
          UPDATE news_daily_editions
          SET top_cluster_ids = array_remove(top_cluster_ids, $1::uuid)
          WHERE edition_date = CURRENT_DATE
            AND region = $2
        `, [cluster_id, meta.region || 'global']);
      }

      res.json({
        action: result.rows[0],
        cluster_id,
        action_type: action,
      });
    } finally {
      pgClient.release();
    }
  } catch (error) {
    console.error('Error creating editorial action:', error);
    res.status(500).json({ error: 'Failed to create editorial action' });
  }
});

// GET /api/admin/editorial/actions — list recent actions
app.get('/api/admin/editorial/actions', async (req, res) => {
  if (!ADMIN_KEY) return res.status(500).json({ error: 'ADMIN_KEY is not configured' });
  const providedKey = req.headers['x-admin-key'] as string;
  if (!providedKey || providedKey !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });

  const parsed = editorialActionsQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid query', details: parsed.error.issues });
  const { region, limit, offset } = parsed.data;

  try {
    const pgClient = await pool.connect();
    try {
      const result = await pgClient.query(`
        SELECT a.id::text, a.cluster_id::text, a.action, a.reason_category, a.reason_text,
               a.region, a.source_key, a.topic_tags, a.entities, a.title_keywords,
               a.system_decision, a.system_composite_score, a.admin_id, a.created_at,
               c.title AS cluster_title
        FROM news_editorial_actions a
        LEFT JOIN news_clusters c ON c.id = a.cluster_id
        WHERE a.region = $1 OR a.region = 'global'
        ORDER BY a.created_at DESC
        LIMIT $2 OFFSET $3
      `, [region, limit, offset]);

      const countResult = await pgClient.query(`
        SELECT count(*)::int AS total FROM news_editorial_actions
        WHERE region = $1 OR region = 'global'
      `, [region]);

      res.json({
        actions: result.rows,
        total: countResult.rows[0]?.total || 0,
      });
    } finally {
      pgClient.release();
    }
  } catch (error) {
    console.error('Error fetching editorial actions:', error);
    res.status(500).json({ error: 'Failed to fetch editorial actions' });
  }
});

// GET /api/admin/editorial/rules — list active + pending rules
app.get('/api/admin/editorial/rules', async (req, res) => {
  if (!ADMIN_KEY) return res.status(500).json({ error: 'ADMIN_KEY is not configured' });
  const providedKey = req.headers['x-admin-key'] as string;
  if (!providedKey || providedKey !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });

  const parsed = editorialRulesQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid query', details: parsed.error.issues });
  const { region, include_pending } = parsed.data;

  try {
    const pgClient = await pool.connect();
    try {
      const whereClause = include_pending === 'true'
        ? 'WHERE r.is_active = true AND (r.region = $1 OR r.region = \'global\')'
        : 'WHERE r.is_active = true AND r.approved_at IS NOT NULL AND (r.region = $1 OR r.region = \'global\')';

      const result = await pgClient.query(`
        SELECT r.id::text, r.rule_type, r.region, r.rule_value, r.rule_weight,
               r.is_active, r.is_auto_generated, r.supporting_action_count,
               r.confidence, r.approved_at, r.expires_at, r.created_at, r.notes
        FROM news_editorial_rules r
        ${whereClause}
        ORDER BY r.is_auto_generated DESC, r.approved_at NULLS FIRST, r.created_at DESC
      `, [region]);

      res.json({ rules: result.rows });
    } finally {
      pgClient.release();
    }
  } catch (error) {
    console.error('Error fetching editorial rules:', error);
    res.status(500).json({ error: 'Failed to fetch editorial rules' });
  }
});

// POST /api/admin/editorial/rules — create a manual rule
app.post('/api/admin/editorial/rules', async (req, res) => {
  if (!ADMIN_KEY) return res.status(500).json({ error: 'ADMIN_KEY is not configured' });
  const providedKey = req.headers['x-admin-key'] as string;
  if (!providedKey || providedKey !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });

  const parsed = editorialRuleCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body', details: parsed.error.issues });
  const { rule_type, region, rule_value, rule_weight, notes } = parsed.data;

  try {
    const pgClient = await pool.connect();
    try {
      const result = await pgClient.query(`
        INSERT INTO news_editorial_rules
          (rule_type, region, rule_value, rule_weight, is_active, is_auto_generated, approved_at, notes)
        VALUES ($1, $2, $3, $4, true, false, now(), $5)
        ON CONFLICT (rule_type, region, rule_value) WHERE is_active = true
        DO UPDATE SET rule_weight = EXCLUDED.rule_weight, notes = EXCLUDED.notes, approved_at = now()
        RETURNING id::text, created_at
      `, [rule_type, region, rule_value, rule_weight, notes || null]);

      res.json({ rule: result.rows[0], rule_type, rule_value });
    } finally {
      pgClient.release();
    }
  } catch (error) {
    console.error('Error creating editorial rule:', error);
    res.status(500).json({ error: 'Failed to create editorial rule' });
  }
});

// PUT /api/admin/editorial/rules/:id — approve or deactivate a rule
app.put('/api/admin/editorial/rules/:id', async (req, res) => {
  if (!ADMIN_KEY) return res.status(500).json({ error: 'ADMIN_KEY is not configured' });
  const providedKey = req.headers['x-admin-key'] as string;
  if (!providedKey || providedKey !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });

  const ruleId = req.params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ruleId)) return res.status(400).json({ error: 'Invalid rule ID' });

  const parsed = editorialRuleUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body', details: parsed.error.issues });
  const { is_active, approved_at, notes } = parsed.data;

  try {
    const pgClient = await pool.connect();
    try {
      const sets: string[] = [];
      const values: any[] = [ruleId];
      let paramIdx = 2;

      if (is_active !== undefined) {
        sets.push(`is_active = $${paramIdx++}`);
        values.push(is_active);
      }
      if (approved_at === 'now') {
        sets.push(`approved_at = now()`);
      }
      if (notes !== undefined) {
        sets.push(`notes = $${paramIdx++}`);
        values.push(notes);
      }

      if (sets.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      const result = await pgClient.query(`
        UPDATE news_editorial_rules
        SET ${sets.join(', ')}
        WHERE id = $1::uuid
        RETURNING id::text, rule_type, rule_value, is_active, approved_at
      `, values);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Rule not found' });
      }

      res.json({ rule: result.rows[0] });
    } finally {
      pgClient.release();
    }
  } catch (error) {
    console.error('Error updating editorial rule:', error);
    res.status(500).json({ error: 'Failed to update editorial rule' });
  }
});

// GET /api/admin/editorial/stats — dashboard summary
app.get('/api/admin/editorial/stats', async (req, res) => {
  if (!ADMIN_KEY) return res.status(500).json({ error: 'ADMIN_KEY is not configured' });
  const providedKey = req.headers['x-admin-key'] as string;
  if (!providedKey || providedKey !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });

  const parsed = editorialStatsQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid query', details: parsed.error.issues });
  const { region, days } = parsed.data;

  try {
    const pgClient = await pool.connect();
    try {
      // Action counts
      const actionStats = await pgClient.query(`
        SELECT action, count(*)::int AS cnt
        FROM news_editorial_actions
        WHERE created_at > now() - make_interval(days => $1)
          AND (region = $2 OR region = 'global')
        GROUP BY action
      `, [days, region]);

      // Rejection by reason category
      const reasonStats = await pgClient.query(`
        SELECT reason_category, count(*)::int AS cnt
        FROM news_editorial_actions
        WHERE action = 'reject'
          AND created_at > now() - make_interval(days => $1)
          AND (region = $2 OR region = 'global')
        GROUP BY reason_category
        ORDER BY cnt DESC
      `, [days, region]);

      // Rejection by source
      const sourceStats = await pgClient.query(`
        SELECT source_key, count(*)::int AS cnt
        FROM news_editorial_actions
        WHERE action = 'reject'
          AND source_key IS NOT NULL
          AND created_at > now() - make_interval(days => $1)
          AND (region = $2 OR region = 'global')
        GROUP BY source_key
        ORDER BY cnt DESC
        LIMIT 10
      `, [days, region]);

      // Pending rules count
      const pendingRules = await pgClient.query(`
        SELECT count(*)::int AS cnt
        FROM news_editorial_rules
        WHERE is_active = true AND is_auto_generated = true AND approved_at IS NULL
          AND (region = $1 OR region = 'global')
      `, [region]);

      // Total active rules
      const activeRules = await pgClient.query(`
        SELECT count(*)::int AS cnt
        FROM news_editorial_rules
        WHERE is_active = true AND approved_at IS NOT NULL
          AND (region = $1 OR region = 'global')
      `, [region]);

      // Total clusters in period for rate calculation
      const totalClusters = await pgClient.query(`
        SELECT count(*)::int AS cnt
        FROM news_clusters
        WHERE published_at > now() - make_interval(days => $1)
          AND region = $2
      `, [days, region]);

      const actions: Record<string, number> = {};
      for (const row of actionStats.rows) {
        actions[row.action] = row.cnt;
      }

      const totalReviewed = Object.values(actions).reduce((a, b) => a + b, 0);
      const rejectionRate = totalReviewed > 0 ? ((actions['reject'] || 0) / totalReviewed) : 0;

      res.json({
        period_days: days,
        total_reviewed: totalReviewed,
        actions,
        rejection_rate: Math.round(rejectionRate * 100),
        total_clusters: totalClusters.rows[0]?.cnt || 0,
        pending_rules: pendingRules.rows[0]?.cnt || 0,
        active_rules: activeRules.rows[0]?.cnt || 0,
        by_reason: reasonStats.rows,
        by_source: sourceStats.rows,
      });
    } finally {
      pgClient.release();
    }
  } catch (error) {
    console.error('Error fetching editorial stats:', error);
    res.status(500).json({ error: 'Failed to fetch editorial stats' });
  }
});

// =============================================================================
// Start Server
// =============================================================================

const server = app.listen(PORT, async () => {
  console.log(`
  ╔════════════════════════════════════════════════════════════╗
  ║  Startup Investments API                                   ║
  ╠════════════════════════════════════════════════════════════╣
  ║  Server:    http://localhost:${PORT}                          ║
  ║  Health:    http://localhost:${PORT}/health                   ║
  ║  API Docs:  http://localhost:${PORT}/api/v1                   ║
  ╚════════════════════════════════════════════════════════════╝
  `);

  // Test database connection on startup with retries
  const connected = await testConnection(3, 2000);
  if (!connected) {
    console.error('Failed to connect to database after multiple attempts');
    process.exit(1);
  }
});

// Graceful shutdown handling
async function gracefulShutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  server.close(async () => {
    console.log('HTTP server closed');
    try { await closeRedisClient(); } catch (err) { console.error('Redis close error:', err); }
    console.log('Redis connection closed');
    try { await closePool(); } catch (err) { console.error('Pool close error:', err); }
    console.log('Cleanup complete. Exiting.');
    process.exit(0);
  });

  // Force exit after 30s if graceful shutdown fails
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
