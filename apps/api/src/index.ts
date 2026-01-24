import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { db, testConnection } from './db';
import { startups, fundingRounds, investors } from './db/schema';
import { eq, desc, sql, count, sum } from 'drizzle-orm';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());

// Health check endpoint
app.get('/health', async (req, res) => {
  const dbConnected = await testConnection();
  res.json({
    status: dbConnected ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    database: dbConnected ? 'connected' : 'disconnected',
  });
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
// Start Server
// =============================================================================

app.listen(PORT, async () => {
  console.log(`
  ╔════════════════════════════════════════════════════════════╗
  ║  Startup Investments API                                   ║
  ╠════════════════════════════════════════════════════════════╣
  ║  Server:    http://localhost:${PORT}                          ║
  ║  Health:    http://localhost:${PORT}/health                   ║
  ║  API Docs:  http://localhost:${PORT}/api/v1                   ║
  ╚════════════════════════════════════════════════════════════╝
  `);

  // Test database connection on startup
  await testConnection();
});

export default app;
