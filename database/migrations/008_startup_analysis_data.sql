-- Migration: Add analysis_data JSONB column for full startup analysis storage
-- This enables database-driven queries with filtering and pagination
-- Run: psql -d startupinvestments -f 008_startup_analysis_data.sql

-- Store full analysis data as JSONB (flexible, queryable)
ALTER TABLE startups ADD COLUMN IF NOT EXISTS analysis_data JSONB;

-- Period tracking (e.g., '2026-01')
ALTER TABLE startups ADD COLUMN IF NOT EXISTS period VARCHAR(10);

-- Money raised column for direct filtering (denormalized for performance)
ALTER TABLE startups ADD COLUMN IF NOT EXISTS money_raised_usd BIGINT;

-- Funding stage normalized (seed, series_a, series_b, etc.)
ALTER TABLE startups ADD COLUMN IF NOT EXISTS funding_stage VARCHAR(50);

-- Uses GenAI flag (denormalized for fast filtering)
ALTER TABLE startups ADD COLUMN IF NOT EXISTS uses_genai BOOLEAN DEFAULT FALSE;

-- Indexes for common filters
CREATE INDEX IF NOT EXISTS idx_startups_period ON startups(period);
CREATE INDEX IF NOT EXISTS idx_startups_money_raised ON startups(money_raised_usd DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_startups_funding_stage ON startups(funding_stage);
CREATE INDEX IF NOT EXISTS idx_startups_uses_genai ON startups(uses_genai);

-- GIN index for JSONB pattern searches (enables @> containment queries)
CREATE INDEX IF NOT EXISTS idx_startups_analysis_data ON startups USING GIN (analysis_data);

-- Composite index for common filter combinations
CREATE INDEX IF NOT EXISTS idx_startups_period_stage ON startups(period, funding_stage);
CREATE INDEX IF NOT EXISTS idx_startups_period_genai ON startups(period, uses_genai);

-- Comments for documentation
COMMENT ON COLUMN startups.analysis_data IS 'Full startup analysis JSON including build_patterns, tech_stack, market_type, etc.';
COMMENT ON COLUMN startups.period IS 'Data collection period in YYYY-MM format';
COMMENT ON COLUMN startups.money_raised_usd IS 'Total funding amount in USD (denormalized for query performance)';
COMMENT ON COLUMN startups.funding_stage IS 'Current funding stage: pre_seed, seed, series_a, series_b, series_c, late_stage';
COMMENT ON COLUMN startups.uses_genai IS 'Whether startup uses generative AI (denormalized for fast filtering)';
