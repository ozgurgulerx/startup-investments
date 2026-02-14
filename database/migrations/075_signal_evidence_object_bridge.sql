-- Migration 075: Bridge signal evidence to canonical evidence_objects
--
-- Deep-dive and signal UIs historically referenced signal_evidence.id (UUID).
-- This migration adds a pointer to canonical evidence_objects so downstream
-- objects can link back to evidence_ids.

ALTER TABLE signal_evidence
    ADD COLUMN IF NOT EXISTS evidence_object_id UUID
        REFERENCES evidence_objects(evidence_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_signal_evidence_evidence_object
    ON signal_evidence (evidence_object_id) WHERE evidence_object_id IS NOT NULL;

-- Signal move extractions: store canonical evidence ids alongside legacy evidence_ids.
ALTER TABLE signal_moves
    ADD COLUMN IF NOT EXISTS evidence_object_ids UUID[] NOT NULL DEFAULT '{}'::uuid[];

-- Best-effort backfills (idempotent):
-- 1) Cluster evidence rows -> news_clusters.evidence_object_id
DO $$
BEGIN
    IF to_regclass('public.news_clusters') IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'news_clusters' AND column_name = 'evidence_object_id'
       )
    THEN
        UPDATE signal_evidence se
        SET evidence_object_id = nc.evidence_object_id
        FROM news_clusters nc
        WHERE se.cluster_id = nc.id
          AND se.evidence_object_id IS NULL
          AND nc.evidence_object_id IS NOT NULL;
    END IF;
END $$;

-- 2) Event evidence rows -> startup_events.evidence_ids[1] (first canonical evidence id)
DO $$
BEGIN
    IF to_regclass('public.startup_events') IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'startup_events' AND column_name = 'evidence_ids'
       )
    THEN
        UPDATE signal_evidence sev
        SET evidence_object_id = se.evidence_ids[1]
        FROM startup_events se
        WHERE sev.event_id = se.id
          AND sev.evidence_object_id IS NULL
          AND array_length(se.evidence_ids, 1) >= 1
          AND se.evidence_ids[1] IS NOT NULL;
    END IF;
END $$;

