-- Migration 056: Add percentile_ranks column to startup_state_snapshot
--
-- Stores per-startup percentile ranks across its natural cohorts.
-- Populated by compute_startup_ranks.py after benchmarks are computed.

ALTER TABLE startup_state_snapshot ADD COLUMN IF NOT EXISTS
    percentile_ranks JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN startup_state_snapshot.percentile_ranks IS
    'Per-metric percentile ranks across natural cohorts. Example: {"funding_total_usd": {"stage:seed": 88, "all:all": 72}, "confidence_score": {"stage:seed": 93}}';
