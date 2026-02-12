-- Migration 039: Startup State Snapshot
--
-- Extracts structured, queryable state from monolithic analysis_data JSONB
-- into a dedicated table. Enables cross-startup comparison queries and
-- temporal state tracking that are impossible with raw JSONB.
--
-- Part of the Startup Intelligence Dossier System (Phase 1).

-- =============================================================================
-- 1. STARTUP STATE SNAPSHOT — Queryable startup state per analysis period
-- =============================================================================

CREATE TABLE IF NOT EXISTS startup_state_snapshot (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    startup_id      UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,

    -- Classification
    funding_stage   TEXT,
    vertical        TEXT,
    sub_vertical    TEXT,
    market_type     TEXT,
    target_market   TEXT,
    genai_intensity TEXT,

    -- Architecture state (arrays for set operations)
    build_patterns      TEXT[] NOT NULL DEFAULT '{}',
    discovered_patterns TEXT[] NOT NULL DEFAULT '{}',
    tech_stack_models   TEXT[] NOT NULL DEFAULT '{}',
    tech_stack_frameworks TEXT[] NOT NULL DEFAULT '{}',
    tech_stack_vector_dbs TEXT[] NOT NULL DEFAULT '{}',

    -- GTM state
    pricing_model   TEXT,
    gtm_motion      TEXT,

    -- Scores
    engineering_quality_score REAL,
    confidence_score          REAL,
    implementation_maturity   TEXT,

    -- Competitive
    moat_type       TEXT,

    -- Metadata
    snapshot_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    analysis_period TEXT,
    source          TEXT NOT NULL DEFAULT 'analysis',

    CONSTRAINT uq_startup_state_latest UNIQUE (startup_id, analysis_period)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_state_snapshot_stage
    ON startup_state_snapshot(funding_stage);
CREATE INDEX IF NOT EXISTS idx_state_snapshot_vertical
    ON startup_state_snapshot(vertical);
CREATE INDEX IF NOT EXISTS idx_state_snapshot_patterns
    ON startup_state_snapshot USING GIN(build_patterns);
CREATE INDEX IF NOT EXISTS idx_state_snapshot_genai
    ON startup_state_snapshot(genai_intensity);
CREATE INDEX IF NOT EXISTS idx_state_snapshot_at
    ON startup_state_snapshot(snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_state_snapshot_startup_time
    ON startup_state_snapshot(startup_id, snapshot_at DESC);

COMMENT ON TABLE startup_state_snapshot IS
    'Structured queryable state extracted from startups.analysis_data JSONB. One row per startup per analysis period. Enables cross-startup comparison, stage-aware adoption metrics, and temporal state tracking.';
