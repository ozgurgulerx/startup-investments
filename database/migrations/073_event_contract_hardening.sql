-- Migration 073: Harden Event Object contract (startup_events)
--
-- Ensures every event:
-- - has detected_at + effective_date (temporal)
-- - has confidence (0..1)
-- - can reference canonical evidence via evidence_ids[]
-- - can reference actor/target via entity_nodes
-- - can carry a typed, versioned payload (event_features_json/version)

-- ---------------------------------------------------------------------------
-- Temporal fields
-- ---------------------------------------------------------------------------

ALTER TABLE startup_events
    ADD COLUMN IF NOT EXISTS detected_at TIMESTAMPTZ;

ALTER TABLE startup_events
    ALTER COLUMN detected_at SET DEFAULT NOW();

UPDATE startup_events
SET detected_at = COALESCE(detected_at, event_date, processed_at, NOW())
WHERE detected_at IS NULL;

ALTER TABLE startup_events
    ALTER COLUMN detected_at SET NOT NULL;

ALTER TABLE startup_events
    ADD COLUMN IF NOT EXISTS effective_date DATE;

ALTER TABLE startup_events
    ALTER COLUMN effective_date SET DEFAULT CURRENT_DATE;

UPDATE startup_events
SET effective_date = COALESCE(effective_date, event_date::date, detected_at::date, CURRENT_DATE)
WHERE effective_date IS NULL;

ALTER TABLE startup_events
    ALTER COLUMN effective_date SET NOT NULL;

-- ---------------------------------------------------------------------------
-- Confidence hardening (0..1)
-- ---------------------------------------------------------------------------

ALTER TABLE startup_events
    ADD COLUMN IF NOT EXISTS confidence NUMERIC(3,2);

ALTER TABLE startup_events
    ALTER COLUMN confidence SET DEFAULT 0;

UPDATE startup_events
SET confidence = 0
WHERE confidence IS NULL;

-- Clamp any out-of-range legacy values before enforcing CHECK.
UPDATE startup_events
SET confidence = LEAST(1, GREATEST(0, confidence))
WHERE confidence < 0 OR confidence > 1;

ALTER TABLE startup_events
    ALTER COLUMN confidence SET NOT NULL;

DO $$ BEGIN
    ALTER TABLE startup_events
        ADD CONSTRAINT chk_startup_events_confidence_range
        CHECK (confidence >= 0 AND confidence <= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Canonical evidence + actor/target
-- ---------------------------------------------------------------------------

ALTER TABLE startup_events
    ADD COLUMN IF NOT EXISTS evidence_ids UUID[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE startup_events
    ADD COLUMN IF NOT EXISTS actor_entity_id UUID REFERENCES entity_nodes(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS target_entity_id UUID REFERENCES entity_nodes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_startup_events_actor_entity
    ON startup_events (actor_entity_id) WHERE actor_entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_startup_events_target_entity
    ON startup_events (target_entity_id) WHERE target_entity_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Typed + versioned payload (parallel to legacy metadata_json)
-- ---------------------------------------------------------------------------

ALTER TABLE startup_events
    ADD COLUMN IF NOT EXISTS event_features_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS event_features_version INTEGER NOT NULL DEFAULT 1;

-- Best-effort backfill from metadata_json when present.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'startup_events' AND column_name = 'metadata_json'
    ) THEN
        UPDATE startup_events
        SET event_features_json = COALESCE(metadata_json, '{}'::jsonb)
        WHERE (event_features_json IS NULL OR event_features_json = '{}'::jsonb)
          AND metadata_json IS NOT NULL
          AND metadata_json <> '{}'::jsonb;
    END IF;
END $$;

-- Best-effort backfill evidence_ids from cluster evidence objects when available.
DO $$
BEGIN
    IF to_regclass('public.news_clusters') IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'news_clusters' AND column_name = 'evidence_object_id'
       )
       AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'startup_events' AND column_name = 'cluster_id'
       )
    THEN
        UPDATE startup_events se
        SET evidence_ids = ARRAY[nc.evidence_object_id]
        FROM news_clusters nc
        WHERE se.cluster_id = nc.id
          AND nc.evidence_object_id IS NOT NULL
          AND (array_length(se.evidence_ids, 1) IS NULL OR array_length(se.evidence_ids, 1) = 0);
    END IF;
END $$;

