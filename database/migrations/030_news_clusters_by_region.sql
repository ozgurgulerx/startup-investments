-- Regional clusters (global vs turkey)
--
-- Motivation:
-- Prior to this migration, "edition" + "topic index" were partitioned by region,
-- but clusters themselves were shared. This caused Turkey editions to inherit
-- global primary URL/title/source when clusters overlapped.
--
-- This migration makes `news_clusters` region-aware so we can persist a Turkey-
-- specific representation of a cluster (members + representative) without
-- mutating the global cluster row.

-- 1) Add region column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'news_clusters' AND column_name = 'region'
    ) THEN
        ALTER TABLE news_clusters
            ADD COLUMN region TEXT NOT NULL DEFAULT 'global';
    END IF;
END $$;

ALTER TABLE news_clusters
  DROP CONSTRAINT IF EXISTS news_clusters_region_check;
ALTER TABLE news_clusters
  ADD CONSTRAINT news_clusters_region_check
  CHECK (region IN ('global', 'turkey'));

-- 2) Replace uniqueness on cluster_key alone with (cluster_key, region)
ALTER TABLE news_clusters
  DROP CONSTRAINT IF EXISTS news_clusters_cluster_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS news_clusters_cluster_key_region_key
  ON news_clusters(cluster_key, region);

-- 3) Helpful indexes for region-scoped reads/search
CREATE INDEX IF NOT EXISTS idx_news_clusters_region_published
  ON news_clusters(region, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_news_clusters_region_rank
  ON news_clusters(region, rank_score DESC, published_at DESC);

