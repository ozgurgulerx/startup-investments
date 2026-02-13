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
-- Non-partial unique index so ON CONFLICT (startup_id, round_type, announced_date) works.
-- NULL announced_date rows won't conflict with each other (SQL NULL != NULL).
CREATE UNIQUE INDEX IF NOT EXISTS idx_funding_rounds_unique
  ON funding_rounds (startup_id, round_type, announced_date);

-- 2. Make slug unique on startups table
-- First, deduplicate any slug collisions (keep the most recently updated)
-- This is a safety check — in practice slugs should already be unique
DO $$
DECLARE
  dup RECORD;
  suffix INTEGER;
  new_slug TEXT;
  has_region BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'startups' AND column_name = 'dataset_region'
  ) INTO has_region;

  IF has_region THEN
    FOR dup IN
      SELECT dataset_region, slug, array_agg(id ORDER BY updated_at DESC NULLS LAST) AS ids
      FROM startups WHERE slug IS NOT NULL
      GROUP BY dataset_region, slug HAVING COUNT(*) > 1
    LOOP
      FOR i IN 2..array_length(dup.ids, 1) LOOP
        suffix := 1;
        LOOP
          new_slug := dup.slug || '-' || suffix;
          EXIT WHEN NOT EXISTS (
            SELECT 1 FROM startups
            WHERE dataset_region = dup.dataset_region AND slug = new_slug
          );
          suffix := suffix + 1;
        END LOOP;
        UPDATE startups SET slug = new_slug WHERE id = dup.ids[i];
      END LOOP;
    END LOOP;
  ELSE
    FOR dup IN
      SELECT slug, array_agg(id ORDER BY updated_at DESC NULLS LAST) AS ids
      FROM startups WHERE slug IS NOT NULL
      GROUP BY slug HAVING COUNT(*) > 1
    LOOP
      FOR i IN 2..array_length(dup.ids, 1) LOOP
        suffix := 1;
        LOOP
          new_slug := dup.slug || '-' || suffix;
          EXIT WHEN NOT EXISTS (
            SELECT 1 FROM startups WHERE slug = new_slug
          );
          suffix := suffix + 1;
        END LOOP;
        UPDATE startups SET slug = new_slug WHERE id = dup.ids[i];
      END LOOP;
    END LOOP;
  END IF;
END $$;

-- Index creation removed: migration 022 is the authority on idx_startups_slug
-- and creates it as (dataset_region, slug) for multi-region support.
