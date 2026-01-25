-- Migration: Add context management tables for tracking, history, and cross-references
-- Run: psql -d startupinvestments -f 003_context_management.sql

-- =============================================================================
-- CRAWL LOGS TABLE
-- Tracks crawl attempts, success rates, and content quality metrics
-- =============================================================================

CREATE TABLE IF NOT EXISTS crawl_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID REFERENCES startups(id) ON DELETE CASCADE,
    source_type VARCHAR(50) NOT NULL,  -- 'website', 'github', 'jobs', 'hackernews', 'deep_research'
    url VARCHAR(1000),

    -- Status tracking
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending', 'success', 'failed', 'partial', 'blocked'
    http_status INTEGER,
    error_message TEXT,

    -- Content metrics
    content_length INTEGER,
    pages_crawled INTEGER DEFAULT 1,
    useful_content_ratio DECIMAL(3,2),  -- 0.00-1.00 (ratio of useful content extracted)

    -- Timing
    crawl_started_at TIMESTAMP WITH TIME ZONE,
    crawl_completed_at TIMESTAMP WITH TIME ZONE,
    duration_ms INTEGER,

    -- Retry tracking
    attempt_number INTEGER DEFAULT 1,
    max_retries INTEGER DEFAULT 3,
    next_retry_at TIMESTAMP WITH TIME ZONE,

    -- Metadata
    user_agent VARCHAR(500),
    proxy_used BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crawl_logs_startup ON crawl_logs(startup_id);
CREATE INDEX IF NOT EXISTS idx_crawl_logs_status ON crawl_logs(status);
CREATE INDEX IF NOT EXISTS idx_crawl_logs_source ON crawl_logs(source_type);
CREATE INDEX IF NOT EXISTS idx_crawl_logs_created ON crawl_logs(created_at);

-- =============================================================================
-- STARTUP SNAPSHOTS TABLE
-- Historical tracking of startup state over time (monthly snapshots)
-- =============================================================================

CREATE TABLE IF NOT EXISTS startup_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    period VARCHAR(20) NOT NULL,  -- '2026-01' format

    -- Point-in-time company data
    employee_count INTEGER,
    funding_total_usd BIGINT,
    latest_round_type VARCHAR(50),
    latest_round_amount_usd BIGINT,
    latest_valuation_usd BIGINT,

    -- Analysis snapshot
    genai_intensity VARCHAR(50),
    build_patterns JSONB,  -- Array of {name, confidence, evidence}
    confidence_score DECIMAL(5,2),
    newsletter_potential VARCHAR(50),
    technical_depth VARCHAR(50),

    -- Market position snapshot
    market_type VARCHAR(50),
    sub_vertical VARCHAR(200),
    target_market VARCHAR(100),

    -- Crawled content tracking
    content_hash VARCHAR(64),  -- SHA256 of crawled content for change detection
    sources_crawled INTEGER DEFAULT 0,
    content_analyzed_chars INTEGER DEFAULT 0,

    -- Computed deltas from previous period
    funding_delta_usd BIGINT,
    employee_delta INTEGER,
    patterns_changed BOOLEAN DEFAULT FALSE,
    confidence_delta DECIMAL(5,2),

    -- Metadata
    snapshot_reason VARCHAR(100),  -- 'monthly_batch', 'funding_event', 'manual'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(startup_id, period)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_startup ON startup_snapshots(startup_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_period ON startup_snapshots(period);
CREATE INDEX IF NOT EXISTS idx_snapshots_created ON startup_snapshots(created_at);

-- =============================================================================
-- INVESTOR-STARTUP LINKS TABLE
-- Tracks relationships between investors and startups across funding rounds
-- =============================================================================

CREATE TABLE IF NOT EXISTS investor_startup_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investor_id UUID NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,

    -- Relationship details
    relationship_type VARCHAR(50) NOT NULL,  -- 'lead', 'participant', 'board', 'advisor'
    first_round VARCHAR(50),  -- First round they participated in
    rounds_participated INTEGER DEFAULT 1,
    total_invested_usd BIGINT,

    -- Timestamps
    first_investment_date DATE,
    last_investment_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(investor_id, startup_id)
);

CREATE INDEX IF NOT EXISTS idx_investor_links_investor ON investor_startup_links(investor_id);
CREATE INDEX IF NOT EXISTS idx_investor_links_startup ON investor_startup_links(startup_id);
CREATE INDEX IF NOT EXISTS idx_investor_links_type ON investor_startup_links(relationship_type);

-- =============================================================================
-- COMPETITOR LINKS TABLE
-- Tracks competitive relationships between startups
-- =============================================================================

CREATE TABLE IF NOT EXISTS competitor_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    competitor_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,

    -- Relationship details
    similarity_score DECIMAL(3,2),  -- 0.00-1.00
    overlap_type VARCHAR(100),  -- 'direct', 'adjacent', 'potential', 'substitute'

    -- Analysis details
    shared_patterns JSONB,  -- Array of shared build patterns
    shared_vertical VARCHAR(200),
    differentiation_notes TEXT,

    -- Metadata
    detected_by VARCHAR(50),  -- 'llm_analysis', 'pattern_match', 'manual'
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(startup_id, competitor_id),
    CHECK (startup_id != competitor_id)
);

CREATE INDEX IF NOT EXISTS idx_competitor_links_startup ON competitor_links(startup_id);
CREATE INDEX IF NOT EXISTS idx_competitor_links_competitor ON competitor_links(competitor_id);
CREATE INDEX IF NOT EXISTS idx_competitor_links_score ON competitor_links(similarity_score);

-- =============================================================================
-- PATTERN CORRELATIONS TABLE
-- Tracks co-occurrence and correlations between build patterns
-- =============================================================================

CREATE TABLE IF NOT EXISTS pattern_correlations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pattern_a VARCHAR(100) NOT NULL,
    pattern_b VARCHAR(100) NOT NULL,

    -- Co-occurrence metrics
    co_occurrence_count INTEGER DEFAULT 0,
    total_startups_with_a INTEGER DEFAULT 0,
    total_startups_with_b INTEGER DEFAULT 0,

    -- Funding correlation
    avg_funding_with_both BIGINT,
    avg_funding_with_a_only BIGINT,
    avg_funding_with_b_only BIGINT,

    -- Correlation strength
    correlation_coefficient DECIMAL(4,3),  -- -1.000 to 1.000
    lift_score DECIMAL(5,2),  -- How much more likely they appear together vs expected

    -- Metadata
    period VARCHAR(20),  -- Period this correlation was computed for
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(pattern_a, pattern_b, period),
    CHECK (pattern_a < pattern_b)  -- Ensure consistent ordering
);

CREATE INDEX IF NOT EXISTS idx_pattern_corr_patterns ON pattern_correlations(pattern_a, pattern_b);
CREATE INDEX IF NOT EXISTS idx_pattern_corr_period ON pattern_correlations(period);

-- =============================================================================
-- DEEP RESEARCH QUEUE TABLE
-- Tracks startups queued for deep research API analysis
-- =============================================================================

CREATE TABLE IF NOT EXISTS deep_research_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,

    -- Queue management
    priority INTEGER DEFAULT 5,  -- 1 (highest) to 10 (lowest)
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending', 'processing', 'completed', 'failed'
    reason VARCHAR(100),  -- 'new_startup', 'funding_event', 'quarterly_refresh', 'manual'

    -- Research configuration
    research_depth VARCHAR(20) DEFAULT 'standard',  -- 'quick', 'standard', 'deep'
    focus_areas JSONB,  -- Array of specific areas to research

    -- Results tracking
    tokens_used INTEGER,
    cost_usd DECIMAL(10,4),
    research_output JSONB,

    -- Timing
    queued_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,

    -- Error handling
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,

    UNIQUE(startup_id, status) -- Only one pending/processing per startup
);

CREATE INDEX IF NOT EXISTS idx_research_queue_startup ON deep_research_queue(startup_id);
CREATE INDEX IF NOT EXISTS idx_research_queue_status ON deep_research_queue(status);
CREATE INDEX IF NOT EXISTS idx_research_queue_priority ON deep_research_queue(priority, queued_at);

-- =============================================================================
-- EVENT LOG TABLE
-- Tracks events that trigger re-analysis (RSS feeds, website changes, etc.)
-- =============================================================================

CREATE TABLE IF NOT EXISTS startup_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID REFERENCES startups(id) ON DELETE CASCADE,

    -- Event details
    event_type VARCHAR(50) NOT NULL,  -- 'funding_news', 'website_change', 'hackernews_mention', 'job_posting'
    event_source VARCHAR(100),  -- 'techcrunch_rss', 'website_monitor', 'algolia_alert'
    event_title TEXT,
    event_url VARCHAR(1000),
    event_content TEXT,

    -- Processing status
    processed BOOLEAN DEFAULT FALSE,
    triggered_reanalysis BOOLEAN DEFAULT FALSE,
    analysis_id UUID,  -- Reference to resulting analysis if triggered

    -- Timestamps
    event_date TIMESTAMP WITH TIME ZONE,
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_events_startup ON startup_events(startup_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON startup_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_processed ON startup_events(processed);
CREATE INDEX IF NOT EXISTS idx_events_date ON startup_events(event_date);

-- =============================================================================
-- ADD CONTENT HASH TO STARTUPS TABLE
-- For tracking website content changes
-- =============================================================================

ALTER TABLE startups ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);
ALTER TABLE startups ADD COLUMN IF NOT EXISTS last_crawl_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS crawl_success_rate DECIMAL(3,2);

-- =============================================================================
-- UPDATED_AT TRIGGERS
-- =============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to investor_startup_links
DROP TRIGGER IF EXISTS update_investor_startup_links_updated_at ON investor_startup_links;
CREATE TRIGGER update_investor_startup_links_updated_at
    BEFORE UPDATE ON investor_startup_links
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Show created tables
\dt crawl_logs
\dt startup_snapshots
\dt investor_startup_links
\dt competitor_links
\dt pattern_correlations
\dt deep_research_queue
\dt startup_events
