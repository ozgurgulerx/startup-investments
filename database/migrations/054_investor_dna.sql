-- Migration 054: Investor DNA Tables
--
-- Monthly investor pattern exposure and co-invest network edges.
-- Enables investor screener, profile pages, and thesis shift analysis.

-- =============================================================================
-- 1. INVESTOR PATTERN MIX — Monthly materialized investor profile
-- =============================================================================

CREATE TABLE IF NOT EXISTS investor_pattern_mix (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope               TEXT NOT NULL DEFAULT 'global',
    month               DATE NOT NULL,
    investor_id         UUID NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
    deal_count          INTEGER NOT NULL DEFAULT 0,
    total_amount_usd    NUMERIC,
    lead_count          INTEGER NOT NULL DEFAULT 0,
    median_check_usd    NUMERIC,
    pattern_deal_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
    pattern_amounts     JSONB NOT NULL DEFAULT '{}'::jsonb,
    stage_deal_counts   JSONB NOT NULL DEFAULT '{}'::jsonb,
    stage_amounts       JSONB NOT NULL DEFAULT '{}'::jsonb,
    thesis_shift_js     NUMERIC(5,4),
    top_gainers         JSONB,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (scope, month, investor_id)
);

CREATE INDEX IF NOT EXISTS idx_investor_pattern_mix_investor
    ON investor_pattern_mix(investor_id);
CREATE INDEX IF NOT EXISTS idx_investor_pattern_mix_lookup
    ON investor_pattern_mix(scope, month);

COMMENT ON TABLE investor_pattern_mix IS
    'Monthly materialized investor pattern exposure — deal counts, amounts, stage mix, pattern mix, thesis shift (Jensen-Shannon divergence).';

-- =============================================================================
-- 2. CO-INVEST EDGES — Monthly materialized co-investment graph
-- =============================================================================

CREATE TABLE IF NOT EXISTS investor_co_invest_edges (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope               TEXT NOT NULL DEFAULT 'global',
    month               DATE NOT NULL,
    investor_id         UUID NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
    partner_investor_id UUID NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
    co_deals            INTEGER NOT NULL DEFAULT 0,
    co_amount_usd       NUMERIC,
    shared_patterns     JSONB,
    UNIQUE (scope, month, investor_id, partner_investor_id)
);

CREATE INDEX IF NOT EXISTS idx_co_invest_edges_investor
    ON investor_co_invest_edges(investor_id, scope, month);
CREATE INDEX IF NOT EXISTS idx_co_invest_edges_partner
    ON investor_co_invest_edges(partner_investor_id);

COMMENT ON TABLE investor_co_invest_edges IS
    'Monthly co-investment edges between investors. For each funding round with 2+ investors, creates edge pairs with co-deal counts and shared patterns.';
