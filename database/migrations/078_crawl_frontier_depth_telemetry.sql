-- Migration 078: Crawl frontier depth/detail telemetry enrichments
--
-- Additive schema changes for richer crawl detail capture and monitoring.

-- Structured extraction metadata persisted with raw captures.
ALTER TABLE crawl_raw_captures
ADD COLUMN IF NOT EXISTS extraction_meta_json JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Crawl log detail fidelity for monitoring + unblock analytics.
ALTER TABLE crawl_logs
ADD COLUMN IF NOT EXISTS page_type TEXT;

ALTER TABLE crawl_logs
ADD COLUMN IF NOT EXISTS rendered BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE crawl_logs
ADD COLUMN IF NOT EXISTS js_shell_detected BOOLEAN NOT NULL DEFAULT FALSE;

-- Monitoring helpers.
CREATE INDEX IF NOT EXISTS idx_crawl_frontier_urls_discovered_at
    ON crawl_frontier_urls(discovered_at DESC);

CREATE INDEX IF NOT EXISTS idx_crawl_logs_frontier_detail
    ON crawl_logs(created_at DESC, page_type, fetch_method);

COMMENT ON COLUMN crawl_raw_captures.extraction_meta_json
    IS 'Structured metadata extracted per crawl doc (canonical/meta/jsonld/publish hints/outbound links)';
COMMENT ON COLUMN crawl_logs.page_type
    IS 'Classified page type used by frontier prioritization (docs/pricing/changelog/etc)';
COMMENT ON COLUMN crawl_logs.rendered
    IS 'True when browser-rendered content path was used';
COMMENT ON COLUMN crawl_logs.js_shell_detected
    IS 'True when page looked like JS shell during crawl attempt';
