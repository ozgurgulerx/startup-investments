-- 083_evidence_store_ops_and_eval_runs.sql
-- Evidence-store operability, archival, and eval/canary history.

-- ---------------------------------------------------------------------------
-- 1) Hot-path indexes for promotion, research, and materialization.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_startup_source_documents_period_startup_time
    ON startup_source_documents(period, startup_id, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_startup_source_documents_startup_page
    ON startup_source_documents(startup_id, page_type, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_startup_field_observations_period_field_confidence
    ON startup_field_observations(period, field_name, startup_id, confidence DESC, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_startup_field_observations_startup_source_type
    ON startup_field_observations(startup_id, source_type, field_name, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_startup_claims_startup_contradiction
    ON startup_claims(startup_id, contradiction_state, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_startup_claim_evidence_startup_source_type
    ON startup_claim_evidence(startup_id, source_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_startup_claim_evidence_period_claim
    ON startup_claim_evidence(period, claim_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_startup_promotion_queue_status_started
    ON startup_promotion_queue(status, started_at, retry_count, queued_at);

-- ---------------------------------------------------------------------------
-- 2) Cold archive tables for evidence retention.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS startup_source_documents_archive
    (LIKE startup_source_documents INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES INCLUDING STORAGE);

CREATE TABLE IF NOT EXISTS startup_field_observations_archive
    (LIKE startup_field_observations INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES INCLUDING STORAGE);

CREATE TABLE IF NOT EXISTS startup_claims_archive
    (LIKE startup_claims INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES INCLUDING STORAGE);

CREATE TABLE IF NOT EXISTS startup_claim_evidence_archive
    (LIKE startup_claim_evidence INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES INCLUDING STORAGE);

COMMENT ON TABLE startup_source_documents_archive IS
    'Cold archive for startup_source_documents rows moved out of the hot evidence partition.';
COMMENT ON TABLE startup_field_observations_archive IS
    'Cold archive for startup_field_observations rows moved out of the hot evidence partition.';
COMMENT ON TABLE startup_claims_archive IS
    'Cold archive for startup_claims rows moved out of the hot evidence partition.';
COMMENT ON TABLE startup_claim_evidence_archive IS
    'Cold archive for startup_claim_evidence rows moved out of the hot evidence partition.';

-- ---------------------------------------------------------------------------
-- 3) Gold-set and canary run history.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onboarding_eval_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_type TEXT NOT NULL,
    run_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed'
        CHECK (status IN ('pending', 'completed', 'failed')),
    metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    baseline_metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_eval_runs_type_key
    ON onboarding_eval_runs(run_type, run_key);

CREATE INDEX IF NOT EXISTS idx_onboarding_eval_runs_type_completed
    ON onboarding_eval_runs(run_type, completed_at DESC);

CREATE TABLE IF NOT EXISTS onboarding_eval_run_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    eval_run_id UUID NOT NULL REFERENCES onboarding_eval_runs(id) ON DELETE CASCADE,
    startup_key TEXT NOT NULL,
    sector TEXT,
    locale TEXT,
    metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_eval_run_items_eval_run
    ON onboarding_eval_run_items(eval_run_id, startup_key);

COMMENT ON TABLE onboarding_eval_runs IS
    'Historical metrics for gold-set evaluations and nightly public-web onboarding canaries.';
COMMENT ON TABLE onboarding_eval_run_items IS
    'Per-startup metrics for onboarding_eval_runs, used for sampled audit and regressions.';
