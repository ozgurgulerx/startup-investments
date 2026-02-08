-- Regional memory awareness for the memory gate system
--
-- Adds region column to news_entity_facts and news_pattern_library
-- so the Turkish memory system can maintain separate facts while
-- reading global facts for context (one-way merge).
--
-- Key design: Turkey reads global + turkey facts; global reads only global.

-- =========================================================================
-- 1. Add region to news_entity_facts
-- =========================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'news_entity_facts' AND column_name = 'region'
    ) THEN
        ALTER TABLE news_entity_facts
            ADD COLUMN region TEXT NOT NULL DEFAULT 'global';
        ALTER TABLE news_entity_facts
            ADD CONSTRAINT chk_entity_facts_region CHECK (region IN ('global', 'turkey'));
    END IF;
END $$;

-- Recreate the current-facts index to include region
DROP INDEX IF EXISTS idx_entity_facts_current;
CREATE INDEX IF NOT EXISTS idx_entity_facts_current
    ON news_entity_facts(entity_name, fact_key, region)
    WHERE is_current = TRUE;

-- Index for querying all current facts in a region (used by EntityIndex.load)
CREATE INDEX IF NOT EXISTS idx_entity_facts_region_current
    ON news_entity_facts(region)
    WHERE is_current = TRUE;

-- =========================================================================
-- 2. Add region to news_pattern_library
-- =========================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'news_pattern_library' AND column_name = 'region'
    ) THEN
        ALTER TABLE news_pattern_library
            ADD COLUMN region TEXT NOT NULL DEFAULT 'global';
        ALTER TABLE news_pattern_library
            ADD CONSTRAINT chk_pattern_library_region CHECK (region IN ('global', 'turkey'));
    END IF;
END $$;

-- Recreate unique constraint to include region
-- (same pattern can exist in both regions independently)
DO $$
BEGIN
    -- Drop the old unique constraint on pattern_name alone
    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'news_pattern_library_pattern_name_key'
    ) THEN
        ALTER TABLE news_pattern_library DROP CONSTRAINT IF EXISTS news_pattern_library_pattern_name_key;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS news_pattern_library_pattern_name_region
    ON news_pattern_library(pattern_name, region);

-- Note: this migration is idempotent (safe to re-run).
