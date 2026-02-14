-- Migration 070: Investor news links (all-time, no aging)
--
-- Purpose:
-- - Attach *all* news clusters that mention an investor (memory_gate linked_entities_json)
--   under that investor, and keep the link history forever (no aging).
-- - Also attach funding-related news via news-derived capital graph edges when present.
--
-- Implementation notes:
-- - The repo migration runner re-applies migrations; everything here must be idempotent.
-- - Triggers are created only when the required tables exist (to avoid failing on partial schemas).

DO $$
BEGIN
    -- Only create the table when required base tables exist. This keeps the migration
    -- safe in partial-schema environments (the migration runner re-applies files).
    IF to_regclass('public.investor_news_links') IS NULL THEN
        IF to_regclass('public.investors') IS NULL OR to_regclass('public.news_clusters') IS NULL THEN
            RETURN;
        END IF;

        EXECUTE $sql$
        CREATE TABLE investor_news_links (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            investor_id UUID NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
            cluster_id UUID NOT NULL REFERENCES news_clusters(id) ON DELETE CASCADE,
            region TEXT NOT NULL DEFAULT 'global' CHECK (region IN ('global', 'turkey')),
            link_type TEXT NOT NULL CHECK (link_type IN ('mention', 'funding_lead', 'funding_participant')),
            confidence NUMERIC(5,4),
            source TEXT NOT NULL DEFAULT 'memory_gate',
            source_ref TEXT,
            cluster_published_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        $sql$;
    END IF;

    IF to_regclass('public.investor_news_links') IS NOT NULL THEN
        EXECUTE $sql$
        CREATE UNIQUE INDEX IF NOT EXISTS uq_investor_news_links_identity
            ON investor_news_links(investor_id, cluster_id, region, link_type);
        $sql$;

        EXECUTE $sql$
        CREATE INDEX IF NOT EXISTS idx_investor_news_links_investor_recent
            ON investor_news_links(investor_id, region, cluster_published_at DESC NULLS LAST);
        $sql$;

        EXECUTE $sql$
        CREATE INDEX IF NOT EXISTS idx_investor_news_links_cluster
            ON investor_news_links(cluster_id, region);
        $sql$;
    END IF;
END $$;

-- Optional support index for ad-hoc JSONB queries on extractions (not required for triggers).
DO $$
BEGIN
    IF to_regclass('public.news_item_extractions') IS NOT NULL THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_item_extractions_linked_entities_json
                 ON news_item_extractions USING GIN(linked_entities_json jsonb_path_ops)';
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Trigger: news_item_extractions -> investor_news_links (mentions)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_investor_news_links_from_extractions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_region TEXT;
    v_published_at TIMESTAMPTZ;
BEGIN
    -- Resolve region + published_at from the cluster (authoritative).
    SELECT COALESCE(c.region, 'global'), c.published_at
      INTO v_region, v_published_at
      FROM news_clusters c
     WHERE c.id = NEW.cluster_id;

    -- Keep mention links in sync for this cluster: remove prior mention links then re-insert.
    DELETE FROM investor_news_links
     WHERE cluster_id = NEW.cluster_id
       AND region = COALESCE(v_region, 'global')
       AND link_type = 'mention';

    INSERT INTO investor_news_links (
        investor_id, cluster_id, region, link_type,
        confidence, source, source_ref, cluster_published_at
    )
    SELECT DISTINCT
        (e->>'investor_id')::uuid AS investor_id,
        NEW.cluster_id,
        COALESCE(v_region, 'global') AS region,
        'mention' AS link_type,
        NULLIF(e->>'match_score', '')::numeric AS confidence,
        'memory_gate' AS source,
        NEW.id::text AS source_ref,
        v_published_at AS cluster_published_at
    FROM jsonb_array_elements(COALESCE(NEW.linked_entities_json, '[]'::jsonb)) AS e
    WHERE (e->>'entity_type') = 'investor'
      AND (e ? 'investor_id')
      AND (e->>'investor_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ON CONFLICT (investor_id, cluster_id, region, link_type)
    DO UPDATE SET
        confidence = GREATEST(COALESCE(investor_news_links.confidence, 0), COALESCE(EXCLUDED.confidence, 0)),
        source = EXCLUDED.source,
        source_ref = EXCLUDED.source_ref,
        cluster_published_at = COALESCE(EXCLUDED.cluster_published_at, investor_news_links.cluster_published_at);

    RETURN NEW;
END;
$$;

DO $$
BEGIN
    IF to_regclass('public.investor_news_links') IS NOT NULL
       AND to_regclass('public.news_item_extractions') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS trg_sync_investor_news_links_from_extractions ON news_item_extractions;
        CREATE TRIGGER trg_sync_investor_news_links_from_extractions
            AFTER INSERT OR UPDATE OF linked_entities_json
            ON news_item_extractions
            FOR EACH ROW
            EXECUTE FUNCTION sync_investor_news_links_from_extractions();
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Trigger: capital_graph_edges (news_event funding edges) -> investor_news_links
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_investor_news_links_from_graph_edges()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_cluster_id UUID;
    v_published_at TIMESTAMPTZ;
    v_link_type TEXT;
BEGIN
    IF NEW.src_type <> 'investor' THEN
        RETURN NEW;
    END IF;
    IF NEW.source <> 'news_event' THEN
        RETURN NEW;
    END IF;
    IF NEW.source_ref IS NULL OR NEW.source_ref = '' THEN
        RETURN NEW;
    END IF;
    IF NEW.edge_type NOT IN ('LEADS_ROUND', 'INVESTED_IN') THEN
        RETURN NEW;
    END IF;

    -- source_ref must be a news cluster UUID; skip if not.
    IF NEW.source_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN NEW;
    END IF;
    v_cluster_id := NEW.source_ref::uuid;

    IF NEW.edge_type = 'LEADS_ROUND' THEN
        v_link_type := 'funding_lead';
    ELSE
        v_link_type := 'funding_participant';
    END IF;

    SELECT c.published_at
      INTO v_published_at
      FROM news_clusters c
     WHERE c.id = v_cluster_id;

    INSERT INTO investor_news_links (
        investor_id, cluster_id, region, link_type,
        confidence, source, source_ref, cluster_published_at
    )
    VALUES (
        NEW.src_id,
        v_cluster_id,
        NEW.region,
        v_link_type,
        NEW.confidence,
        'capital_graph_edges',
        NEW.id::text,
        v_published_at
    )
    ON CONFLICT (investor_id, cluster_id, region, link_type)
    DO UPDATE SET
        confidence = GREATEST(COALESCE(investor_news_links.confidence, 0), COALESCE(EXCLUDED.confidence, 0)),
        source = EXCLUDED.source,
        source_ref = EXCLUDED.source_ref,
        cluster_published_at = COALESCE(EXCLUDED.cluster_published_at, investor_news_links.cluster_published_at);

    RETURN NEW;
END;
$$;

DO $$
BEGIN
    IF to_regclass('public.investor_news_links') IS NOT NULL
       AND to_regclass('public.capital_graph_edges') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS trg_sync_investor_news_links_from_graph_edges ON capital_graph_edges;
        CREATE TRIGGER trg_sync_investor_news_links_from_graph_edges
            AFTER INSERT OR UPDATE OF edge_type, source, source_ref, confidence
            ON capital_graph_edges
            FOR EACH ROW
            EXECUTE FUNCTION sync_investor_news_links_from_graph_edges();
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- One-time backfill (runs only when table is empty)
-- -----------------------------------------------------------------------------

DO $$
DECLARE
    v_count BIGINT;
BEGIN
    IF to_regclass('public.investor_news_links') IS NULL THEN
        RETURN;
    END IF;

    SELECT COUNT(*) INTO v_count FROM investor_news_links;
    IF v_count > 0 THEN
        RETURN;
    END IF;

    -- Backfill funding links from existing news_event graph edges (if present).
    IF to_regclass('public.capital_graph_edges') IS NOT NULL THEN
        INSERT INTO investor_news_links (
            investor_id, cluster_id, region, link_type,
            confidence, source, source_ref, cluster_published_at
        )
        SELECT
            e.src_id AS investor_id,
            e.source_ref::uuid AS cluster_id,
            e.region,
            CASE WHEN e.edge_type = 'LEADS_ROUND' THEN 'funding_lead' ELSE 'funding_participant' END AS link_type,
            e.confidence,
            'capital_graph_edges' AS source,
            e.id::text AS source_ref,
            c.published_at AS cluster_published_at
        FROM capital_graph_edges e
        JOIN news_clusters c ON c.id::text = e.source_ref
        WHERE e.src_type = 'investor'
          AND e.source = 'news_event'
          AND e.edge_type IN ('LEADS_ROUND', 'INVESTED_IN')
          AND e.valid_to = DATE '9999-12-31'
          AND e.source_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        ON CONFLICT (investor_id, cluster_id, region, link_type) DO NOTHING;
    END IF;

    -- Backfill mention links from memory gate extractions (if present).
    IF to_regclass('public.news_item_extractions') IS NOT NULL THEN
        INSERT INTO investor_news_links (
            investor_id, cluster_id, region, link_type,
            confidence, source, source_ref, cluster_published_at
        )
        SELECT DISTINCT
            (e->>'investor_id')::uuid AS investor_id,
            x.cluster_id,
            COALESCE(c.region, 'global') AS region,
            'mention' AS link_type,
            NULLIF(e->>'match_score', '')::numeric AS confidence,
            'memory_gate' AS source,
            x.id::text AS source_ref,
            c.published_at AS cluster_published_at
        FROM news_item_extractions x
        JOIN news_clusters c ON c.id = x.cluster_id
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(x.linked_entities_json, '[]'::jsonb)) AS e
        WHERE (e->>'entity_type') = 'investor'
          AND (e ? 'investor_id')
          AND (e->>'investor_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        ON CONFLICT (investor_id, cluster_id, region, link_type) DO NOTHING;
    END IF;
END $$;
