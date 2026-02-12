-- Migration 053: Startup Neighbors + Cohort Benchmarks
--
-- Pre-computed similarity neighbors and cohort-level percentile benchmarks.
-- Enables "comparable startups" and "how does this startup compare" features.

-- =============================================================================
-- 1. STARTUP NEIGHBORS — Pre-computed similar startups
-- =============================================================================

CREATE TABLE IF NOT EXISTS startup_neighbors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id      UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    neighbor_id     UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    rank            INTEGER NOT NULL,
    overall_score   REAL NOT NULL,
    vector_score    REAL,
    pattern_score   REAL,
    meta_score      REAL,
    shared_patterns TEXT[] NOT NULL DEFAULT '{}',
    method          TEXT NOT NULL DEFAULT 'hybrid',
    period          TEXT NOT NULL,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (startup_id, neighbor_id, period)
);

CREATE INDEX IF NOT EXISTS idx_startup_neighbors_lookup
    ON startup_neighbors(startup_id, period, rank);
CREATE INDEX IF NOT EXISTS idx_startup_neighbors_neighbor
    ON startup_neighbors(neighbor_id);

COMMENT ON TABLE startup_neighbors IS
    'Pre-computed k-nearest neighbors per startup per period. Hybrid scoring: vector similarity (if embeddings exist) + pattern Jaccard + metadata match.';

-- =============================================================================
-- 2. COHORT BENCHMARKS — Percentile distributions per cohort per metric
-- =============================================================================

CREATE TABLE IF NOT EXISTS cohort_benchmarks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cohort_key      TEXT NOT NULL,
    cohort_type     TEXT NOT NULL,
    region          TEXT NOT NULL DEFAULT 'global',
    metric          TEXT NOT NULL,
    cohort_size     INTEGER NOT NULL,
    p10             REAL,
    p25             REAL,
    p50             REAL,
    p75             REAL,
    p90             REAL,
    mean            REAL,
    stddev          REAL,
    period          TEXT NOT NULL,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (cohort_key, metric, period, region)
);

CREATE INDEX IF NOT EXISTS idx_cohort_benchmarks_lookup
    ON cohort_benchmarks(cohort_key, period, region);
CREATE INDEX IF NOT EXISTS idx_cohort_benchmarks_type
    ON cohort_benchmarks(cohort_type);

COMMENT ON TABLE cohort_benchmarks IS
    'Pre-computed percentile distributions (p10-p90, mean, stddev) for each cohort (stage, vertical, combined) and metric. Used for positioning a startup within its peer group.';
