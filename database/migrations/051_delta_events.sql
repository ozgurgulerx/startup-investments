-- Migration 051: Delta Events (Movers/Changefeed)
--
-- Tracks significant changes in startup state between periods.
-- Delta events power the "Movers" feed showing what changed and why.

-- =============================================================================
-- 1. DELTA EVENTS — Captures startup state changes
-- =============================================================================

CREATE TABLE IF NOT EXISTS delta_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id      UUID REFERENCES startups(id) ON DELETE CASCADE,
    signal_id       UUID REFERENCES signals(id) ON DELETE SET NULL,
    delta_type      TEXT NOT NULL,
    domain          TEXT NOT NULL DEFAULT 'general',
    region          TEXT NOT NULL DEFAULT 'global',
    old_value       TEXT,
    new_value       TEXT,
    magnitude       REAL,
    direction       TEXT,
    headline        TEXT NOT NULL,
    detail          TEXT,
    evidence_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
    period          TEXT,
    effective_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Feed query: region + time ordering
CREATE INDEX IF NOT EXISTS idx_delta_events_feed
    ON delta_events(region, effective_at DESC);

-- Startup-specific deltas
CREATE INDEX IF NOT EXISTS idx_delta_events_startup
    ON delta_events(startup_id, effective_at DESC);

-- Filter by type
CREATE INDEX IF NOT EXISTS idx_delta_events_type
    ON delta_events(delta_type);

-- Top movers by magnitude
CREATE INDEX IF NOT EXISTS idx_delta_events_magnitude
    ON delta_events(magnitude DESC NULLS LAST);

-- Signal-linked deltas
CREATE INDEX IF NOT EXISTS idx_delta_events_signal
    ON delta_events(signal_id) WHERE signal_id IS NOT NULL;

-- Period lookup
CREATE INDEX IF NOT EXISTS idx_delta_events_period
    ON delta_events(period);

-- Dedupe: prevent duplicate delta events for same startup/type/period/values
CREATE UNIQUE INDEX IF NOT EXISTS uq_delta_events_dedupe
    ON delta_events(startup_id, delta_type, period, COALESCE(old_value, ''), COALESCE(new_value, ''));

COMMENT ON TABLE delta_events IS
    'Tracks significant changes in startup state between periods. Powers the Movers feed. Each row represents a discrete, meaningful change (funding round, pattern shift, score change, etc.).';
