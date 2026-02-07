import express, { Express } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { db, pool, testConnection, closePool, getPoolStats } from './db';
import { startups, fundingRounds, investors } from './db/schema';
import { eq, desc, sql, count, sum, and, gte, lte, ilike, or } from 'drizzle-orm';
import { logoExtractor } from './services/logo-extractor';
import { syncRequestSchema } from './validation';
import { slugify, parseLocation, parseFundingAmount } from './utils';
import {
  getRedisClient,
  closeRedisClient,
  invalidateAll,
  getCacheStats,
  dealBookKey,
  periodsKey,
  statsKey,
  filterOptionsKey,
  hashObject,
  CACHE_TTL,
} from './cache/redis';

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.API_KEY;
const FRONT_DOOR_ID = process.env.FRONT_DOOR_ID;
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.API_KEY;

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
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Readiness probe - checks pool stats in-memory only, for K8s readiness checks
app.get('/readyz', (_req, res) => {
  const poolStats = getPoolStats();
  const dbReady = poolStats.totalCount > 0 && poolStats.waitingCount < poolStats.totalCount;
  res.status(dbReady ? 200 : 503).json({
    status: dbReady ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
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
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window per IP
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
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
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
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
      .orderBy(desc(startups.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db.select({ total: count() }).from(startups);

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
    if (!slug) {
      return res.status(400).json({ error: 'Missing slug' });
    }

    const period = (req.query.period as string) || 'all';
    const pf = periodFilter(period);
    const slugExpr = computedSlugExpr();

    const whereForPeriod = pf
      ? and(pf, or(eq(startups.slug, slug), sql`${slugExpr} = ${slug}`))
      : or(eq(startups.slug, slug), sql`${slugExpr} = ${slug}`);

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
        .where(or(eq(startups.slug, slug), sql`${slugExpr} = ${slug}`) as any)
        .orderBy(desc(startups.period), desc(startups.updatedAt), desc(startups.createdAt))
        .limit(1);
    }

    const row = rows?.[0];
    if (!row) {
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
    const slugExpr = computedSlugExpr();
    const [startup] = await db.select({
      logoUrl: sql<string>`logo_url`,
      logoData: startups.logoData,
      logoContentType: startups.logoContentType,
    })
      .from(startups)
      .where(or(eq(startups.slug, req.params.slug), sql`${slugExpr} = ${req.params.slug}`) as any)
      .orderBy(desc(startups.period), desc(startups.updatedAt), desc(startups.createdAt))
      .limit(1);

    if (!startup) {
      return res.status(404).json({ error: 'Logo not found' });
    }

    // Prefer URL redirect (fast path — no binary transfer from DB)
    if (startup.logoUrl) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.redirect(301, startup.logoUrl);
    }

    // Fall back to binary data stored in database
    if (!startup.logoData) {
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

// =============================================================================
// Stats API
// =============================================================================

app.get('/api/v1/stats', async (req, res) => {
  try {
    const period = (req.query.period as string) || 'all';
    const cacheKey = statsKey(period);

    // Check cache first
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          res.setHeader('X-Cache', 'HIT');
          return res.json(JSON.parse(cachedData));
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    res.setHeader('X-Cache', 'MISS');

    const pf = periodFilter(period);

    // Total funding (join through startups for period filter)
    const fundingQuery = db.select({
      total: sum(fundingRounds.amountUsd),
      count: count(),
    }).from(fundingRounds);
    const [fundingResult] = pf
      ? await fundingQuery.innerJoin(startups, eq(fundingRounds.startupId, startups.id)).where(pf)
      : await fundingQuery;

    // Startup count + GenAI count in single query
    const [countResult] = await db.select({
      startupCount: count(),
      genaiCount: sql<number>`COUNT(*) FILTER (WHERE ${startups.genaiNative} = true)`,
    }).from(startups).where(pf);

    // Pattern distribution
    const patternDistribution = await db.select({
      pattern: startups.pattern,
      count: count(),
    })
      .from(startups)
      .where(pf)
      .groupBy(startups.pattern);

    // Stage distribution
    const stageDistribution = await db.select({
      stage: startups.stage,
      count: count(),
    })
      .from(startups)
      .where(pf)
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
        patternDistribution.map(p => [p.pattern || 'unknown', p.count])
      ),
      stageDistribution: Object.fromEntries(
        stageDistribution.map(s => [s.stage || 'unknown', s.count])
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
    // Region-aware periods are planned. For now, only global data exists in Postgres.
    const region = (req.query.region as string) || 'global';
    if (region !== 'global') {
      return res.status(400).json({ error: 'Only global periods are available via API (yet)' });
    }

    const cacheKey = periodsKey();

    // Check cache first
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          res.setHeader('X-Cache', 'HIT');
          return res.json(JSON.parse(cachedData));
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    res.setHeader('X-Cache', 'MISS');

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
      WHERE ${startups.period} IS NOT NULL AND ${startups.period} <> ''
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
    const {
      period = 'all',
      page = '1',
      limit = '25',
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
      sortBy = 'funding',
      sortOrder = 'desc',
      search,
    } = req.query as Record<string, string | undefined>;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 25));
    const offset = (pageNum - 1) * limitNum;

    // Build cache key from query params
    const filters = { limit: limitNum, stage, pattern, continent, vertical, verticalId, subVerticalId, leafId, minFunding, maxFunding, usesGenai, sortBy, sortOrder, search };
    const filtersHash = hashObject(filters);
    const cacheKey = dealBookKey(period, pageNum, filtersHash);

    // Check cache first
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          res.setHeader('X-Cache', 'HIT');
          res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
          return res.json(JSON.parse(cachedData));
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    res.setHeader('X-Cache', 'MISS');

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

    // Funding range filters
    if (minFunding) {
      const minVal = parseInt(minFunding);
      if (!isNaN(minVal)) {
        conditions.push(gte(startups.moneyRaisedUsd, minVal));
      }
    }
    if (maxFunding) {
      const maxVal = parseInt(maxFunding);
      if (!isNaN(maxVal)) {
        conditions.push(lte(startups.moneyRaisedUsd, maxVal));
      }
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
    const orderColumn = sortBy === 'name'
      ? startups.name
      : sortBy === 'date'
        ? startups.createdAt
        : startups.moneyRaisedUsd;
    const defaultOrderDir = sortOrder === 'asc' ? orderColumn : desc(orderColumn);
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
      vertical: sql<string>`${startups.analysisData}->>'vertical'`,
      marketType: sql<string>`${startups.analysisData}->>'market_type'`,
      subVertical: sql<string>`${startups.analysisData}->>'sub_vertical'`,
      subSubVertical: sql<string>`${startups.analysisData}->>'sub_sub_vertical'`,
      verticalTaxonomy: sql<unknown>`${startups.analysisData}->'vertical_taxonomy'`,
      buildPatterns: sql<unknown>`${startups.analysisData}->'build_patterns'`,
      confidenceScore: sql<number>`(${startups.analysisData}->>'confidence_score')::float`,
      newsletterPotential: sql<string>`${startups.analysisData}->>'newsletter_potential'`,
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
        stage: stage || null,
        pattern: pattern || null,
        continent: continent || null,
        vertical: vertical || null,
        verticalId: verticalId || null,
        subVerticalId: subVerticalId || null,
        leafId: leafId || null,
        minFunding: minFunding ? parseInt(minFunding) : null,
        maxFunding: maxFunding ? parseInt(maxFunding) : null,
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
    const { period = 'all', verticalId, subVerticalId } = req.query as Record<string, string | undefined>;
    const cacheKey = `${filterOptionsKey(period as string)}:${hashObject({ verticalId, subVerticalId })}`;

    // Check cache first
    const redis = await getRedisClient();
    if (redis) {
      try {
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          res.setHeader('X-Cache', 'HIT');
          return res.json(JSON.parse(cachedData));
        }
      } catch (cacheErr) {
        console.error('Redis cache read error:', cacheErr);
      }
    }
    res.setHeader('X-Cache', 'MISS');

    // Get distinct stages (prefer latest funding round type, fallback to startup funding_stage)
    const pf = periodFilter(period as string);
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
            WHERE COALESCE(lr.round_type, s.funding_stage) IS NOT NULL
          `
    );

    // Get distinct continents
    const continents = await db.selectDistinct({ continent: startups.continent })
      .from(startups)
      .where(and(
        periodFilter(period as string),
        sql`${startups.continent} IS NOT NULL`
      ));

    // Get pattern counts from JSONB (aggregated in SQL)
    const pf2 = periodFilter(period as string);
    const patternRows = await db.execute<{ pattern: string; count: string }>(
      pf2
        ? sql`SELECT elem->>'name' AS pattern, COUNT(*) AS count
              FROM startups s, jsonb_array_elements(s.analysis_data->'build_patterns') AS elem
              WHERE ${pf2} AND elem->>'name' IS NOT NULL
              GROUP BY elem->>'name'
              ORDER BY count DESC`
        : sql`SELECT elem->>'name' AS pattern, COUNT(*) AS count
              FROM startups s, jsonb_array_elements(s.analysis_data->'build_patterns') AS elem
              WHERE elem->>'name' IS NOT NULL
              GROUP BY elem->>'name'
              ORDER BY count DESC`
    );

    // Distinct verticals (legacy string field in analysis JSON)
    const verticalRows = await db.execute<{ vertical: string }>(
      pf2
        ? sql`SELECT DISTINCT s.analysis_data->>'vertical' AS vertical
              FROM startups s
              WHERE ${pf2}
                AND s.analysis_data->>'vertical' IS NOT NULL
                AND s.analysis_data->>'vertical' <> ''`
        : sql`SELECT DISTINCT s.analysis_data->>'vertical' AS vertical
              FROM startups s
              WHERE s.analysis_data->>'vertical' IS NOT NULL
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
                AND s.analysis_data->'vertical_taxonomy'->'primary'->>'vertical_id' IS NOT NULL
                AND s.analysis_data->'vertical_taxonomy'->'primary'->>'vertical_id' <> ''
              GROUP BY 1, 2
              ORDER BY COUNT(*) DESC`
        : sql`SELECT
                s.analysis_data->'vertical_taxonomy'->'primary'->>'vertical_id' AS id,
                s.analysis_data->'vertical_taxonomy'->'primary'->>'vertical_label' AS label,
                COUNT(*) AS count
              FROM startups s
              WHERE s.analysis_data->'vertical_taxonomy'->'primary'->>'vertical_id' IS NOT NULL
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
                  WHERE s.analysis_data->'vertical_taxonomy'->'primary'->>'vertical_id' = ${verticalId}
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
                  WHERE s.analysis_data->'vertical_taxonomy'->'primary'->>'sub_vertical_id' = ${subVerticalId}
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
    const page = Math.min(100, Math.max(1, parseInt(req.query.page as string) || 1));
    const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
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
// Admin API - Logo Extraction & Data Sync
// =============================================================================

// Sync startups from CSV data (admin only)
app.post('/api/admin/sync-startups', async (req, res) => {
  if (!ADMIN_KEY) {
    return res.status(500).json({ error: 'ADMIN_KEY is not configured' });
  }
  const providedKey = req.headers['x-admin-key'] as string;
  if (!providedKey || providedKey !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid admin key' });
  }

  const parseResult = syncRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid request payload',
      details: parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
    });
  }
  const startupData = parseResult.data.startups;

  console.log(`Syncing ${startupData.length} startups...`);

  const results = {
    total: startupData.length,
    inserted: 0,
    updated: 0,
    failed: [] as { name: string; error: string }[],
  };

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
    .where(sql`${startups.slug} = ANY(${allSlugs})`);
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
            `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
          );
          params.push(s.name, s.slug, s.description, s.website, s.city, s.country, s.continent, s.industry, s.stage);
        }

        const insertResult = await pgClient.query(
          `INSERT INTO startups (name, slug, description, website, headquarters_city, headquarters_country, continent, industry, stage)
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
                headquartersCountry: s.country, continent: s.continent, industry: s.industry, stage: s.stage, updatedAt: new Date(),
              }).where(eq(startups.id, id));
              results.updated++;
              if (s.raw.amountUsd && s.raw.roundType) {
                const fundingAmount = parseFundingAmount(s.raw.amountUsd);
                await db.insert(fundingRounds).values({
                  startupId: id, roundType: s.raw.roundType,
                  amountUsd: fundingAmount, announcedDate: s.raw.announcedDate || null, leadInvestor: s.raw.leadInvestors || null,
                }).onConflictDoNothing();
              }
            }
          } catch (innerError) {
            results.failed.push({ name: s.name, error: String(innerError) });
          }
        }
      }
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
    res.status(500).json({ error: 'Logo extraction failed', details: String(error) });
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
    await closeRedisClient();
    console.log('Redis connection closed');
    await closePool();
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
