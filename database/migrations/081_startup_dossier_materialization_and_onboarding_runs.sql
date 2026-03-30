-- 081_startup_dossier_materialization_and_onboarding_runs.sql
-- Separates startup identity/workflow status from dossier materialization state
-- and adds run-level tracking for monthly onboarding jobs.

-- ---------------------------------------------------------------------------
-- 1) Startup dossier materialization state
-- ---------------------------------------------------------------------------
ALTER TABLE startups
    ADD COLUMN IF NOT EXISTS materialization_status VARCHAR(32) NOT NULL DEFAULT 'unmaterialized';

ALTER TABLE startups
    ADD COLUMN IF NOT EXISTS analysis_materialized_at TIMESTAMPTZ;

ALTER TABLE startups
    ADD COLUMN IF NOT EXISTS state_snapshot_at TIMESTAMPTZ;

ALTER TABLE startups
    ADD COLUMN IF NOT EXISTS publish_block_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_startups_materialization_region_period
    ON startups(dataset_region, materialization_status, period);

CREATE INDEX IF NOT EXISTS idx_startups_state_snapshot_at
    ON startups(state_snapshot_at DESC);

COMMENT ON COLUMN startups.materialization_status IS
    'Dossier materialization lifecycle: unmaterialized | analysis_ready | state_ready.';

COMMENT ON COLUMN startups.analysis_materialized_at IS
    'Timestamp when analysis_data was first populated for the startup.';

COMMENT ON COLUMN startups.state_snapshot_at IS
    'Timestamp of the latest startup_state_snapshot materialization used for dossier/dealbook visibility.';

COMMENT ON COLUMN startups.publish_block_reason IS
    'Operational reason the startup is not dossier-visible yet (for example analysis_missing or state_snapshot_missing).';

UPDATE startups s
SET
    materialization_status = CASE
        WHEN COALESCE(s.onboarding_status, 'verified') IN ('merged', 'rejected') THEN 'unmaterialized'
        WHEN EXISTS (
            SELECT 1
            FROM startup_state_snapshot ss
            WHERE ss.startup_id = s.id
        ) THEN 'state_ready'
        WHEN s.analysis_data IS NOT NULL THEN 'analysis_ready'
        ELSE 'unmaterialized'
    END,
    analysis_materialized_at = CASE
        WHEN s.analysis_data IS NOT NULL
            THEN COALESCE(s.analysis_materialized_at, s.updated_at, s.created_at, NOW())
        ELSE s.analysis_materialized_at
    END,
    state_snapshot_at = COALESCE(
        s.state_snapshot_at,
        (
            SELECT MAX(ss.snapshot_at)
            FROM startup_state_snapshot ss
            WHERE ss.startup_id = s.id
        )
    ),
    publish_block_reason = CASE
        WHEN COALESCE(s.onboarding_status, 'verified') IN ('merged', 'rejected') THEN 'excluded_onboarding_status'
        WHEN EXISTS (
            SELECT 1
            FROM startup_state_snapshot ss
            WHERE ss.startup_id = s.id
        ) THEN NULL
        WHEN s.analysis_data IS NOT NULL THEN 'state_snapshot_missing'
        ELSE 'analysis_missing'
    END;

-- ---------------------------------------------------------------------------
-- 2) Monthly onboarding run tracking
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onboarding_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_key TEXT NOT NULL UNIQUE,
    pipeline_name TEXT NOT NULL DEFAULT 'global-onboarding',
    period TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT 'global'
        CHECK (region IN ('global', 'turkey')),
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
    current_stage TEXT,
    latest_stage TEXT,
    latest_startup TEXT,
    progress_completed INTEGER NOT NULL DEFAULT 0,
    progress_total INTEGER NOT NULL DEFAULT 0,
    progress_error_count INTEGER NOT NULL DEFAULT 0,
    artifact_path TEXT,
    failure_reason TEXT,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    latest_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_onboarding_runs_period_region_started
    ON onboarding_runs(region, period, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_onboarding_runs_status_heartbeat
    ON onboarding_runs(status, latest_heartbeat_at DESC);

COMMENT ON TABLE onboarding_runs IS
    'Run-level state for onboarding pipelines so operators can resume, inspect heartbeats, and distinguish stage failures from publish/materialization failures.';

CREATE TABLE IF NOT EXISTS onboarding_run_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES onboarding_runs(id) ON DELETE CASCADE,
    startup_id UUID REFERENCES startups(id) ON DELETE SET NULL,
    startup_name TEXT NOT NULL,
    startup_slug TEXT,
    stage TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
    attempt_count INTEGER NOT NULL DEFAULT 1,
    latest_error TEXT,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT uq_onboarding_run_items UNIQUE (run_id, startup_name, stage)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_run_items_run_stage
    ON onboarding_run_items(run_id, stage, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_onboarding_run_items_status
    ON onboarding_run_items(status, updated_at DESC);

COMMENT ON TABLE onboarding_run_items IS
    'Best-effort per-startup stage tracking for onboarding runs. Complements onboarding_trace_events with run-scoped progress state.';
