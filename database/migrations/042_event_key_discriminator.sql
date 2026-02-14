-- Migration 042: Add event_key discriminator to startup_events
--
-- Problem: The dedup index (cluster_id, event_type, startup_id) silently drops
-- events when one news cluster yields multiple events of the same type for the
-- same startup (e.g., 3 arch_pattern_adopted events for RAG + Agents + Evals).
-- Only the first is stored; the rest hit ON CONFLICT DO NOTHING.
--
-- Solution: Add event_key column as a discriminator. For arch_pattern_adopted
-- events, event_key = pattern_name; for funding events, event_key = round_type;
-- for others it defaults to '' (preserving old behavior for 1:1 event types).

-- =============================================================================
-- 1. Add event_key column with a safe default
-- =============================================================================

ALTER TABLE startup_events
    ADD COLUMN IF NOT EXISTS event_key TEXT NOT NULL DEFAULT '';

-- Prevent concurrent writers (e.g., news-ingest) from racing the backfill
-- updates below and triggering unique constraint violations.
LOCK TABLE startup_events IN SHARE ROW EXCLUSIVE MODE;

-- =============================================================================
-- 2. Backfill event_key from metadata_json for existing rows
-- =============================================================================

-- Idempotency guard:
-- This repo's migration runner re-applies migrations on every pipeline run.
-- If the unique index already exists and newer code has started inserting
-- event_key at write-time, we can end up with:
--   - a legacy row with event_key = '' and metadata_json containing a key
--   - a newer row already stored with event_key = that same key
-- Updating the legacy row would violate uq_startup_events_cluster_type_startup_key.
-- In that case, delete the legacy empty-key row (it is a duplicate).

-- arch_pattern_adopted: empty-key row would collide with an existing keyed row
DELETE FROM startup_events a
USING startup_events b
WHERE a.cluster_id IS NOT NULL
  AND a.event_type = 'arch_pattern_adopted'
  AND a.event_key = ''
  AND NULLIF(a.metadata_json->>'pattern_name', '') IS NOT NULL
  AND b.cluster_id = a.cluster_id
  AND b.startup_id = a.startup_id
  AND b.event_type = a.event_type
  AND b.event_key = a.metadata_json->>'pattern_name';

-- cap_funding_raised: empty-key row would collide with an existing keyed row
DELETE FROM startup_events a
USING startup_events b
WHERE a.cluster_id IS NOT NULL
  AND a.event_type = 'cap_funding_raised'
  AND a.event_key = ''
  AND NULLIF(a.metadata_json->>'round_type', '') IS NOT NULL
  AND b.cluster_id = a.cluster_id
  AND b.startup_id = a.startup_id
  AND b.event_type = a.event_type
  AND b.event_key = a.metadata_json->>'round_type';

-- cap_acquisition_announced: empty-key row would collide with an existing keyed row
DELETE FROM startup_events a
USING startup_events b
WHERE a.cluster_id IS NOT NULL
  AND a.event_type = 'cap_acquisition_announced'
  AND a.event_key = ''
  AND NULLIF(a.metadata_json->>'acquisition_target', '') IS NOT NULL
  AND b.cluster_id = a.cluster_id
  AND b.startup_id = a.startup_id
  AND b.event_type = a.event_type
  AND b.event_key = a.metadata_json->>'acquisition_target';

-- gtm_*: empty-key row would collide with an existing keyed row
DELETE FROM startup_events a
USING startup_events b
WHERE a.cluster_id IS NOT NULL
  AND a.event_type LIKE 'gtm_%'
  AND a.event_key = ''
  AND NULLIF(a.metadata_json->>'gtm_tag', '') IS NOT NULL
  AND b.cluster_id = a.cluster_id
  AND b.startup_id = a.startup_id
  AND b.event_type = a.event_type
  AND b.event_key = a.metadata_json->>'gtm_tag';

-- prod_launched: empty-key row would collide with an existing keyed row
DELETE FROM startup_events a
USING startup_events b
WHERE a.cluster_id IS NOT NULL
  AND a.event_type = 'prod_launched'
  AND a.event_key = ''
  AND NULLIF(a.metadata_json->>'product_launched', '') IS NOT NULL
  AND b.cluster_id = a.cluster_id
  AND b.startup_id = a.startup_id
  AND b.event_type = a.event_type
  AND b.event_key = a.metadata_json->>'product_launched';

DO $$
BEGIN
    -- IMPORTANT: this repo's migration runner re-applies migrations on every pipeline run.
    -- Once uq_startup_events_cluster_type_startup_key exists, other jobs can be inserting
    -- keyed rows concurrently (news-ingest, event-processor, etc). Backfilling event_key
    -- during a re-apply can intermittently hit unique violations and fail CronJobs.
    --
    -- The backfill is only needed on first apply, so skip it once the new index exists.
    IF to_regclass('public.uq_startup_events_cluster_type_startup_key') IS NOT NULL THEN
        RETURN;
    END IF;

    -- arch_pattern_adopted → pattern_name
    UPDATE startup_events
    SET event_key = metadata_json->>'pattern_name'
    WHERE event_type = 'arch_pattern_adopted'
      AND NULLIF(metadata_json->>'pattern_name', '') IS NOT NULL
      AND event_key = '';

    -- cap_funding_raised → round_type
    UPDATE startup_events
    SET event_key = metadata_json->>'round_type'
    WHERE event_type = 'cap_funding_raised'
      AND NULLIF(metadata_json->>'round_type', '') IS NOT NULL
      AND event_key = '';

    -- cap_acquisition_announced → acquisition_target
    UPDATE startup_events
    SET event_key = metadata_json->>'acquisition_target'
    WHERE event_type = 'cap_acquisition_announced'
      AND NULLIF(metadata_json->>'acquisition_target', '') IS NOT NULL
      AND event_key = '';

    -- gtm_* events → gtm_tag
    UPDATE startup_events
    SET event_key = metadata_json->>'gtm_tag'
    WHERE event_type LIKE 'gtm_%'
      AND NULLIF(metadata_json->>'gtm_tag', '') IS NOT NULL
      AND event_key = '';

    -- prod_launched → product_launched
    UPDATE startup_events
    SET event_key = metadata_json->>'product_launched'
    WHERE event_type = 'prod_launched'
      AND NULLIF(metadata_json->>'product_launched', '') IS NOT NULL
      AND event_key = '';
END $$;

-- =============================================================================
-- 3. Backfill any NULL detected_at (safety net)
-- =============================================================================

UPDATE startup_events
SET detected_at = COALESCE(event_date, NOW())
WHERE detected_at IS NULL;

ALTER TABLE startup_events
    ALTER COLUMN detected_at SET NOT NULL;

-- =============================================================================
-- 4. Dedup rows that would violate the new unique constraint
--    Keep the earliest by detected_at, break ties by id (smallest = oldest)
-- =============================================================================

DELETE FROM startup_events
WHERE id IN (
    SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY cluster_id, startup_id, event_type, event_key
                   ORDER BY detected_at ASC, id ASC
               ) AS rn
        FROM startup_events
        WHERE cluster_id IS NOT NULL
    ) ranked
    WHERE rn > 1
);

-- Clean orphaned signal_evidence rows pointing at deleted events
DELETE FROM signal_evidence
WHERE event_id IS NOT NULL
  AND event_id NOT IN (SELECT id FROM startup_events);

-- =============================================================================
-- 5. Drop old dedup index, create new one with event_key
-- =============================================================================

DROP INDEX IF EXISTS uq_startup_events_cluster_type_startup;

CREATE UNIQUE INDEX IF NOT EXISTS uq_startup_events_cluster_type_startup_key
    ON startup_events (cluster_id, startup_id, event_type, event_key)
    WHERE cluster_id IS NOT NULL;

-- =============================================================================
-- 6. Add a covering index for signal aggregation queries
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_startup_events_type_key
    ON startup_events (event_type, event_key, detected_at DESC)
    WHERE event_key != '';

-- =============================================================================
-- 7. Recompute signal evidence_count from surviving rows
-- =============================================================================

UPDATE signals s
SET evidence_count = sub.cnt,
    unique_company_count = sub.ucc
FROM (
    SELECT se.signal_id,
           COUNT(*) AS cnt,
           COUNT(DISTINCT se.startup_id) AS ucc
    FROM signal_evidence se
    WHERE se.signal_id IS NOT NULL
    GROUP BY se.signal_id
) sub
WHERE s.id = sub.signal_id
  AND (s.evidence_count != sub.cnt OR s.unique_company_count != sub.ucc);
