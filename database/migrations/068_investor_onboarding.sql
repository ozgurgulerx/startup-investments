-- 068_investor_onboarding.sql
-- Adds investor onboarding infrastructure:
-- - investor_profiles: enriched investor metadata (best-effort, overwrite-safe)
-- - investor_onboarding_queue: async enrichment queue with budgeted worker
-- - investor_onboarding_context: operator-provided context for enrichment
-- - onboarding_trace_events: optional investor fields for unified observability

-- ---------------------------------------------------------------------------
-- 1) Investor profiles (enriched metadata)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investor_profiles (
    investor_id UUID PRIMARY KEY REFERENCES investors(id) ON DELETE CASCADE,
    website TEXT,
    headquarters_country TEXT,
    investor_type TEXT,
    profile_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_urls TEXT[] NOT NULL DEFAULT '{}',
    last_enriched_at TIMESTAMPTZ,
    enrichment_model TEXT,
    enrichment_version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investor_profiles_enriched
    ON investor_profiles(last_enriched_at DESC);

-- Keep updated_at fresh when rows are updated (best-effort; function defined in 001/003).
DROP TRIGGER IF EXISTS update_investor_profiles_updated_at ON investor_profiles;
CREATE TRIGGER update_investor_profiles_updated_at
    BEFORE UPDATE ON investor_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE investor_profiles IS
    'Latest enriched investor profile fields (website/type/HQ + structured profile_json) with provenance.';

-- ---------------------------------------------------------------------------
-- 2) Investor onboarding queue (async enrichment worker)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investor_onboarding_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investor_id UUID NOT NULL REFERENCES investors(id) ON DELETE CASCADE,

    -- Queue management
    priority INTEGER DEFAULT 5,                      -- 1 (highest) to 10 (lowest)
    status VARCHAR(20) NOT NULL DEFAULT 'pending',   -- pending|processing|completed|failed
    reason VARCHAR(100),

    -- Seeds for enrichment (best-effort)
    seed_cluster_id UUID,
    seed_urls TEXT[] NOT NULL DEFAULT '{}',

    -- Results tracking
    tokens_used INTEGER,
    cost_usd DECIMAL(10,4),
    enrichment_output JSONB,

    -- Timing
    queued_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    -- Error handling
    error_message TEXT,
    retry_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_investor_onboarding_queue_investor
    ON investor_onboarding_queue(investor_id);
CREATE INDEX IF NOT EXISTS idx_investor_onboarding_queue_status
    ON investor_onboarding_queue(status);
CREATE INDEX IF NOT EXISTS idx_investor_onboarding_queue_priority
    ON investor_onboarding_queue(priority, queued_at);

-- Allow historical completed rows, only one active row per investor.
CREATE UNIQUE INDEX IF NOT EXISTS uq_investor_onboarding_queue_active
    ON investor_onboarding_queue(investor_id)
    WHERE status IN ('pending', 'processing');

COMMENT ON TABLE investor_onboarding_queue IS
    'Async enrichment queue for investors discovered from news funding events (website/type/HQ/profile_json).';

-- ---------------------------------------------------------------------------
-- 3) Human context additions for investor onboarding
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investor_onboarding_context (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investor_id UUID NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'admin',  -- admin | slack | api
    context_text TEXT NOT NULL,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investor_onboarding_context_investor
    ON investor_onboarding_context(investor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_investor_onboarding_context_time
    ON investor_onboarding_context(created_at DESC);

COMMENT ON TABLE investor_onboarding_context IS
    'Manual context supplied by operators to improve investor enrichment and unblock onboarding.';

-- ---------------------------------------------------------------------------
-- 4) Extend onboarding_trace_events for investor workflows (best-effort)
-- ---------------------------------------------------------------------------
ALTER TABLE onboarding_trace_events
    ADD COLUMN IF NOT EXISTS investor_id UUID REFERENCES investors(id) ON DELETE SET NULL;

ALTER TABLE onboarding_trace_events
    ADD COLUMN IF NOT EXISTS investor_queue_item_id UUID REFERENCES investor_onboarding_queue(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_onboarding_trace_events_investor
    ON onboarding_trace_events(investor_id, occurred_at DESC);
