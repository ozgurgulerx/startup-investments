-- Migration: Crawler Architecture Improvements
-- Adds URL canonicalization, enhanced change detection, per-domain throttling,
-- quality scoring, and retry improvements.
-- Run: psql -d startupinvestments -f 009_crawler_improvements.sql

-- =========================================================================
-- URL Canonicalization & Change Detection
-- =========================================================================

-- Canonical URL (normalized for deduplication)
ALTER TABLE startups ADD COLUMN IF NOT EXISTS canonical_url TEXT;

-- HTML hash (for detecting rendered page changes, separate from content_hash)
ALTER TABLE startups ADD COLUMN IF NOT EXISTS html_hash TEXT;

-- Change tracking improvements
ALTER TABLE startups ADD COLUMN IF NOT EXISTS change_rate FLOAT DEFAULT 0;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS last_changed_at TIMESTAMPTZ;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS consecutive_unchanged INT DEFAULT 0;

-- Crawl logs: canonical URL tracking
ALTER TABLE crawl_logs ADD COLUMN IF NOT EXISTS canonical_url TEXT;

-- =========================================================================
-- Quality Scoring
-- =========================================================================

-- Quality score (0-1, based on content richness, structure, etc.)
ALTER TABLE crawl_logs ADD COLUMN IF NOT EXISTS quality_score FLOAT;

-- Content type classification ('static' or 'js_rendered')
ALTER TABLE crawl_logs ADD COLUMN IF NOT EXISTS content_type TEXT;

-- Boilerplate ratio (header/footer/nav vs actual content)
ALTER TABLE crawl_logs ADD COLUMN IF NOT EXISTS boilerplate_ratio FLOAT;

-- =========================================================================
-- Retry Improvements
-- =========================================================================

-- Backoff timing for retries
ALTER TABLE crawl_logs ADD COLUMN IF NOT EXISTS retry_backoff_until TIMESTAMPTZ;

-- Error categorization for smarter retry decisions
-- Values: 'transient', 'permanent', 'rate_limited', 'auth_required', 'not_found'
ALTER TABLE crawl_logs ADD COLUMN IF NOT EXISTS error_category TEXT;

-- =========================================================================
-- Domain Stats Table (Per-Domain Throttling)
-- =========================================================================

CREATE TABLE IF NOT EXISTS domain_stats (
    domain TEXT PRIMARY KEY,

    -- Throttling state
    next_allowed_at TIMESTAMPTZ DEFAULT NOW(),
    in_flight_count INT DEFAULT 0,
    crawl_delay_ms INT DEFAULT 2000,

    -- Error tracking
    error_rate FLOAT DEFAULT 0,
    last_429_at TIMESTAMPTZ,
    last_error_at TIMESTAMPTZ,
    consecutive_errors INT DEFAULT 0,

    -- Performance stats
    avg_response_ms INT,
    total_requests INT DEFAULT 0,
    successful_requests INT DEFAULT 0,

    -- Capability flags
    requires_js BOOLEAN DEFAULT false,
    supports_http2 BOOLEAN,
    has_robots_txt BOOLEAN,
    robots_crawl_delay_ms INT,

    -- Timestamps
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for finding domains ready to crawl
CREATE INDEX IF NOT EXISTS idx_domain_stats_next ON domain_stats(next_allowed_at);

-- Index for finding problematic domains
CREATE INDEX IF NOT EXISTS idx_domain_stats_error_rate ON domain_stats(error_rate DESC);

-- =========================================================================
-- Indexes for New Columns
-- =========================================================================

-- Canonical URL uniqueness (for deduplication)
CREATE UNIQUE INDEX IF NOT EXISTS idx_startups_canonical_url
    ON startups(canonical_url) WHERE canonical_url IS NOT NULL;

-- Change tracking queries
CREATE INDEX IF NOT EXISTS idx_startups_last_changed ON startups(last_changed_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_startups_change_rate ON startups(change_rate DESC);

-- Quality filtering
CREATE INDEX IF NOT EXISTS idx_crawl_logs_quality ON crawl_logs(quality_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_crawl_logs_content_type ON crawl_logs(content_type);

-- Error category for retry logic
CREATE INDEX IF NOT EXISTS idx_crawl_logs_error_category ON crawl_logs(error_category);

-- =========================================================================
-- Comments for Documentation
-- =========================================================================

COMMENT ON TABLE domain_stats IS 'Per-domain crawling statistics for rate limiting and capability detection';

COMMENT ON COLUMN startups.canonical_url IS 'Normalized URL for deduplication (tracking params removed, lowercase, etc.)';
COMMENT ON COLUMN startups.html_hash IS 'SHA256 hash of rendered HTML for change detection';
COMMENT ON COLUMN startups.change_rate IS 'Exponential moving average of change frequency (0-1)';
COMMENT ON COLUMN startups.last_changed_at IS 'Timestamp of last detected content change';
COMMENT ON COLUMN startups.consecutive_unchanged IS 'Number of consecutive crawls with no change';

COMMENT ON COLUMN crawl_logs.quality_score IS 'Content quality score (0-1) based on richness and structure';
COMMENT ON COLUMN crawl_logs.content_type IS 'How content was fetched: static (HTTP) or js_rendered (browser)';
COMMENT ON COLUMN crawl_logs.boilerplate_ratio IS 'Ratio of boilerplate (nav/header/footer) to actual content';
COMMENT ON COLUMN crawl_logs.error_category IS 'Error classification: transient, permanent, rate_limited, auth_required, not_found';

COMMENT ON COLUMN domain_stats.domain IS 'Domain name (e.g., example.com)';
COMMENT ON COLUMN domain_stats.next_allowed_at IS 'Earliest time next request to this domain is allowed';
COMMENT ON COLUMN domain_stats.in_flight_count IS 'Current number of in-progress requests to this domain';
COMMENT ON COLUMN domain_stats.crawl_delay_ms IS 'Minimum delay between requests (may be from robots.txt)';
COMMENT ON COLUMN domain_stats.error_rate IS 'Exponential moving average of error rate (0-1)';
COMMENT ON COLUMN domain_stats.requires_js IS 'Whether domain requires JavaScript rendering';
COMMENT ON COLUMN domain_stats.robots_crawl_delay_ms IS 'Crawl-delay from robots.txt (if present)';
