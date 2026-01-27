import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Temporary migration endpoint - remove after running once
// Access via: https://buildatlas.net/api/migrate?key=run-migration-2026

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');

  // Simple protection
  if (key !== 'run-migration-2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const migrationSQL = `
    -- Create users table
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL,
      email_lower VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255),
      full_name VARCHAR(255),
      role VARCHAR(50) NOT NULL DEFAULT 'user',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      google_id VARCHAR(255),
      avatar_url VARCHAR(500),
      last_login TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(email_lower);
    CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

    -- Create user_watchlists table
    CREATE TABLE IF NOT EXISTS user_watchlists (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, startup_id)
    );

    CREATE INDEX IF NOT EXISTS idx_watchlists_user ON user_watchlists(user_id);
    CREATE INDEX IF NOT EXISTS idx_watchlists_startup ON user_watchlists(startup_id);

    -- Create user_preferences table
    CREATE TABLE IF NOT EXISTS user_preferences (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
      audience VARCHAR(20) DEFAULT 'builders',
      email_notifications BOOLEAN DEFAULT TRUE,
      saved_filters JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_preferences_user ON user_preferences(user_id);
  `;

  try {
    await query(migrationSQL);

    // Verify tables were created
    const verification = await query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('users', 'user_watchlists', 'user_preferences')
      AND table_schema = 'public'
    `);

    return NextResponse.json({
      success: true,
      message: 'Migration completed successfully',
      tables: verification.rows.map((r) => r.table_name),
    });
  } catch (error) {
    console.error('Migration failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
