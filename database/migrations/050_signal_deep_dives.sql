-- Migration 050: Signal Deep Dives
--
-- Adds 4 tables for signal deep dive content + extends signal_evidence:
--   1. signal_occurrences — Per-startup signal scores with features
--   2. signal_moves — LLM-extracted strategic moves per startup per signal
--   3. signal_deep_dives — Versioned deep dive documents
--   4. signal_deep_dive_diffs — Version-to-version changes
--   5. Extend signal_evidence with richer fields

-- =============================================================================
-- 1. SIGNAL OCCURRENCES — Per-startup signal scores
-- =============================================================================

CREATE TABLE IF NOT EXISTS signal_occurrences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    score NUMERIC(5,4) NOT NULL DEFAULT 0,
    features_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    evidence_ids UUID[] NOT NULL DEFAULT '{}',
    evidence_hash TEXT,
    explain_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_signal_occurrences UNIQUE (signal_id, startup_id)
);

CREATE INDEX IF NOT EXISTS idx_signal_occurrences_signal_score
    ON signal_occurrences(signal_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_signal_occurrences_startup
    ON signal_occurrences(startup_id);

COMMENT ON TABLE signal_occurrences IS
    'Per-startup signal scores. Deterministic scoring based on evidence count, diversity, recency, and confidence.';

-- =============================================================================
-- 2. SIGNAL MOVES — LLM-extracted strategic moves
-- =============================================================================

CREATE TABLE IF NOT EXISTS signal_moves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    move_type TEXT NOT NULL CHECK (move_type IN (
        'oss_launch', 'integration_push', 'community_funnel', 'pricing_wedge',
        'enterprise_pivot', 'vertical_expansion', 'platform_play',
        'developer_advocacy', 'data_moat', 'compliance_push', 'hiring_signal',
        'partnership', 'product_launch', 'architecture_shift', 'funding_milestone'
    )),
    what_happened TEXT NOT NULL,
    why_it_worked TEXT,
    unique_angle TEXT,
    timestamp_hint TEXT,
    evidence_ids UUID[] NOT NULL DEFAULT '{}',
    evidence_hash TEXT,
    extraction_model TEXT,
    confidence NUMERIC(3,2),
    extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signal_moves_signal
    ON signal_moves(signal_id);
CREATE INDEX IF NOT EXISTS idx_signal_moves_startup
    ON signal_moves(startup_id);
CREATE INDEX IF NOT EXISTS idx_signal_moves_signal_startup
    ON signal_moves(signal_id, startup_id);

COMMENT ON TABLE signal_moves IS
    'LLM-extracted strategic moves per startup per signal. Each move is backed by evidence_ids for traceability.';

-- =============================================================================
-- 3. SIGNAL DEEP DIVES — Versioned deep dive documents
-- =============================================================================

CREATE TABLE IF NOT EXISTS signal_deep_dives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'generating' CHECK (status IN (
        'generating', 'ready', 'failed', 'archived'
    )),
    content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    sample_startup_ids UUID[] NOT NULL DEFAULT '{}',
    sample_count INTEGER NOT NULL DEFAULT 0,
    generation_model TEXT,
    generation_cost_tokens INTEGER,
    evidence_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_signal_deep_dives UNIQUE (signal_id, version)
);

CREATE INDEX IF NOT EXISTS idx_signal_deep_dives_signal_version
    ON signal_deep_dives(signal_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_signal_deep_dives_status
    ON signal_deep_dives(status) WHERE status = 'ready';

COMMENT ON TABLE signal_deep_dives IS
    'Versioned deep dive documents per signal. Each version is a complete snapshot with structured content (tldr, mechanism, patterns, case_studies, thresholds, failure_modes, watchlist).';

-- =============================================================================
-- 4. SIGNAL DEEP DIVE DIFFS — Version-to-version changes
-- =============================================================================

CREATE TABLE IF NOT EXISTS signal_deep_dive_diffs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
    from_version INTEGER NOT NULL,
    to_version INTEGER NOT NULL,
    diff_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_signal_deep_dive_diffs UNIQUE (signal_id, from_version, to_version)
);

CREATE INDEX IF NOT EXISTS idx_signal_deep_dive_diffs_signal
    ON signal_deep_dive_diffs(signal_id, to_version DESC);

COMMENT ON TABLE signal_deep_dive_diffs IS
    'Version-to-version diffs for signal deep dives. Tracks samples added/removed, moves added/removed, and score deltas.';

-- =============================================================================
-- 5. EXTEND SIGNAL EVIDENCE — Richer evidence fields
-- =============================================================================

ALTER TABLE signal_evidence
    ADD COLUMN IF NOT EXISTS source_url TEXT,
    ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS content_hash TEXT,
    ADD COLUMN IF NOT EXISTS structured_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
