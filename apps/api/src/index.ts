import express, { Express } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { db, testConnection, closePool, getPoolStats } from './db';
import { startups, fundingRounds, investors } from './db/schema';
import { eq, desc, sql, count, sum } from 'drizzle-orm';
import { logoExtractor } from './services/logo-extractor';

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3001;

// Health check endpoint - MUST be before any auth middleware for K8s probes
app.get('/health', async (req, res) => {
  const dbConnected = await testConnection(1, 0);
  const poolStats = getPoolStats();

  res.json({
    status: dbConnected ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    database: dbConnected ? 'connected' : 'disconnected',
    pool: poolStats,
  });
});

// API Key for authentication
const API_KEY = process.env.API_KEY;

// Front Door ID for origin validation (optional, set after Front Door deployment)
const FRONT_DOOR_ID = process.env.FRONT_DOOR_ID;

// CORS configuration - allow frontend domains
const allowedOrigins = [
  process.env.FRONTEND_URL,
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

    res.json({
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
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
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
// Admin API - Logo Extraction
// =============================================================================

// Admin key for protected admin endpoints
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.API_KEY;

// Extract logos for all startups (admin only)
app.post('/api/admin/extract-logos', async (req, res) => {
  // Validate admin key
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
