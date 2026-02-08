-- 026_refinery_enhancements.sql
-- Enhancements for the editorial intelligence refinery (Phase 2).
-- Adds columns to existing Phase 2-4 placeholder tables from migration 023.
-- Idempotent — safe to re-run.

-- 1. news_pattern_library: add description + last_seen_at
ALTER TABLE news_pattern_library ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE news_pattern_library ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 2. news_item_extractions: add heuristic scores cache
ALTER TABLE news_item_extractions ADD COLUMN IF NOT EXISTS heuristic_scores_json JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 3. news_item_decisions: add region + scoring_method
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'news_item_decisions' AND column_name = 'region'
    ) THEN
        ALTER TABLE news_item_decisions ADD COLUMN region TEXT NOT NULL DEFAULT 'global';
        ALTER TABLE news_item_decisions ADD CONSTRAINT chk_item_decisions_region
            CHECK (region IN ('global', 'turkey'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'news_item_decisions' AND column_name = 'scoring_method'
    ) THEN
        ALTER TABLE news_item_decisions ADD COLUMN scoring_method TEXT NOT NULL DEFAULT 'heuristic';
        ALTER TABLE news_item_decisions ADD CONSTRAINT chk_item_decisions_scoring_method
            CHECK (scoring_method IN ('heuristic', 'llm_judge', 'hybrid'));
    END IF;
END $$;

-- 4. news_gtm_taxonomy: add region
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'news_gtm_taxonomy' AND column_name = 'region'
    ) THEN
        ALTER TABLE news_gtm_taxonomy ADD COLUMN region TEXT NOT NULL DEFAULT 'global';
        ALTER TABLE news_gtm_taxonomy ADD CONSTRAINT chk_gtm_taxonomy_region
            CHECK (region IN ('global', 'turkey'));
    END IF;
END $$;

-- Replace the old unique constraint on tag with (tag, region)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'news_gtm_taxonomy_tag_key') THEN
        ALTER TABLE news_gtm_taxonomy DROP CONSTRAINT news_gtm_taxonomy_tag_key;
    END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS news_gtm_taxonomy_tag_region ON news_gtm_taxonomy(tag, region);

-- 5. Indexes for decision queries
CREATE INDEX IF NOT EXISTS idx_item_decisions_region_decision
    ON news_item_decisions(region, decision, created_at DESC);
