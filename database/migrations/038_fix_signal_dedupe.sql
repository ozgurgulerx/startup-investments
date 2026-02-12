-- Migration 038: Fix signal deduplication and constraints
-- Fixes: duplicate evidence (Bug 1), duplicate events (Bug 2), stale signal counts

-- ============================================================
-- A. Deduplicate & constrain signal_evidence (Bug 1)
-- ============================================================

-- Delete duplicate evidence rows (keep earliest per signal_id+event_id)
DELETE FROM signal_evidence a
USING signal_evidence b
WHERE a.signal_id = b.signal_id
  AND a.event_id = b.event_id
  AND a.event_id IS NOT NULL
  AND a.created_at > b.created_at;

-- Unique partial index so ON CONFLICT works for event-based evidence
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_evidence_signal_event
    ON signal_evidence (signal_id, event_id) WHERE event_id IS NOT NULL;

-- Unique partial index for cluster-only evidence (no event_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_evidence_signal_cluster
    ON signal_evidence (signal_id, cluster_id)
    WHERE event_id IS NULL AND cluster_id IS NOT NULL;

-- ============================================================
-- B. Deduplicate & constrain startup_events (Bug 2)
-- ============================================================

-- Only deduplicate on (cluster_id, event_type, startup_id) if the event_key
-- discriminator hasn't been added yet by migration 042.  Once event_key exists,
-- 042 owns its own 4-column dedup + unique index, so running the 3-column
-- DELETE here would incorrectly delete events with different event_key values.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'startup_events' AND column_name = 'event_key'
    ) THEN
        DELETE FROM startup_events a
        USING startup_events b
        WHERE a.cluster_id = b.cluster_id
          AND a.event_type = b.event_type
          AND a.startup_id = b.startup_id
          AND a.cluster_id IS NOT NULL
          AND a.detected_at > b.detected_at;

        CREATE UNIQUE INDEX IF NOT EXISTS uq_startup_events_cluster_type_startup
            ON startup_events (cluster_id, event_type, startup_id)
            WHERE cluster_id IS NOT NULL;
    END IF;
END $$;

-- ============================================================
-- C. Recompute signal counts after dedup
-- ============================================================

UPDATE signals s SET
    evidence_count = sub.cnt,
    unique_company_count = sub.companies
FROM (
    SELECT signal_id,
           COUNT(*) AS cnt,
           COUNT(DISTINCT startup_id) FILTER (WHERE startup_id IS NOT NULL) AS companies
    FROM signal_evidence
    GROUP BY signal_id
) sub
WHERE s.id = sub.signal_id;
