-- Migration 080: Funding timeline dedupe fallback when round_type is missing
--
-- Problem:
-- Funding event dedupe currently depends on a normalized round_type/event_key.
-- When the extractor captures the same funding story from multiple clusters but
-- fails to infer the round label, duplicate rows remain in startup_events and
-- the dossier timeline renders repeated "Funding Raised" entries.
--
-- Goal:
-- 1) Remove existing duplicate cap_funding_raised rows whose round_type is blank
--    but whose normalized amount/date/lead-investor fingerprint matches.
-- 2) Add a DB-level uniqueness guard for that missing-round fallback case.

DO $$
BEGIN
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

    CREATE TEMP TABLE IF NOT EXISTS _funding_event_missing_round_dedupe_map (
        drop_event_id UUID PRIMARY KEY,
        keep_event_id UUID NOT NULL
    ) ON COMMIT DROP;
    TRUNCATE _funding_event_missing_round_dedupe_map;

    INSERT INTO _funding_event_missing_round_dedupe_map (drop_event_id, keep_event_id)
    WITH funding_events AS (
        SELECT
            se.id,
            se.startup_id,
            COALESCE(se.region, 'global') AS region_norm,
            LOWER(TRIM(COALESCE(NULLIF(se.event_key, ''), NULLIF(se.metadata_json->>'round_type', '')))) AS round_type_norm,
            se.effective_date,
            REGEXP_REPLACE(
                LOWER(REPLACE(REPLACE(TRIM(COALESCE(NULLIF(se.metadata_json->>'funding_amount', ''), NULLIF(se.metadata_json->>'mentioned_amount', ''), '')), ' ', ''), ',', '')),
                '([0-9]+)\.0+([a-z])',
                '\1\2',
                'g'
            ) AS amount_norm,
            REGEXP_REPLACE(LOWER(TRIM(COALESCE(se.metadata_json->>'lead_investor', ''))), '\s+', ' ', 'g') AS lead_investor_norm,
            COALESCE(se.confidence, 0) AS confidence_norm,
            se.detected_at,
            (
                CASE WHEN NULLIF(COALESCE(se.metadata_json->>'funding_amount', se.metadata_json->>'mentioned_amount', ''), '') IS NOT NULL THEN 1 ELSE 0 END
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
        WHERE fe.round_type_norm = ''
          AND (fe.amount_norm <> '' OR fe.lead_investor_norm <> '')
    )
    SELECT loser.id AS drop_event_id, keeper.id AS keep_event_id
    FROM ranked loser
    JOIN ranked keeper
      ON keeper.startup_id = loser.startup_id
     AND keeper.region_norm = loser.region_norm
     AND keeper.effective_date = loser.effective_date
     AND keeper.amount_norm = loser.amount_norm
     AND keeper.lead_investor_norm = loser.lead_investor_norm
     AND keeper.rn = 1
    WHERE loser.rn > 1;

    IF to_regclass('public.startup_refresh_jobs') IS NOT NULL
       AND EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'startup_refresh_jobs' AND column_name = 'trigger_event_id'
       ) THEN
        UPDATE startup_refresh_jobs srj
        SET trigger_event_id = m.keep_event_id
        FROM _funding_event_missing_round_dedupe_map m
        WHERE srj.trigger_event_id = m.drop_event_id;
    END IF;

    IF to_regclass('public.signal_evidence') IS NOT NULL
       AND EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'signal_evidence' AND column_name = 'event_id'
       ) THEN
        UPDATE signal_evidence se
        SET event_id = m.keep_event_id
        FROM _funding_event_missing_round_dedupe_map m
        WHERE se.event_id = m.drop_event_id
          AND NOT EXISTS (
                SELECT 1
                FROM signal_evidence existing
                WHERE existing.signal_id = se.signal_id
                  AND existing.event_id = m.keep_event_id
                  AND existing.id <> se.id
          );

        DELETE FROM signal_evidence se
        USING _funding_event_missing_round_dedupe_map m
        WHERE se.event_id = m.drop_event_id;
    END IF;

    DELETE FROM startup_events se
    USING _funding_event_missing_round_dedupe_map m
    WHERE se.id = m.drop_event_id;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'uq_startup_events_funding_fingerprint_missing_round'
    ) THEN
        EXECUTE $sql$
            CREATE UNIQUE INDEX uq_startup_events_funding_fingerprint_missing_round
                ON startup_events (
                    startup_id,
                    COALESCE(region, 'global'),
                    effective_date,
                    REGEXP_REPLACE(
                        LOWER(REPLACE(REPLACE(TRIM(COALESCE(NULLIF(metadata_json->>'funding_amount', ''), NULLIF(metadata_json->>'mentioned_amount', ''), '')), ' ', ''), ',', '')),
                        '([0-9]+)\.0+([a-z])',
                        '\1\2',
                        'g'
                    ),
                    REGEXP_REPLACE(LOWER(TRIM(COALESCE(metadata_json->>'lead_investor', ''))), '\s+', ' ', 'g')
                )
            WHERE event_type = 'cap_funding_raised'
              AND startup_id IS NOT NULL
              AND effective_date IS NOT NULL
              AND LOWER(TRIM(COALESCE(NULLIF(event_key, ''), NULLIF(metadata_json->>'round_type', '')))) = ''
              AND (
                    REGEXP_REPLACE(
                        LOWER(REPLACE(REPLACE(TRIM(COALESCE(NULLIF(metadata_json->>'funding_amount', ''), NULLIF(metadata_json->>'mentioned_amount', ''), '')), ' ', ''), ',', '')),
                        '([0-9]+)\.0+([a-z])',
                        '\1\2',
                        'g'
                    ) <> ''
              OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(metadata_json->>'lead_investor', ''))), '\s+', ' ', 'g') <> ''
              );
        $sql$;
    END IF;
END $$;
