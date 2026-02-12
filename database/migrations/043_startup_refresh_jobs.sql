-- Migration: Event-driven startup refresh job queue.
-- When the news pipeline detects important events (funding, product launch, key hire),
-- affected startups are queued for priority crawl frontier boosting.

CREATE TABLE IF NOT EXISTS startup_refresh_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    trigger_event_id UUID REFERENCES startup_events(id) ON DELETE SET NULL,
    reason VARCHAR(100) NOT NULL,  -- funding_event, product_launch, key_hire, acquisition, pricing_change, manual
    priority_boost INT NOT NULL DEFAULT 30,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    urls_boosted INT DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

-- Dedup: one active job per startup at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_refresh_jobs_startup_active
    ON startup_refresh_jobs (startup_id) WHERE status IN ('pending', 'processing');

-- Worker picks up pending jobs oldest-first
CREATE INDEX IF NOT EXISTS idx_refresh_jobs_pending
    ON startup_refresh_jobs (created_at ASC) WHERE status = 'pending';

COMMENT ON TABLE startup_refresh_jobs IS 'Event-driven queue to boost crawl frontier priority for startups with recent news events';
