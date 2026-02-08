-- Migration 015: Performance indexes and logo_url column
-- Safe to run online — CREATE INDEX CONCURRENTLY not used here since indexes
-- use IF NOT EXISTS and the table is small (~300 rows).

-- =============================================================================
-- 1. Trigram indexes for ILIKE search
-- =============================================================================
DO $$
BEGIN
  -- Azure Database for PostgreSQL may not allow-list pg_trgm on all SKUs/configs.
  -- Keep the migration non-fatal: try, then skip trigram indexes if unavailable.
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm extension is not available; skipping trigram indexes';
  END;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_startups_name_trgm
      ON startups USING GIN (name gin_trgm_ops);

    CREATE INDEX IF NOT EXISTS idx_startups_description_trgm
      ON startups USING GIN (description gin_trgm_ops);
  END IF;
END $$;

-- =============================================================================
-- 2. Composite indexes for multi-filter dealbook queries
-- =============================================================================

-- Period + continent (dealbook continent filter)
CREATE INDEX IF NOT EXISTS idx_startups_period_continent
  ON startups(period, continent);

-- =============================================================================
-- 3. Partial indexes for automation queries
-- =============================================================================

-- Crawl monitoring: ORDER BY last_crawl_at ASC NULLS FIRST WHERE website IS NOT NULL
CREATE INDEX IF NOT EXISTS idx_startups_last_crawl
  ON startups(last_crawl_at ASC NULLS FIRST)
  WHERE website IS NOT NULL;

-- Unprocessed events with date ordering
CREATE INDEX IF NOT EXISTS idx_events_unprocessed
  ON startup_events(detected_at ASC)
  WHERE processed = false;

-- =============================================================================
-- 4. Composite indexes for user queries
-- =============================================================================

-- Watchlist sorted by date per user
CREATE INDEX IF NOT EXISTS idx_watchlists_user_created
  ON user_watchlists(user_id, created_at DESC);

-- =============================================================================
-- 5. Functional index for case-insensitive name lookup
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_startups_name_lower
  ON startups(LOWER(name));

-- =============================================================================
-- 6. Logo URL column for blob storage migration
-- =============================================================================

ALTER TABLE startups ADD COLUMN IF NOT EXISTS logo_url TEXT;
