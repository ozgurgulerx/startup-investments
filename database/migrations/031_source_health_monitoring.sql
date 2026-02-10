-- Migration 031: Add per-source health monitoring columns to news_sources
-- Tracks fetch outcomes, consecutive failures, and alert dedup for Slack alerts

ALTER TABLE news_sources ADD COLUMN IF NOT EXISTS last_fetch_at TIMESTAMPTZ;
ALTER TABLE news_sources ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ;
ALTER TABLE news_sources ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ;
ALTER TABLE news_sources ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE news_sources ADD COLUMN IF NOT EXISTS consecutive_failures INT NOT NULL DEFAULT 0;
ALTER TABLE news_sources ADD COLUMN IF NOT EXISTS total_fetches INT NOT NULL DEFAULT 0;
ALTER TABLE news_sources ADD COLUMN IF NOT EXISTS total_successes INT NOT NULL DEFAULT 0;
ALTER TABLE news_sources ADD COLUMN IF NOT EXISTS last_items_fetched INT NOT NULL DEFAULT 0;
ALTER TABLE news_sources ADD COLUMN IF NOT EXISTS last_fetch_duration_ms INT;
ALTER TABLE news_sources ADD COLUMN IF NOT EXISTS last_alerted_at TIMESTAMPTZ;

-- Index for monitoring dashboard: quickly find failing active sources
CREATE INDEX IF NOT EXISTS idx_news_sources_health
  ON news_sources(consecutive_failures DESC) WHERE is_active = true;
