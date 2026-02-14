-- Migration 074: Link news tables to canonical evidence_objects
--
-- Adds evidence_object_id pointers so clusters/items can be resolved to
-- evidence_objects.evidence_id (canonical Evidence Object contract).

ALTER TABLE news_items_raw
    ADD COLUMN IF NOT EXISTS evidence_object_id UUID
        REFERENCES evidence_objects(evidence_id) ON DELETE SET NULL;

ALTER TABLE news_clusters
    ADD COLUMN IF NOT EXISTS evidence_object_id UUID
        REFERENCES evidence_objects(evidence_id) ON DELETE SET NULL;

-- One evidence object per row (when populated).
CREATE UNIQUE INDEX IF NOT EXISTS uq_news_items_raw_evidence_object
    ON news_items_raw (evidence_object_id)
    WHERE evidence_object_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_news_clusters_evidence_object
    ON news_clusters (evidence_object_id)
    WHERE evidence_object_id IS NOT NULL;

