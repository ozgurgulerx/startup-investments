import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/startupinvestments';

const pool = new Pool({
  connectionString,
  max: 10,
});

export const db = drizzle(pool, { schema });

// Test connection
export async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('✓ Database connected successfully');
    client.release();
    return true;
  } catch (error) {
    console.error('✗ Database connection failed:', error);
    return false;
  }
}
