-- Migration: WARC-lite replay capture + domain policy feedback for crawler runtime
-- Run after 011_frontier_and_incremental_recrawl.sql

-- =====================================================================
-- Raw replay capture metadata
-- =====================================================================
CREATE TABLE IF NOT EXISTS crawl_raw_captures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_slug TEXT,
    canonical_url TEXT NOT NULL,
    domain TEXT NOT NULL,

    request_method TEXT NOT NULL DEFAULT 'GET',
    request_headers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    response_headers_json JSONB NOT NULL DEFAULT '{}'::jsonb,

    status_code INT,
    final_url TEXT,
    content_type TEXT,
    content_length INT,

    body_blob_path TEXT,
    body_sha256 TEXT,

    fetch_method TEXT,
    provider TEXT,
    proxy_tier TEXT,

    blocked_detected BOOLEAN NOT NULL DEFAULT FALSE,
    error_category TEXT,
    latency_ms INT,

    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crawl_raw_captures_domain_time
    ON crawl_raw_captures(domain, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_crawl_raw_captures_url_time
    ON crawl_raw_captures(canonical_url, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_crawl_raw_captures_blocked
    ON crawl_raw_captures(blocked_detected, captured_at DESC);

-- =====================================================================
-- Frontier URL enrichments for conservative scheduling
-- =====================================================================
ALTER TABLE crawl_frontier_urls ADD COLUMN IF NOT EXISTS last_quality_score FLOAT;
ALTER TABLE crawl_frontier_urls ADD COLUMN IF NOT EXISTS last_error_category TEXT;
ALTER TABLE crawl_frontier_urls ADD COLUMN IF NOT EXISTS last_fetch_method TEXT;
ALTER TABLE crawl_frontier_urls ADD COLUMN IF NOT EXISTS last_proxy_tier TEXT;
ALTER TABLE crawl_frontier_urls ADD COLUMN IF NOT EXISTS last_blocked_detected BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE crawl_frontier_urls ADD COLUMN IF NOT EXISTS last_capture_id UUID REFERENCES crawl_raw_captures(id) ON DELETE SET NULL;

-- =====================================================================
-- Crawl logs replay pointer
-- =====================================================================
ALTER TABLE crawl_logs ADD COLUMN IF NOT EXISTS capture_id UUID REFERENCES crawl_raw_captures(id) ON DELETE SET NULL;

-- =====================================================================
-- Domain policy feedback fields
-- =====================================================================
ALTER TABLE domain_policies ADD COLUMN IF NOT EXISTS block_rate FLOAT NOT NULL DEFAULT 0;
ALTER TABLE domain_policies ADD COLUMN IF NOT EXISTS consecutive_blocks INT NOT NULL DEFAULT 0;
ALTER TABLE domain_policies ADD COLUMN IF NOT EXISTS last_blocked_at TIMESTAMPTZ;
ALTER TABLE domain_policies ADD COLUMN IF NOT EXISTS last_provider_success_at TIMESTAMPTZ;
ALTER TABLE domain_policies ADD COLUMN IF NOT EXISTS policy_version INT NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_domain_policies_block_rate
    ON domain_policies(block_rate DESC);

COMMENT ON TABLE crawl_raw_captures IS 'WARC-lite replay metadata and raw body blob pointer for deterministic reprocessing';
COMMENT ON COLUMN crawl_raw_captures.body_blob_path IS 'Blob path of compressed raw response body';
COMMENT ON COLUMN crawl_raw_captures.body_sha256 IS 'SHA256 of raw (uncompressed) response body bytes';
COMMENT ON COLUMN crawl_frontier_urls.last_capture_id IS 'Most recent raw capture reference for this URL';
COMMENT ON COLUMN domain_policies.block_rate IS 'EMA of blocked/challenge outcomes (0-1)';
