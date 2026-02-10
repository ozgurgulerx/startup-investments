-- 034: Add structured impact object to news_clusters
-- Stores per-story impact analysis (frame, kicker, builder_move, investor_angle, watchout, validation)
-- Backward compatible: builder_takeaway TEXT column stays; impact JSONB is additive.

ALTER TABLE news_clusters ADD COLUMN IF NOT EXISTS impact JSONB;

CREATE INDEX IF NOT EXISTS idx_news_clusters_impact_frame
    ON news_clusters ((impact->>'frame')) WHERE impact IS NOT NULL;
