-- Migration 040: Architecture History
--
-- Tracks when patterns are adopted/dropped by comparing consecutive state
-- snapshots. Enables temporal queries like "time from Series A to
-- agent-orchestration adoption."
--
-- Part of the Startup Intelligence Dossier System (Phase 2).

-- =============================================================================
-- 1. ARCHITECTURE HISTORY — Pattern change log
-- =============================================================================

CREATE TABLE IF NOT EXISTS startup_architecture_history (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    startup_id      UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,

    -- What changed
    domain          TEXT NOT NULL,
    pattern_name    TEXT NOT NULL,
    change_type     TEXT NOT NULL CHECK (change_type IN ('added', 'removed', 'upgraded')),

    -- Context at time of change
    funding_stage_at_change TEXT,
    confidence      REAL,

    -- Timestamps
    detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    prev_snapshot_at TIMESTAMPTZ,

    CONSTRAINT uq_arch_history_event UNIQUE (startup_id, domain, pattern_name, detected_at)
);

CREATE INDEX IF NOT EXISTS idx_arch_history_startup
    ON startup_architecture_history(startup_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_arch_history_pattern
    ON startup_architecture_history(pattern_name, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_arch_history_stage
    ON startup_architecture_history(funding_stage_at_change);

COMMENT ON TABLE startup_architecture_history IS
    'Records pattern adoption/removal events detected by diffing consecutive state snapshots. Enables temporal queries about architecture evolution and stage-correlated pattern adoption.';

-- =============================================================================
-- 2. EXTEND STARTUP_EVENTS source_type CHECK — Add analysis_diff source
-- =============================================================================
-- Drop and re-add the CHECK constraint to include 'analysis_diff'.
-- The existing constraint from migration 036 allows: news, crawl_diff, blog, social, manual.

DO $$
BEGIN
    -- Drop old constraint if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage
        WHERE table_name = 'startup_events' AND column_name = 'source_type'
    ) THEN
        ALTER TABLE startup_events DROP CONSTRAINT IF EXISTS startup_events_source_type_check;
    END IF;

    -- Re-add with analysis_diff included
    ALTER TABLE startup_events
        ADD CONSTRAINT startup_events_source_type_check
        CHECK (source_type IN ('news', 'crawl_diff', 'blog', 'social', 'manual', 'analysis_diff'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
