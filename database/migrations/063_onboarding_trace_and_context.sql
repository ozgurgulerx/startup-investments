-- 063_onboarding_trace_and_context.sql
-- Adds:
-- 1) onboarding_trace_events for near-real-time onboarding/research observability
-- 2) startup_onboarding_context for human-provided context enrichment

-- ---------------------------------------------------------------------------
-- 1) Trace events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onboarding_trace_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID REFERENCES startups(id) ON DELETE SET NULL,
    queue_item_id UUID REFERENCES deep_research_queue(id) ON DELETE SET NULL,
    trace_type TEXT NOT NULL,      -- onboarding | deep_research | graph | context
    stage TEXT NOT NULL,           -- e.g. stub_created, research_enqueued, deep_research_failed
    status TEXT NOT NULL DEFAULT 'info'
        CHECK (status IN ('info', 'success', 'warning', 'failure')),
    severity TEXT NOT NULL DEFAULT 'info'
        CHECK (severity IN ('info', 'warning', 'critical')),
    reason_code TEXT,
    message TEXT,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    dedupe_key TEXT,
    should_notify BOOLEAN NOT NULL DEFAULT FALSE,
    notification_channel TEXT NOT NULL DEFAULT 'slack',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notified_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_onboarding_trace_events_time
    ON onboarding_trace_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_onboarding_trace_events_notify
    ON onboarding_trace_events(should_notify, notified_at, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_onboarding_trace_events_startup
    ON onboarding_trace_events(startup_id, occurred_at DESC);
-- UNIQUE allows multiple NULLs by default in Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_trace_events_dedupe
    ON onboarding_trace_events(dedupe_key);

COMMENT ON TABLE onboarding_trace_events IS
    'Event timeline for automated startup onboarding and deep-research lifecycle; used for near-real-time Slack alerts.';

-- ---------------------------------------------------------------------------
-- 2) Human context additions for onboarding/deep-research
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS startup_onboarding_context (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'admin',  -- admin | slack | api
    context_text TEXT NOT NULL,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_startup_onboarding_context_startup
    ON startup_onboarding_context(startup_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_startup_onboarding_context_time
    ON startup_onboarding_context(created_at DESC);

COMMENT ON TABLE startup_onboarding_context IS
    'Manual context supplied by operators to improve deep research prompts and unblock onboarding.';
