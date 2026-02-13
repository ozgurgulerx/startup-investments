-- 058_onboarding_pipeline_activation.sql
-- Activates end-to-end startup onboarding controls:
-- - onboarding attempt telemetry
-- - deep_research_queue availability + active-job uniqueness

-- ---------------------------------------------------------------------------
-- 1) Onboarding attempt telemetry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS startup_onboarding_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID REFERENCES startups(id) ON DELETE SET NULL,
    entity_name TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT 'global'
        CHECK (region IN ('global', 'turkey')),
    stage TEXT NOT NULL,              -- e.g. stub_inserted, website_discovery, verification
    success BOOLEAN NOT NULL DEFAULT FALSE,
    reason TEXT,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_startup_onboarding_attempts_startup
    ON startup_onboarding_attempts(startup_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_startup_onboarding_attempts_time
    ON startup_onboarding_attempts(attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_startup_onboarding_attempts_region_stage
    ON startup_onboarding_attempts(region, stage, attempted_at DESC);

COMMENT ON TABLE startup_onboarding_attempts IS
    'Audit trail for automated onboarding attempts of startups discovered from the radar/news pipeline.';

-- ---------------------------------------------------------------------------
-- 2) Ensure deep_research_queue exists in environments that never applied 003
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deep_research_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    priority INTEGER DEFAULT 5,                  -- 1 (highest) to 10 (lowest)
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending|processing|completed|failed
    reason VARCHAR(100),
    research_depth VARCHAR(20) DEFAULT 'standard',
    focus_areas JSONB,
    tokens_used INTEGER,
    cost_usd DECIMAL(10,4),
    research_output JSONB,
    queued_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_research_queue_startup
    ON deep_research_queue(startup_id);
CREATE INDEX IF NOT EXISTS idx_research_queue_status
    ON deep_research_queue(status);
CREATE INDEX IF NOT EXISTS idx_research_queue_priority
    ON deep_research_queue(priority, queued_at);

-- ---------------------------------------------------------------------------
-- 3) Queue correctness: allow historical completed rows, only one active row
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    old_uq_name TEXT;
BEGIN
    IF to_regclass('public.deep_research_queue') IS NULL THEN
        RETURN;
    END IF;

    SELECT c.conname INTO old_uq_name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'deep_research_queue'
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) ILIKE '%(startup_id, status)%'
    LIMIT 1;

    IF old_uq_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.deep_research_queue DROP CONSTRAINT %I', old_uq_name);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_deep_research_queue_active
    ON deep_research_queue(startup_id)
    WHERE status IN ('pending', 'processing');

