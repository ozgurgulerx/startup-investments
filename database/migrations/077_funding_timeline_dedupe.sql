-- Migration 077: Funding timeline dedupe for startup_events
--
-- Problem:
-- The dossier timeline reads from startup_events. Funding events are currently
-- deduped per cluster, so the same funding round can appear multiple times when
-- extracted from multiple clusters.
--
-- Goal:
-- 1) Remove existing exact funding duplicates.
-- 2) Add a DB-level uniqueness guard so exact duplicates cannot be inserted again.
--
-- Exact fingerprint (normalized):
--   startup_id
--   region (COALESCE(region, 'global'))
--   round_type (lower(trim(COALESCE(event_key, metadata_json->>'round_type'))))
--   effective_date
--   amount token (lower(trim(COALESCE(metadata_json->>'funding_amount',
--                                       metadata_json->>'mentioned_amount'))), with spaces/commas removed)
--   lead investor token (lower(trim(metadata_json->>'lead_investor')), collapsing internal whitespace)

DO $$
BEGIN
    -- This migration depends on startup_events hardening from prior migrations.
    IF to_regclass('public.startup_events') IS NULL THEN
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'startup_events' AND column_name = 'metadata_json'
    )
    OR NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'startup_events' AND column_name = 'event_key'
    )
    OR NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'startup_events' AND column_name = 'region'
    )
    OR NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'startup_events' AND column_name = 'effective_date'
    )
    OR NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'startup_events' AND column_name = 'confidence'
    )
    OR NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'startup_events' AND column_name = 'detected_at'
    ) THEN
        RETURN;
    END IF;

    CREATE TEMP TABLE IF NOT EXISTS _funding_event_dedupe_map (
        drop_event_id UUID PRIMARY KEY,
        keep_event_id UUID NOT NULL
    ) ON COMMIT DROP;
    TRUNCATE _funding_event_dedupe_map;

    INSERT INTO _funding_event_dedupe_map (drop_event_id, keep_event_id)
    WITH funding_events AS (
        SELECT
            se.id,
            se.startup_id,
            COALESCE(se.region, 'global') AS region_norm,
            LOWER(TRIM(COALESCE(NULLIF(se.event_key, ''), NULLIF(se.metadata_json->>'round_type', '')))) AS round_type_norm,
            se.effective_date,
            LOWER(REPLACE(REPLACE(TRIM(COALESCE(NULLIF(se.metadata_json->>'funding_amount', ''), NULLIF(se.metadata_json->>'mentioned_amount', ''), '')), ' ', ''), ',', '')) AS amount_norm,
            REGEXP_REPLACE(LOWER(TRIM(COALESCE(se.metadata_json->>'lead_investor', ''))), '\s+', ' ', 'g') AS lead_investor_norm,
            COALESCE(se.confidence, 0) AS confidence_norm,
            se.detected_at,
            (
                CASE WHEN NULLIF(COALESCE(se.event_key, se.metadata_json->>'round_type', ''), '') IS NOT NULL THEN 1 ELSE 0 END
              + CASE WHEN NULLIF(COALESCE(se.metadata_json->>'funding_amount', se.metadata_json->>'mentioned_amount', ''), '') IS NOT NULL THEN 1 ELSE 0 END
              + CASE WHEN NULLIF(COALESCE(se.metadata_json->>'lead_investor', ''), '') IS NOT NULL THEN 1 ELSE 0 END
            ) AS metadata_richness
        FROM startup_events se
        WHERE se.event_type = 'cap_funding_raised'
          AND se.startup_id IS NOT NULL
          AND se.effective_date IS NOT NULL
    ),
    ranked AS (
        SELECT
            fe.*,
            ROW_NUMBER() OVER (
                PARTITION BY
                    fe.startup_id,
                    fe.region_norm,
                    fe.round_type_norm,
                    fe.effective_date,
                    fe.amount_norm,
                    fe.lead_investor_norm
                ORDER BY
                    fe.confidence_norm DESC,
                    fe.metadata_richness DESC,
                    fe.detected_at DESC,
                    fe.id DESC
            ) AS rn
        FROM funding_events fe
        WHERE fe.round_type_norm <> ''
    )
    SELECT loser.id AS drop_event_id, keeper.id AS keep_event_id
    FROM ranked loser
    JOIN ranked keeper
      ON keeper.startup_id = loser.startup_id
     AND keeper.region_norm = loser.region_norm
     AND keeper.round_type_norm = loser.round_type_norm
     AND keeper.effective_date = loser.effective_date
     AND keeper.amount_norm = loser.amount_norm
     AND keeper.lead_investor_norm = loser.lead_investor_norm
     AND keeper.rn = 1
    WHERE loser.rn > 1;

    -- Re-point startup_refresh_jobs trigger references when available.
    IF to_regclass('public.startup_refresh_jobs') IS NOT NULL
       AND EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'startup_refresh_jobs' AND column_name = 'trigger_event_id'
       ) THEN
        UPDATE startup_refresh_jobs srj
        SET trigger_event_id = m.keep_event_id
        FROM _funding_event_dedupe_map m
        WHERE srj.trigger_event_id = m.drop_event_id;
    END IF;

    -- Re-point signal_evidence.event_id when available (avoid unique conflicts).
    IF to_regclass('public.signal_evidence') IS NOT NULL
       AND EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'signal_evidence' AND column_name = 'event_id'
       ) THEN
        UPDATE signal_evidence se
        SET event_id = m.keep_event_id
        FROM _funding_event_dedupe_map m
        WHERE se.event_id = m.drop_event_id
          AND NOT EXISTS (
                SELECT 1
                FROM signal_evidence existing
                WHERE existing.signal_id = se.signal_id
                  AND existing.event_id = m.keep_event_id
                  AND existing.id <> se.id
          );

        -- Any remaining rows still referencing dropped ids are exact conflicts now.
        DELETE FROM signal_evidence se
        USING _funding_event_dedupe_map m
        WHERE se.event_id = m.drop_event_id;
    END IF;

    -- Delete duplicate startup events.
    DELETE FROM startup_events se
    USING _funding_event_dedupe_map m
    WHERE se.id = m.drop_event_id;

    -- DB-level prevention: exact funding fingerprint uniqueness.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'uq_startup_events_funding_fingerprint'
    ) THEN
        EXECUTE $sql$
            CREATE UNIQUE INDEX uq_startup_events_funding_fingerprint
                ON startup_events (
                    startup_id,
                    COALESCE(region, 'global'),
                    LOWER(TRIM(COALESCE(NULLIF(event_key, ''), NULLIF(metadata_json->>'round_type', '')))),
                    effective_date,
                    LOWER(REPLACE(REPLACE(TRIM(COALESCE(NULLIF(metadata_json->>'funding_amount', ''), NULLIF(metadata_json->>'mentioned_amount', ''), '')), ' ', ''), ',', '')),
                    REGEXP_REPLACE(LOWER(TRIM(COALESCE(metadata_json->>'lead_investor', ''))), '\s+', ' ', 'g')
                )
            WHERE event_type = 'cap_funding_raised'
              AND startup_id IS NOT NULL
              AND effective_date IS NOT NULL
              AND LOWER(TRIM(COALESCE(NULLIF(event_key, ''), NULLIF(metadata_json->>'round_type', '')))) <> '';
        $sql$;
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Runbook verification queries (manual)
-- -----------------------------------------------------------------------------
-- 1) Duplicate fingerprints remaining (expect 0 rows):
--    SELECT startup_id,
--           COALESCE(region, 'global') AS region_norm,
--           LOWER(TRIM(COALESCE(NULLIF(event_key, ''), NULLIF(metadata_json->>'round_type', '')))) AS round_type_norm,
--           effective_date,
--           LOWER(REPLACE(REPLACE(TRIM(COALESCE(NULLIF(metadata_json->>'funding_amount', ''), NULLIF(metadata_json->>'mentioned_amount', ''), '')), ' ', ''), ',', '')) AS amount_norm,
--           REGEXP_REPLACE(LOWER(TRIM(COALESCE(metadata_json->>'lead_investor', ''))), '\s+', ' ', 'g') AS lead_investor_norm,
--           COUNT(*) AS cnt
--    FROM startup_events
--    WHERE event_type = 'cap_funding_raised'
--      AND startup_id IS NOT NULL
--      AND effective_date IS NOT NULL
--      AND LOWER(TRIM(COALESCE(NULLIF(event_key, ''), NULLIF(metadata_json->>'round_type', '')))) <> ''
--    GROUP BY 1,2,3,4,5,6
--    HAVING COUNT(*) > 1
--    ORDER BY cnt DESC;
--
-- 2) Startup-level duplicate count:
--    SELECT startup_id, COUNT(*) AS duplicate_rows
--    FROM (
--      SELECT startup_id,
--             COALESCE(region, 'global'),
--             LOWER(TRIM(COALESCE(NULLIF(event_key, ''), NULLIF(metadata_json->>'round_type', '')))),
--             effective_date,
--             LOWER(REPLACE(REPLACE(TRIM(COALESCE(NULLIF(metadata_json->>'funding_amount', ''), NULLIF(metadata_json->>'mentioned_amount', ''), '')), ' ', ''), ',', '')),
--             REGEXP_REPLACE(LOWER(TRIM(COALESCE(metadata_json->>'lead_investor', ''))), '\s+', ' ', 'g'),
--             COUNT(*) AS c
--      FROM startup_events
--      WHERE event_type = 'cap_funding_raised'
--        AND startup_id IS NOT NULL
--        AND effective_date IS NOT NULL
--        AND LOWER(TRIM(COALESCE(NULLIF(event_key, ''), NULLIF(metadata_json->>'round_type', '')))) <> ''
--      GROUP BY 1,2,3,4,5,6
--      HAVING COUNT(*) > 1
--    ) t
--    GROUP BY startup_id
--    ORDER BY duplicate_rows DESC;
