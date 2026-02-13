-- 061: X/Twitter trend intelligence + automated posting pipeline
--
-- Adds:
-- - x_watchlists: tracked accounts/queries by region
-- - x_post_queue: generated post candidates + publish lifecycle
-- - x_post_attempts: immutable publish attempt log
-- - x_post_metrics_daily: per-post daily engagement snapshots

CREATE TABLE IF NOT EXISTS x_watchlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_handle TEXT,
    query TEXT,
    region TEXT NOT NULL DEFAULT 'global'
        CHECK (region IN ('global', 'turkey')),
    priority INT NOT NULL DEFAULT 5,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT x_watchlists_target_present
        CHECK (
            COALESCE(NULLIF(TRIM(account_handle), ''), NULLIF(TRIM(query), '')) IS NOT NULL
        )
);

CREATE INDEX IF NOT EXISTS idx_x_watchlists_active_region
    ON x_watchlists (is_active, region, priority);

CREATE UNIQUE INDEX IF NOT EXISTS uq_x_watchlists_account_region
    ON x_watchlists (LOWER(account_handle), region)
    WHERE account_handle IS NOT NULL AND TRIM(account_handle) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_x_watchlists_query_region
    ON x_watchlists (LOWER(query), region)
    WHERE query IS NOT NULL AND TRIM(query) <> '';


CREATE TABLE IF NOT EXISTS x_post_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    region TEXT NOT NULL DEFAULT 'global'
        CHECK (region IN ('global', 'turkey')),
    source_type TEXT NOT NULL DEFAULT 'news_cluster'
        CHECK (source_type IN ('news_cluster', 'signal', 'manual')),
    source_cluster_id UUID REFERENCES news_clusters(id) ON DELETE SET NULL,
    source_signal_id UUID REFERENCES startup_signals(id) ON DELETE SET NULL,
    source_url TEXT,
    dedupe_key TEXT NOT NULL,
    post_text TEXT NOT NULL,
    post_url TEXT,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'scheduled', 'publishing', 'published', 'failed', 'cancelled')),
    priority INT NOT NULL DEFAULT 5,
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    x_post_id TEXT,
    x_post_url TEXT,
    provider TEXT NOT NULL DEFAULT 'x_api',
    attempt_count INT NOT NULL DEFAULT 0,
    last_error TEXT,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_x_post_queue_dedupe_key
    ON x_post_queue (dedupe_key);

CREATE INDEX IF NOT EXISTS idx_x_post_queue_status_scheduled
    ON x_post_queue (status, scheduled_at, priority);

CREATE INDEX IF NOT EXISTS idx_x_post_queue_published_at
    ON x_post_queue (published_at DESC)
    WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_x_post_queue_region_status
    ON x_post_queue (region, status, scheduled_at);


CREATE TABLE IF NOT EXISTS x_post_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_id UUID NOT NULL REFERENCES x_post_queue(id) ON DELETE CASCADE,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL
        CHECK (status IN ('success', 'failed')),
    http_status INT,
    x_post_id TEXT,
    error_text TEXT,
    request_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    response_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_x_post_attempts_queue_attempted
    ON x_post_attempts (queue_id, attempted_at DESC);


CREATE TABLE IF NOT EXISTS x_post_metrics_daily (
    queue_id UUID NOT NULL REFERENCES x_post_queue(id) ON DELETE CASCADE,
    metric_date DATE NOT NULL,
    impressions BIGINT NOT NULL DEFAULT 0,
    likes BIGINT NOT NULL DEFAULT 0,
    replies BIGINT NOT NULL DEFAULT 0,
    reposts BIGINT NOT NULL DEFAULT 0,
    quotes BIGINT NOT NULL DEFAULT 0,
    bookmarks BIGINT NOT NULL DEFAULT 0,
    profile_clicks BIGINT NOT NULL DEFAULT 0,
    url_clicks BIGINT NOT NULL DEFAULT 0,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (queue_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_x_post_metrics_daily_date
    ON x_post_metrics_daily (metric_date DESC);
