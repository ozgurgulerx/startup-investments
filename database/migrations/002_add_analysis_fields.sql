-- Migration: Add analysis fields from enriched CSV
-- Run: psql -d startupinvestments -f 002_add_analysis_fields.sql

-- Add new columns to startups table
ALTER TABLE startups ADD COLUMN IF NOT EXISTS transaction_url VARCHAR(500);
ALTER TABLE startups ADD COLUMN IF NOT EXISTS funding_type VARCHAR(100);
ALTER TABLE startups ADD COLUMN IF NOT EXISTS money_raised_usd BIGINT;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS announced_date DATE;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS funding_stage VARCHAR(100);
ALTER TABLE startups ADD COLUMN IF NOT EXISTS num_funding_rounds INTEGER;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS industries TEXT;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS lead_investors TEXT;

-- Analysis fields
ALTER TABLE startups ADD COLUMN IF NOT EXISTS genai_intensity VARCHAR(50);
ALTER TABLE startups ADD COLUMN IF NOT EXISTS models_mentioned TEXT;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS build_patterns TEXT;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS market_type VARCHAR(100);
ALTER TABLE startups ADD COLUMN IF NOT EXISTS sub_vertical VARCHAR(200);
ALTER TABLE startups ADD COLUMN IF NOT EXISTS target_market VARCHAR(200);
ALTER TABLE startups ADD COLUMN IF NOT EXISTS unique_findings TEXT;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS newsletter_potential VARCHAR(50);
ALTER TABLE startups ADD COLUMN IF NOT EXISTS technical_depth VARCHAR(50);
ALTER TABLE startups ADD COLUMN IF NOT EXISTS confidence_score DECIMAL(5,2);
ALTER TABLE startups ADD COLUMN IF NOT EXISTS content_analyzed_chars INTEGER;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS analysis_timestamp TIMESTAMP WITH TIME ZONE;

-- Brief content
ALTER TABLE startups ADD COLUMN IF NOT EXISTS brief_content TEXT;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS brief_generated_at TIMESTAMP WITH TIME ZONE;

-- Period tracking (for monthly data)
ALTER TABLE startups ADD COLUMN IF NOT EXISTS period VARCHAR(20);

-- Create indexes for new fields
CREATE INDEX IF NOT EXISTS idx_startups_sub_vertical ON startups(sub_vertical);
CREATE INDEX IF NOT EXISTS idx_startups_market_type ON startups(market_type);
CREATE INDEX IF NOT EXISTS idx_startups_announced_date ON startups(announced_date);
CREATE INDEX IF NOT EXISTS idx_startups_period ON startups(period);
CREATE INDEX IF NOT EXISTS idx_startups_confidence ON startups(confidence_score);

-- Update newsletters table to add period
ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS period VARCHAR(20);

-- Create startup_briefs table for versioned briefs
CREATE TABLE IF NOT EXISTS startup_briefs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    period VARCHAR(20),
    UNIQUE(startup_id, version)
);

CREATE INDEX IF NOT EXISTS idx_briefs_startup ON startup_briefs(startup_id);
CREATE INDEX IF NOT EXISTS idx_briefs_period ON startup_briefs(period);

-- Show updated schema
\d startups
