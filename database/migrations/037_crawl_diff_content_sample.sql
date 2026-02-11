-- Migration 037: Add content sample column for crawl diff analysis
--
-- Stores the first 2000 characters of the previous crawl's text content
-- so the CrawlDiffExtractor can perform heuristic diff analysis when
-- content_hash changes. This enables event extraction from website changes
-- (pricing changes, product launches, hiring signals, open-source signals)
-- without storing full page snapshots.
--
-- Added to both tables:
-- - startups: used by website_monitor.py (main monitoring loop)
-- - crawl_frontier_urls: used by the full crawl pipeline
--
-- Phase 5 of the Signal Intelligence Engine.

ALTER TABLE startups
ADD COLUMN IF NOT EXISTS last_content_sample TEXT;

COMMENT ON COLUMN startups.last_content_sample
    IS 'First 2000 chars of previous crawl text content for diff analysis';

ALTER TABLE crawl_frontier_urls
ADD COLUMN IF NOT EXISTS last_content_sample TEXT;

COMMENT ON COLUMN crawl_frontier_urls.last_content_sample
    IS 'First 2000 chars of previous crawl text content for diff analysis';
