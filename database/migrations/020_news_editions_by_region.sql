-- Regional news editions (global vs turkey)
--
-- Goal:
-- - Keep raw items/clusters global/shared
-- - Partition "edition" and "topic index" by region
-- - Tag sources by region so we can build a Turkey edition from Turkey-focused sources

-- 1) Tag news sources by region
ALTER TABLE news_sources
  ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT 'global';

ALTER TABLE news_sources
  DROP CONSTRAINT IF EXISTS news_sources_region_check;
ALTER TABLE news_sources
  ADD CONSTRAINT news_sources_region_check
  CHECK (region IN ('global', 'turkey'));

-- Backfill: mark Turkey ecosystem sources as turkey (safe if rows don't exist yet).
UPDATE news_sources
SET region = 'turkey'
WHERE source_key IN ('webrazzi', 'egirisim');

CREATE INDEX IF NOT EXISTS idx_news_sources_region_active
  ON news_sources(region, is_active);

-- 2) Partition daily editions by region (edition_date + region)
ALTER TABLE news_daily_editions
  ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT 'global';

ALTER TABLE news_daily_editions
  DROP CONSTRAINT IF EXISTS news_daily_editions_region_check;
ALTER TABLE news_daily_editions
  ADD CONSTRAINT news_daily_editions_region_check
  CHECK (region IN ('global', 'turkey'));

-- Default primary key constraint name is "<table>_pkey".
ALTER TABLE news_daily_editions
  DROP CONSTRAINT IF EXISTS news_daily_editions_pkey;

ALTER TABLE news_daily_editions
  ADD CONSTRAINT news_daily_editions_pkey PRIMARY KEY (edition_date, region);

CREATE INDEX IF NOT EXISTS idx_news_daily_editions_region_date
  ON news_daily_editions(region, edition_date DESC);

-- 3) Partition topic index by region too
ALTER TABLE news_topic_index
  ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT 'global';

ALTER TABLE news_topic_index
  DROP CONSTRAINT IF EXISTS news_topic_index_region_check;
ALTER TABLE news_topic_index
  ADD CONSTRAINT news_topic_index_region_check
  CHECK (region IN ('global', 'turkey'));

ALTER TABLE news_topic_index
  DROP CONSTRAINT IF EXISTS news_topic_index_pkey;

ALTER TABLE news_topic_index
  ADD CONSTRAINT news_topic_index_pkey PRIMARY KEY (topic, cluster_id, edition_date, region);

-- Replace the old (edition_date, topic, rank_score) index with a region-aware one.
DROP INDEX IF EXISTS idx_news_topic_index_date_topic;
CREATE INDEX IF NOT EXISTS idx_news_topic_index_date_region_topic
  ON news_topic_index(edition_date DESC, region, topic, rank_score DESC);

