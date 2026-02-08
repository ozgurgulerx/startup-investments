-- Migration: Add dataset_region for multi-dataset support (global + turkey)
--
-- Motivation:
-- - We need to store multiple independent startup datasets side-by-side (e.g. Global vs Turkey)
-- - Slugs must be unique per dataset, not globally.

-- Add region column (defaults existing rows to 'global')
ALTER TABLE startups
ADD COLUMN IF NOT EXISTS dataset_region VARCHAR(20) NOT NULL DEFAULT 'global';

-- Defensive backfill (should be redundant with NOT NULL + DEFAULT)
UPDATE startups
SET dataset_region = 'global'
WHERE dataset_region IS NULL OR dataset_region = '';

-- Replace old slug uniqueness with per-region uniqueness
DROP INDEX IF EXISTS idx_startups_slug;
CREATE UNIQUE INDEX IF NOT EXISTS idx_startups_slug
  ON startups(dataset_region, slug)
  WHERE slug IS NOT NULL;

-- Preserve fast lookups by slug when callers don't yet pass dataset_region.
-- (Non-unique because the same slug can exist across datasets.)
CREATE INDEX IF NOT EXISTS idx_startups_slug_lookup
  ON startups(slug)
  WHERE slug IS NOT NULL;

-- Supporting indexes for common filters
CREATE INDEX IF NOT EXISTS idx_startups_dataset_region
  ON startups(dataset_region);

CREATE INDEX IF NOT EXISTS idx_startups_dataset_region_period
  ON startups(dataset_region, period);
