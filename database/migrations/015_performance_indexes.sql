-- Migration 015: Performance indexes and logo_url column
-- Safe to run online — CREATE INDEX CONCURRENTLY not used here since indexes
-- use IF NOT EXISTS and the table is small (~300 rows).

-- =============================================================================
-- 1. Trigram indexes for ILIKE search
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_startups_name_trgm
  ON startups USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_startups_description_trgm
  ON startups USING GIN (description gin_trgm_ops);

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
