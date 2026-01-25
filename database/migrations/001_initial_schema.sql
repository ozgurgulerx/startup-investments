-- Initial schema for Startup Investments database
-- Run: psql -d startupinvestments -f 001_initial_schema.sql

-- Note: Using gen_random_uuid() which is built-in since PostgreSQL 13+
-- No extension needed for Azure PostgreSQL Flexible Server

-- Startups table
CREATE TABLE IF NOT EXISTS startups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    website VARCHAR(500),
    founded_date DATE,
    headquarters_city VARCHAR(100),
    headquarters_country VARCHAR(100),
    continent VARCHAR(50),
    industry VARCHAR(100),
    pattern VARCHAR(100),
    stage VARCHAR(50),
    employee_count INTEGER,
    genai_native BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Funding rounds table
CREATE TABLE IF NOT EXISTS funding_rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    round_type VARCHAR(50) NOT NULL,
    amount_usd BIGINT,
    announced_date DATE,
    lead_investor VARCHAR(255),
    valuation_usd BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Investors table
CREATE TABLE IF NOT EXISTS investors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    type VARCHAR(50), -- VC, Angel, Corporate, etc.
    website VARCHAR(500),
    headquarters_country VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Investment junction table
CREATE TABLE IF NOT EXISTS investments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    funding_round_id UUID NOT NULL REFERENCES funding_rounds(id) ON DELETE CASCADE,
    investor_id UUID NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
    is_lead BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(funding_round_id, investor_id)
);

-- Newsletters table (for generated content)
CREATE TABLE IF NOT EXISTS newsletters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'draft',
    published_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_startups_pattern ON startups(pattern);
CREATE INDEX IF NOT EXISTS idx_startups_stage ON startups(stage);
CREATE INDEX IF NOT EXISTS idx_startups_continent ON startups(continent);
CREATE INDEX IF NOT EXISTS idx_startups_genai ON startups(genai_native);
CREATE INDEX IF NOT EXISTS idx_funding_startup ON funding_rounds(startup_id);
CREATE INDEX IF NOT EXISTS idx_funding_date ON funding_rounds(announced_date);
CREATE INDEX IF NOT EXISTS idx_investments_round ON investments(funding_round_id);
CREATE INDEX IF NOT EXISTS idx_investments_investor ON investments(investor_id);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to tables with updated_at
CREATE TRIGGER update_startups_updated_at
    BEFORE UPDATE ON startups
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_newsletters_updated_at
    BEFORE UPDATE ON newsletters
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
