-- Migration 010: Add missing unique constraints
-- Fixes: funding_rounds duplicates (#4), slug uniqueness (#5)

-- 1. Add unique constraint on funding_rounds to prevent duplicate rounds
-- First, deduplicate any existing duplicates (keep the oldest by created_at)
DELETE FROM funding_rounds
WHERE id NOT IN (
  SELECT DISTINCT ON (startup_id, round_type, announced_date)
    id
  FROM funding_rounds
  ORDER BY startup_id, round_type, announced_date, created_at ASC
);

-- Now add the constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_funding_rounds_unique
  ON funding_rounds (startup_id, round_type, announced_date)
  WHERE announced_date IS NOT NULL;

-- Also handle cases where announced_date is NULL (separate partial index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_funding_rounds_unique_no_date
  ON funding_rounds (startup_id, round_type)
  WHERE announced_date IS NULL;

-- 2. Make slug unique on startups table
-- First, deduplicate any slug collisions (keep the most recently updated)
-- This is a safety check — in practice slugs should already be unique
DO $$
DECLARE
  dup RECORD;
  suffix INTEGER;
BEGIN
  FOR dup IN
    SELECT slug, array_agg(id ORDER BY updated_at DESC NULLS LAST) AS ids
    FROM startups
    WHERE slug IS NOT NULL
    GROUP BY slug
    HAVING COUNT(*) > 1
  LOOP
    suffix := 1;
    -- Skip the first (most recent) — rename the duplicates
    FOR i IN 2..array_length(dup.ids, 1) LOOP
      UPDATE startups SET slug = dup.slug || '-' || suffix WHERE id = dup.ids[i];
      suffix := suffix + 1;
    END LOOP;
  END LOOP;
END $$;

-- Drop the old non-unique index and create a unique one
DROP INDEX IF EXISTS idx_startups_slug;
CREATE UNIQUE INDEX idx_startups_slug ON startups(slug) WHERE slug IS NOT NULL;
