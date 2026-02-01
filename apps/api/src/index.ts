import express, { Express } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { db, testConnection, closePool, getPoolStats } from './db';
import { startups, fundingRounds, investors } from './db/schema';
import { eq, desc, sql, count, sum, and, gte, lte, ilike, or } from 'drizzle-orm';
import { logoExtractor } from './services/logo-extractor';
import {
  getRedisClient,
  closeRedisClient,
  cached,
  invalidateAll,
  getCacheStats,
  dealBookKey,
  statsKey,
  filterOptionsKey,
  hashObject,
  CACHE_TTL,
} from './cache/redis';

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3001;

// Health check endpoint - MUST be before any auth middleware for K8s probes
app.get('/health', async (req, res) => {
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

// API Key for authentication
const API_KEY = process.env.API_KEY;

// Front Door ID for origin validation (optional, set after Front Door deployment)
const FRONT_DOOR_ID = process.env.FRONT_DOOR_ID;

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
app.use(express.json());

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
  // Skip health checks (needed for K8s probes and Front Door health probes)
  if (req.path === '/health') {
    return next();
  }

  // Skip logo endpoints (public images, allow direct access for browser requests)
  if (req.path.match(/^\/api\/startups\/[^/]+\/logo$/)) {
    return next();
  }

  // Allow localhost for admin endpoints (internal pod access)
  const ip = req.ip || req.socket.remoteAddress || '';
  const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (isLocalhost && req.path.startsWith('/api/admin')) {
    return next();
  }

  // In production, validate Front Door ID if configured
  if (process.env.NODE_ENV === 'production' && FRONT_DOOR_ID) {
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
  // Skip health checks (needed for K8s probes)
  if (req.path === '/health') {
    return next();
  }

  // Skip logo endpoints (public images, no auth needed)
  if (req.path.match(/^\/api\/startups\/[^/]+\/logo$/)) {
    return next();
  }

  // Allow localhost for admin endpoints (internal pod access)
  const ip = req.ip || req.socket.remoteAddress || '';
  const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (isLocalhost && req.path.startsWith('/api/admin')) {
    return next();
  }

  // In production, require API key for all API routes
  if (process.env.NODE_ENV === 'production' && API_KEY) {
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
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const results = await db.select()
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
    const [startup] = await db.select()
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

// Get startup logo by slug
app.get('/api/startups/:slug/logo', async (req, res) => {
  try {
    const [startup] = await db.select({
      logoData: startups.logoData,
      logoContentType: startups.logoContentType,
    })
      .from(startups)
      .where(eq(startups.slug, req.params.slug));

    if (!startup || !startup.logoData) {
      return res.status(404).json({ error: 'Logo not found' });
    }

    // Set cache headers (logos don't change often)
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

    // Total funding
    const [fundingResult] = await db.select({
      total: sum(fundingRounds.amountUsd),
      count: count(),
    }).from(fundingRounds);

    // Startup count
    const [startupResult] = await db.select({ count: count() }).from(startups);

    // GenAI native count
    const [genaiResult] = await db.select({ count: count() })
      .from(startups)
      .where(eq(startups.genaiNative, true));

    // Pattern distribution
    const patternDistribution = await db.select({
      pattern: startups.pattern,
      count: count(),
    })
      .from(startups)
      .groupBy(startups.pattern);

    // Stage distribution
    const stageDistribution = await db.select({
      stage: startups.stage,
      count: count(),
    })
      .from(startups)
      .groupBy(startups.stage);

    const responseData = {
      totalFunding: fundingResult.total || 0,
      totalDeals: fundingResult.count || 0,
      totalStartups: startupResult.count || 0,
      genaiNativeCount: genaiResult.count || 0,
      genaiAdoptionRate: startupResult.count > 0
        ? ((genaiResult.count / startupResult.count) * 100).toFixed(1)
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
// Dealbook API - Paginated startups with filtering
// =============================================================================

app.get('/api/v1/dealbook', async (req, res) => {
  try {
    const {
      period = '2026-01',
      page = '1',
      limit = '25',
      stage,
      pattern,
      continent,
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
    const filters = { stage, pattern, continent, minFunding, maxFunding, usesGenai, sortBy, sortOrder, search };
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

    // Build WHERE conditions
    const conditions: ReturnType<typeof eq>[] = [];

    // Period filter (always applied)
    conditions.push(eq(startups.period, period));

    // Stage filter
    if (stage) {
      conditions.push(eq(startups.fundingStage, stage));
    }

    // Continent filter
    if (continent) {
      conditions.push(eq(startups.continent, continent));
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

    // Search filter (name or description)
    if (search) {
      conditions.push(
        or(
          ilike(startups.name, `%${search}%`),
          ilike(startups.description, `%${search}%`)
        ) as ReturnType<typeof eq>
      );
    }

    // Combine all conditions
    const whereClause = patternCondition
      ? and(...conditions, patternCondition)
      : conditions.length > 0
        ? and(...conditions)
        : undefined;

    // Determine sort order
    const orderColumn = sortBy === 'name'
      ? startups.name
      : sortBy === 'date'
        ? startups.createdAt
        : startups.moneyRaisedUsd;
    const orderDir = sortOrder === 'asc' ? orderColumn : desc(orderColumn);

    // Execute query with pagination - only select fields needed by frontend
    // Use SQL JSONB operators to extract specific fields instead of full JSONB
    const results = await db.select({
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
      // Extract only needed JSONB fields for performance
      vertical: sql<string>`${startups.analysisData}->>'vertical'`,
      marketType: sql<string>`${startups.analysisData}->>'market_type'`,
      subVertical: sql<string>`${startups.analysisData}->>'sub_vertical'`,
      buildPatterns: sql<unknown>`${startups.analysisData}->'build_patterns'`,
      confidenceScore: sql<number>`(${startups.analysisData}->>'confidence_score')::float`,
      newsletterPotential: sql<string>`${startups.analysisData}->>'newsletter_potential'`,
    })
      .from(startups)
      .where(whereClause)
      .orderBy(orderDir)
      .limit(limitNum)
      .offset(offset);

    // Get total count for pagination
    const [countResult] = await db.select({ total: count() })
      .from(startups)
      .where(whereClause);

    const total = countResult?.total || 0;

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
      funding_amount: row.moneyRaisedUsd,
      funding_stage: row.fundingStage,
      uses_genai: row.usesGenai,
      build_patterns: row.buildPatterns as Array<{ name: string; confidence: number }> | null,
      confidence_score: row.confidenceScore,
      newsletter_potential: row.newsletterPotential,
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
    const { period = '2026-01' } = req.query;
    const cacheKey = filterOptionsKey(period as string);

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

    // Get distinct stages
    const stages = await db.selectDistinct({ stage: startups.fundingStage })
      .from(startups)
      .where(and(
        eq(startups.period, period as string),
        sql`${startups.fundingStage} IS NOT NULL`
      ));

    // Get distinct continents
    const continents = await db.selectDistinct({ continent: startups.continent })
      .from(startups)
      .where(and(
        eq(startups.period, period as string),
        sql`${startups.continent} IS NOT NULL`
      ));

    // Get pattern counts from JSONB
    const patternCounts = await db.select({
      pattern: sql<string>`jsonb_array_elements(${startups.analysisData}->'build_patterns')->>'name'`.as('pattern'),
    })
      .from(startups)
      .where(eq(startups.period, period as string));

    // Aggregate pattern counts
    const patternMap = new Map<string, number>();
    for (const row of patternCounts) {
      if (row.pattern) {
        patternMap.set(row.pattern, (patternMap.get(row.pattern) || 0) + 1);
      }
    }

    const responseData = {
      stages: stages.map(s => s.stage).filter(Boolean).sort(),
      continents: continents.map(c => c.continent).filter(Boolean).sort(),
      patterns: Array.from(patternMap.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count })),
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
    const results = await db.select()
      .from(investors)
      .orderBy(investors.name);

    res.json({ data: results });
  } catch (error) {
    console.error('Error fetching investors:', error);
    res.status(500).json({ error: 'Failed to fetch investors' });
  }
});

// =============================================================================
// Admin API - Logo Extraction & Data Sync
// =============================================================================

// Admin key for protected admin endpoints
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.API_KEY;

// Helper to slugify startup names
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Sync startups from CSV data (admin only)
app.post('/api/admin/sync-startups', async (req, res) => {
  // Allow localhost without admin key (internal pod access)
  const ip = req.ip || req.socket.remoteAddress || '';
  const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

  // Validate admin key (skip for localhost)
  if (!isLocalhost) {
    const providedKey = req.headers['x-admin-key'] as string;
    if (!providedKey || providedKey !== ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized: Invalid admin key' });
    }
  }

  const { startups: startupData } = req.body;

  if (!Array.isArray(startupData) || startupData.length === 0) {
    return res.status(400).json({ error: 'Invalid request: startups array required' });
  }

  console.log(`Syncing ${startupData.length} startups...`);

  const results = {
    total: startupData.length,
    inserted: 0,
    updated: 0,
    failed: [] as { name: string; error: string }[],
  };

  for (const startup of startupData) {
    try {
      const slug = slugify(startup.name);

      // Parse location
      const locationParts = (startup.location || '').split(', ');
      const city = locationParts[0] || null;
      const country = locationParts.length >= 3 ? locationParts[locationParts.length - 3] : null;
      const continent = locationParts[locationParts.length - 1] || null;

      // Parse industries (first one as primary)
      const industries = (startup.industries || '').split(', ');
      const industry = industries[0] || null;

      // Determine stage from funding type
      const stage = startup.fundingStage || null;

      // UPSERT startup
      const [existing] = await db.select({ id: startups.id })
        .from(startups)
        .where(eq(startups.slug, slug));

      if (existing) {
        // Update existing
        await db.update(startups)
          .set({
            description: startup.description,
            website: startup.website,
            headquartersCity: city,
            headquartersCountry: country,
            continent: continent,
            industry: industry,
            stage: stage,
            updatedAt: new Date(),
          })
          .where(eq(startups.id, existing.id));
        results.updated++;

        // Add funding round if present
        if (startup.amountUsd && startup.roundType) {
          await db.insert(fundingRounds)
            .values({
              startupId: existing.id,
              roundType: startup.roundType,
              amountUsd: parseInt(startup.amountUsd) || null,
              announcedDate: startup.announcedDate || null,
              leadInvestor: startup.leadInvestors || null,
            })
            .onConflictDoNothing();
        }
      } else {
        // Insert new
        const [newStartup] = await db.insert(startups)
          .values({
            name: startup.name,
            slug: slug,
            description: startup.description,
            website: startup.website,
            headquartersCity: city,
            headquartersCountry: country,
            continent: continent,
            industry: industry,
            stage: stage,
          })
          .returning({ id: startups.id });

        results.inserted++;

        // Add funding round if present
        if (newStartup && startup.amountUsd && startup.roundType) {
          await db.insert(fundingRounds)
            .values({
              startupId: newStartup.id,
              roundType: startup.roundType,
              amountUsd: parseInt(startup.amountUsd) || null,
              announcedDate: startup.announcedDate || null,
              leadInvestor: startup.leadInvestors || null,
            });
        }
      }
    } catch (error) {
      console.error(`Failed to sync startup ${startup.name}:`, error);
      results.failed.push({ name: startup.name, error: String(error) });
    }
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
  // Allow localhost without admin key (internal pod access)
  const ip = req.ip || req.socket.remoteAddress || '';
  const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

  // Validate admin key (skip for localhost)
  if (!isLocalhost) {
    const providedKey = req.headers['x-admin-key'] as string;
    if (!providedKey || providedKey !== ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized: Invalid admin key' });
    }
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
