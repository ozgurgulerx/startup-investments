-- Migration 059: Capital Graph + Founder Normalization
--
-- Adds founder entities, alias tables, canonical graph edges, and
-- materialized views for investor/startup graph traversal.

-- =============================================================================
-- 1) FOUNDER ENTITIES
-- =============================================================================

CREATE TABLE IF NOT EXISTS founders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    slug TEXT,
    linkedin_url TEXT,
    x_url TEXT,
    website TEXT,
    bio TEXT,
    primary_country TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_founders_slug
    ON founders(slug)
    WHERE slug IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_founders_linkedin_url
    ON founders(linkedin_url)
    WHERE linkedin_url IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_founders_x_url
    ON founders(x_url)
    WHERE x_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_founders_name_norm
    ON founders((lower(regexp_replace(trim(full_name), '\\s+', ' ', 'g'))));

COMMENT ON TABLE founders IS
    'Canonical founder entities for startup-founder relationship mapping and people graph traversal.';

-- =============================================================================
-- 2) ALIASES (INVESTOR + FOUNDER)
-- =============================================================================

CREATE TABLE IF NOT EXISTS founder_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    founder_id UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    alias_type TEXT NOT NULL DEFAULT 'name_variant',
    source TEXT NOT NULL DEFAULT 'manual',
    confidence NUMERIC(5,4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_founder_aliases_alias_norm
    ON founder_aliases((lower(regexp_replace(trim(alias), '\\s+', ' ', 'g'))));

CREATE INDEX IF NOT EXISTS idx_founder_aliases_founder
    ON founder_aliases(founder_id);

COMMENT ON TABLE founder_aliases IS
    'Alias map for founder identity resolution (spelling variants, nicknames, transliterations).';

CREATE TABLE IF NOT EXISTS investor_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investor_id UUID NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    alias_type TEXT NOT NULL DEFAULT 'name_variant',
    source TEXT NOT NULL DEFAULT 'manual',
    confidence NUMERIC(5,4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_investor_aliases_alias_norm
    ON investor_aliases((lower(regexp_replace(trim(alias), '\\s+', ' ', 'g'))));

CREATE INDEX IF NOT EXISTS idx_investor_aliases_investor
    ON investor_aliases(investor_id);

COMMENT ON TABLE investor_aliases IS
    'Alias map for investor identity resolution (brand variants, suffix variants, abbreviations).';

-- =============================================================================
-- 3) STARTUP <-> FOUNDER EDGES
-- =============================================================================

CREATE TABLE IF NOT EXISTS startup_founders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    founder_id UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT '',
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    start_date DATE,
    end_date DATE,
    ownership_pct NUMERIC(5,2),
    source TEXT NOT NULL DEFAULT 'manual',
    confidence NUMERIC(5,4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_startup_founders_valid_dates CHECK (
        end_date IS NULL OR start_date IS NULL OR end_date >= start_date
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_startup_founders_unique
    ON startup_founders(startup_id, founder_id, role);

CREATE INDEX IF NOT EXISTS idx_startup_founders_startup
    ON startup_founders(startup_id);

CREATE INDEX IF NOT EXISTS idx_startup_founders_founder
    ON startup_founders(founder_id);

COMMENT ON TABLE startup_founders IS
    'Canonical startup-founder relationship table with role and confidence metadata.';

-- =============================================================================
-- 4) CANONICAL GRAPH EDGE TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS capital_graph_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    src_type TEXT NOT NULL CHECK (src_type IN ('investor', 'startup', 'founder', 'funding_round')),
    src_id UUID NOT NULL,
    edge_type TEXT NOT NULL,
    dst_type TEXT NOT NULL CHECK (dst_type IN ('investor', 'startup', 'founder', 'funding_round')),
    dst_id UUID NOT NULL,
    region TEXT NOT NULL DEFAULT 'global' CHECK (region IN ('global', 'turkey')),
    attrs_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    source TEXT NOT NULL DEFAULT 'manual',
    source_ref TEXT,
    confidence NUMERIC(5,4),
    created_by TEXT,
    valid_from DATE NOT NULL DEFAULT DATE '1900-01-01',
    valid_to DATE NOT NULL DEFAULT DATE '9999-12-31',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_capital_graph_not_self CHECK (
        NOT (src_type = dst_type AND src_id = dst_id)
    ),
    CONSTRAINT chk_capital_graph_date_window CHECK (valid_to >= valid_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_capital_graph_edges_identity
    ON capital_graph_edges(src_type, src_id, edge_type, dst_type, dst_id, region, valid_from, valid_to);

CREATE INDEX IF NOT EXISTS idx_capital_graph_src_active
    ON capital_graph_edges(src_type, src_id, region, edge_type)
    WHERE valid_to = DATE '9999-12-31';

CREATE INDEX IF NOT EXISTS idx_capital_graph_dst_active
    ON capital_graph_edges(dst_type, dst_id, region, edge_type)
    WHERE valid_to = DATE '9999-12-31';

CREATE INDEX IF NOT EXISTS idx_capital_graph_edge_type
    ON capital_graph_edges(edge_type, region);

CREATE INDEX IF NOT EXISTS idx_capital_graph_attrs_json
    ON capital_graph_edges USING GIN(attrs_json);

COMMENT ON TABLE capital_graph_edges IS
    'Canonical multi-entity graph edges for investment landscape traversal (investors, startups, founders, rounds).';

-- =============================================================================
-- 5) MATERIALIZED VIEWS FOR FAST LOOKUPS
-- =============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_investor_portfolio_current AS
SELECT
    e.region,
    e.src_id AS investor_id,
    e.dst_id AS startup_id,
    COUNT(*)::INT AS edge_count,
    BOOL_OR(e.edge_type = 'LEADS_ROUND') AS has_lead_edge,
    MAX(e.updated_at) AS last_seen_at
FROM capital_graph_edges e
WHERE e.src_type = 'investor'
  AND e.dst_type = 'startup'
  AND e.valid_to = DATE '9999-12-31'
GROUP BY e.region, e.src_id, e.dst_id
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_investor_portfolio_current
    ON mv_investor_portfolio_current(region, investor_id, startup_id);

CREATE INDEX IF NOT EXISTS idx_mv_investor_portfolio_lookup
    ON mv_investor_portfolio_current(investor_id, region);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_startup_investors_current AS
SELECT
    e.region,
    e.dst_id AS startup_id,
    e.src_id AS investor_id,
    COUNT(*)::INT AS edge_count,
    BOOL_OR(e.edge_type = 'LEADS_ROUND') AS has_lead_edge,
    MAX(e.updated_at) AS last_seen_at
FROM capital_graph_edges e
WHERE e.src_type = 'investor'
  AND e.dst_type = 'startup'
  AND e.valid_to = DATE '9999-12-31'
GROUP BY e.region, e.dst_id, e.src_id
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_startup_investors_current
    ON mv_startup_investors_current(region, startup_id, investor_id);

CREATE INDEX IF NOT EXISTS idx_mv_startup_investors_lookup
    ON mv_startup_investors_current(startup_id, region);

CREATE OR REPLACE FUNCTION refresh_capital_graph_views()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW mv_investor_portfolio_current;
    REFRESH MATERIALIZED VIEW mv_startup_investors_current;
END;
$$;

-- =============================================================================
-- 6) UPDATED_AT TRIGGERS (if shared trigger function exists)
-- =============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
        DROP TRIGGER IF EXISTS update_founders_updated_at ON founders;
        CREATE TRIGGER update_founders_updated_at
            BEFORE UPDATE ON founders
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

        DROP TRIGGER IF EXISTS update_startup_founders_updated_at ON startup_founders;
        CREATE TRIGGER update_startup_founders_updated_at
            BEFORE UPDATE ON startup_founders
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

        DROP TRIGGER IF EXISTS update_capital_graph_edges_updated_at ON capital_graph_edges;
        CREATE TRIGGER update_capital_graph_edges_updated_at
            BEFORE UPDATE ON capital_graph_edges
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- Populate materialized views with existing data.
SELECT refresh_capital_graph_views();
