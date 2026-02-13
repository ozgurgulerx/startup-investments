-- Migration 055: Watchlist Intelligence Tables
--
-- Extended subscriptions, materialized alerts from delta_events,
-- and weekly digest threads for the Watchlist Intelligence Center.

-- =============================================================================
-- 1. USER SUBSCRIPTIONS — Extended subscription targets
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_subscriptions (
    user_id      UUID NOT NULL,
    scope        TEXT NOT NULL DEFAULT 'global',
    object_type  TEXT NOT NULL,
    object_id    TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, scope, object_type, object_id)
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user
    ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_object
    ON user_subscriptions(object_type, object_id);

COMMENT ON TABLE user_subscriptions IS
    'Extended subscription targets — startup, investor, pattern, or cohort. user_id references users table when auth is available.';

-- =============================================================================
-- 2. USER ALERTS — Materialized alerts from delta_events
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_alerts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL,
    scope       TEXT NOT NULL DEFAULT 'global',
    delta_id    UUID NOT NULL REFERENCES delta_events(id) ON DELETE CASCADE,
    severity    INTEGER NOT NULL DEFAULT 1,
    status      TEXT NOT NULL DEFAULT 'unread',
    reason      JSONB NOT NULL DEFAULT '{}'::jsonb,
    narrative   JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_alerts_feed
    ON user_alerts(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_alerts_delta
    ON user_alerts(delta_id);

COMMENT ON TABLE user_alerts IS
    'Materialized user alerts generated from delta_events + user_subscriptions matching. Each alert has severity (1-5), status (unread/read/archived), and optional LLM narrative.';

-- =============================================================================
-- 3. USER DIGEST THREADS — Weekly/monthly digest compilations
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_digest_threads (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL,
    scope        TEXT NOT NULL DEFAULT 'global',
    period_start DATE NOT NULL,
    period_end   DATE NOT NULL,
    title        TEXT NOT NULL,
    summary      TEXT NOT NULL,
    themes       JSONB NOT NULL DEFAULT '[]'::jsonb,
    alert_ids    UUID[] NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_digest_threads_user
    ON user_digest_threads(user_id, period_end DESC);

COMMENT ON TABLE user_digest_threads IS
    'Weekly/monthly digest compilations grouping user alerts by theme with LLM-generated summaries.';
