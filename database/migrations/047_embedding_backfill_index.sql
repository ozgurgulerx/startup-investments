-- Partial index to speed up embedding backfill queries.
-- Covers: SELECT ... FROM news_clusters WHERE embedding IS NULL ORDER BY published_at
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_news_clusters_unembedded
    ON news_clusters (published_at)
    WHERE embedding IS NULL;
