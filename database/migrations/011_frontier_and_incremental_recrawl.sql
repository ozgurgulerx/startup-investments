-- Migration: Frontier queue + incremental recrawl metadata for modern crawler runtime
-- Run after 009_crawler_improvements.sql

-- =====================================================================
-- Frontier URL state
-- =====================================================================
CREATE TABLE IF NOT EXISTS crawl_frontier_urls (
    canonical_url TEXT PRIMARY KEY,
    startup_slug TEXT NOT NULL,
    url TEXT NOT NULL,
    domain TEXT NOT NULL,
    page_type TEXT NOT NULL DEFAULT 'generic',
    priority_score INT NOT NULL DEFAULT 40,

    -- Incremental metadata
    content_hash TEXT,
    etag TEXT,
    last_modified TEXT,
    last_status_code INT,
    last_response_ms INT,
    change_rate FLOAT DEFAULT 0,

    -- Scheduling
    next_crawl_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_crawled_at TIMESTAMPTZ,
    discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_frontier_urls_domain ON crawl_frontier_urls(domain);
CREATE INDEX IF NOT EXISTS idx_frontier_urls_next_crawl ON crawl_frontier_urls(next_crawl_at);
CREATE INDEX IF NOT EXISTS idx_frontier_urls_priority ON crawl_frontier_urls(priority_score DESC, next_crawl_at ASC);

-- =====================================================================
-- Frontier lease queue for workers
-- =====================================================================
CREATE TABLE IF NOT EXISTS crawl_frontier_queue (
    canonical_url TEXT PRIMARY KEY REFERENCES crawl_frontier_urls(canonical_url) ON DELETE CASCADE,
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    leased_at TIMESTAMPTZ,
    lease_owner TEXT,
    lease_attempts INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_frontier_queue_available ON crawl_frontier_queue(available_at) WHERE leased_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_frontier_queue_owner ON crawl_frontier_queue(lease_owner) WHERE leased_at IS NOT NULL;

-- =====================================================================
-- Per-domain crawl policies
-- =====================================================================
CREATE TABLE IF NOT EXISTS domain_policies (
    domain TEXT PRIMARY KEY,
    respect_robots BOOLEAN NOT NULL DEFAULT TRUE,
    crawl_delay_ms INT NOT NULL DEFAULT 1500,
    max_concurrent INT NOT NULL DEFAULT 2,
    blocked BOOLEAN NOT NULL DEFAULT FALSE,
    proxy_tier TEXT NOT NULL DEFAULT 'datacenter', -- datacenter, residential
    render_required BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domain_policies_proxy_tier ON domain_policies(proxy_tier);

-- =====================================================================
-- Crawl logs enrichments (if table exists from earlier migrations)
-- =====================================================================
ALTER TABLE crawl_logs ADD COLUMN IF NOT EXISTS etag TEXT;
ALTER TABLE crawl_logs ADD COLUMN IF NOT EXISTS last_modified TEXT;
ALTER TABLE crawl_logs ADD COLUMN IF NOT EXISTS proxy_tier TEXT;
ALTER TABLE crawl_logs ADD COLUMN IF NOT EXISTS fetch_method TEXT;

COMMENT ON TABLE crawl_frontier_urls IS 'Canonical URL registry for crawl frontier with incremental metadata';
COMMENT ON TABLE crawl_frontier_queue IS 'Lease-based queue for crawl workers';
COMMENT ON TABLE domain_policies IS 'Per-domain policy controls for politeness, rendering, and proxy tier';

COMMENT ON COLUMN crawl_frontier_urls.change_rate IS 'EMA of how often content changes (0-1)';
COMMENT ON COLUMN domain_policies.proxy_tier IS 'Proxy selection policy: datacenter or residential';
