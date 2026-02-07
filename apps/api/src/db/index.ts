import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, PoolClient } from 'pg';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/startupinvestments';

// Connection pool configuration following best practices
const pool = new Pool({
  connectionString,
  // Pool sizing
  max: 20,                          // Maximum connections in pool
  min: 2,                           // Minimum connections to keep ready

  // Timeouts
  idleTimeoutMillis: 30000,         // Close idle connections after 30s
  connectionTimeoutMillis: 10000,   // Fail if can't connect within 10s

  // SSL for production (Azure PostgreSQL requires SSL)
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false } // Azure uses self-signed certs
    : false,

  // Statement timeout to prevent runaway queries
  statement_timeout: 30000,         // 30s query timeout

  // Application name for monitoring
  application_name: 'startup-investments-api',
});

// Handle pool errors (connection drops, etc.)
pool.on('error', (err: Error, _client: PoolClient) => {
  console.error('Unexpected database pool error:', err.message);
  // Don't exit - pool will remove the bad client automatically
});

pool.on('connect', () => {
  console.log('New database connection established');
});

export const db = drizzle(pool, { schema });

// Health check with retry logic
export async function testConnection(retries = 3, delay = 1000): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const client = await pool.connect();
      await client.query('SELECT 1'); // Verify connection is actually working
      console.log('✓ Database connected successfully');
      client.release();
      return true;
    } catch (error) {
      console.error(`✗ Database connection attempt ${attempt}/${retries} failed:`,
        error instanceof Error ? error.message : error);

      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, delay * attempt));
      }
    }
  }
  return false;
}

// Graceful shutdown
export async function closePool(): Promise<void> {
  console.log('Closing database pool...');
  await pool.end();
  console.log('Database pool closed');
}

// Export pool for raw SQL operations (e.g., bulk upserts)
export { pool };

// For health checks - get pool statistics
export function getPoolStats() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
}
