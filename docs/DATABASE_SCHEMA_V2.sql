-- =====================================================
-- AI STARTUPS PLATFORM - DATABASE SCHEMA V2
-- Fresh design with Deep Research as core feature
-- =====================================================

-- Drop existing tables if starting fresh
-- DROP SCHEMA public CASCADE; CREATE SCHEMA public;

-- =====================================================
-- 1. CORE ENTITIES
-- =====================================================

CREATE TABLE startups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ===== IDENTITY =====
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    website VARCHAR(500),
    logo_url TEXT,

    -- ===== DESCRIPTION =====
    tagline VARCHAR(500),
    description TEXT,

    -- ===== CLASSIFICATION =====
    vertical VARCHAR(100),           -- 'Healthcare', 'Finance', 'Developer Tools'
    sub_vertical VARCHAR(255),
    sector VARCHAR(100),             -- Legacy field
    market_type VARCHAR(50),         -- 'horizontal', 'vertical'
    target_market VARCHAR(50),       -- 'b2b', 'b2c', 'b2b2c'

    -- ===== LOCATION =====
    city VARCHAR(255),
    country VARCHAR(255),
    continent VARCHAR(100),

    -- ===== FUNDING =====
    funding_stage VARCHAR(50),       -- 'seed', 'series_a', 'series_b', etc.
    total_funding_usd BIGINT DEFAULT 0,
    last_funding_date DATE,

    -- ===== EXTERNAL LINKS =====
    crunchbase_url VARCHAR(500),
    linkedin_url VARCHAR(500),
    twitter_url VARCHAR(500),
    github_url VARCHAR(500),

    -- ===== GENAI CLASSIFICATION (latest) =====
    uses_genai BOOLEAN DEFAULT FALSE,
    genai_intensity VARCHAR(50),     -- 'core', 'enhancement', 'tooling', 'none'

    -- ===== SEARCH =====
    search_vector TSVECTOR,

    -- ===== METADATA =====
    founded_year INTEGER,
    employee_count VARCHAR(50),      -- '1-10', '11-50', '51-200', etc.
    is_active BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_startups_slug ON startups(slug);
CREATE INDEX idx_startups_vertical ON startups(vertical);
CREATE INDEX idx_startups_country ON startups(country);
CREATE INDEX idx_startups_funding ON startups(total_funding_usd DESC);
CREATE INDEX idx_startups_genai ON startups(uses_genai, genai_intensity);
CREATE INDEX idx_startups_search ON startups USING GIN(search_vector);

-- =====================================================
-- 2. INVESTORS
-- =====================================================

CREATE TABLE investors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    type VARCHAR(50),                -- 'vc', 'angel', 'corporate', 'accelerator'
    website VARCHAR(500),
    logo_url TEXT,
    description TEXT,

    -- Location
    city VARCHAR(255),
    country VARCHAR(255),

    -- Stats (computed)
    total_investments INTEGER DEFAULT 0,
    total_invested_usd BIGINT DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_investors_slug ON investors(slug);

-- =====================================================
-- 3. FUNDING ROUNDS
-- =====================================================

CREATE TABLE funding_rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,

    round_type VARCHAR(50),          -- 'pre_seed', 'seed', 'series_a', etc.
    amount_usd BIGINT,
    valuation_usd BIGINT,
    announced_date DATE,

    lead_investor_id UUID REFERENCES investors(id),

    source_url VARCHAR(500),
    source_name VARCHAR(255),

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rounds_startup ON funding_rounds(startup_id);
CREATE INDEX idx_rounds_date ON funding_rounds(announced_date DESC);

-- Round participants (many-to-many)
CREATE TABLE round_investors (
    round_id UUID NOT NULL REFERENCES funding_rounds(id) ON DELETE CASCADE,
    investor_id UUID NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
    is_lead BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (round_id, investor_id)
);

-- =====================================================
-- 4. DEEP RESEARCH - Core Tables
-- =====================================================

-- Research Sessions: A single deep research run on a startup
CREATE TABLE research_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,

    -- ===== SESSION INFO =====
    session_type VARCHAR(50) NOT NULL,  -- 'full', 'update', 'competitive', 'technical'
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed'

    -- ===== CONFIGURATION =====
    research_depth VARCHAR(50) DEFAULT 'standard', -- 'quick', 'standard', 'deep'
    focus_areas TEXT[],              -- ['technical', 'competitive', 'market', 'team']

    -- ===== TIMING =====
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_seconds INTEGER,

    -- ===== SOURCES USED =====
    sources_queried INTEGER DEFAULT 0,
    sources_successful INTEGER DEFAULT 0,
    total_content_chars INTEGER DEFAULT 0,

    -- ===== LLM USAGE =====
    total_llm_calls INTEGER DEFAULT 0,
    total_tokens_used INTEGER DEFAULT 0,
    total_cost_usd DECIMAL(10,4) DEFAULT 0,

    -- ===== ERROR TRACKING =====
    error_message TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_research_sessions_startup ON research_sessions(startup_id);
CREATE INDEX idx_research_sessions_status ON research_sessions(status);
CREATE INDEX idx_research_sessions_created ON research_sessions(created_at DESC);

-- =====================================================
-- 5. RESEARCH SOURCES - What was crawled/queried
-- =====================================================

CREATE TABLE research_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,

    -- ===== SOURCE INFO =====
    source_type VARCHAR(50) NOT NULL, -- 'website', 'docs', 'blog', 'github', 'news', 'social', 'api'
    url TEXT NOT NULL,
    title VARCHAR(500),

    -- ===== CONTENT =====
    content_chars INTEGER,
    content_hash VARCHAR(64),        -- For deduplication

    -- ===== QUALITY =====
    relevance_score DECIMAL(3,2),    -- 0.00 to 1.00
    is_primary_source BOOLEAN DEFAULT FALSE,

    -- ===== TIMING =====
    fetched_at TIMESTAMPTZ,
    fetch_duration_ms INTEGER,

    -- ===== STATUS =====
    status VARCHAR(50) DEFAULT 'success', -- 'success', 'failed', 'blocked', 'timeout'
    error_message TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sources_session ON research_sources(session_id);
CREATE INDEX idx_sources_type ON research_sources(source_type);

-- =====================================================
-- 6. RESEARCH FINDINGS - Structured outputs
-- =====================================================

CREATE TABLE research_findings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,

    -- ===== FINDING CATEGORY =====
    category VARCHAR(100) NOT NULL,  -- 'company_overview', 'technology', 'market',
                                     -- 'competitive', 'team', 'funding', 'traction', 'risks'
    subcategory VARCHAR(100),        -- More specific classification

    -- ===== CONTENT =====
    title VARCHAR(500),
    summary TEXT,                    -- Short summary
    detail TEXT,                     -- Full finding

    -- ===== STRUCTURED DATA (JSONB for flexibility) =====
    data JSONB DEFAULT '{}'::jsonb,  -- Category-specific structured data

    -- ===== CONFIDENCE =====
    confidence_score DECIMAL(3,2),   -- 0.00 to 1.00
    evidence_strength VARCHAR(50),   -- 'strong', 'moderate', 'weak', 'speculative'

    -- ===== CITATIONS =====
    source_ids UUID[],               -- References to research_sources
    citations JSONB,                 -- [{url, title, quote, relevance}]

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_findings_session ON research_findings(session_id);
CREATE INDEX idx_findings_startup ON research_findings(startup_id);
CREATE INDEX idx_findings_category ON research_findings(category);
CREATE INDEX idx_findings_data ON research_findings USING GIN(data);

-- =====================================================
-- 7. RESEARCH ANALYSES - LLM-generated analyses
-- =====================================================

CREATE TABLE research_analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,

    -- ===== ANALYSIS TYPE =====
    analysis_type VARCHAR(100) NOT NULL, -- 'genai_classification', 'pattern_detection',
                                         -- 'competitive_analysis', 'technical_assessment',
                                         -- 'market_positioning', 'risk_assessment'

    -- ===== OUTPUT =====
    summary TEXT,                    -- Human-readable summary
    output JSONB NOT NULL,           -- Full structured output

    -- ===== MODELS DETECTED (for genai analysis) =====
    models_mentioned TEXT[],
    patterns_detected TEXT[],

    -- ===== SCORES =====
    scores JSONB,                    -- {technical_depth: 0.8, innovation: 0.7, ...}

    -- ===== LLM INFO =====
    llm_provider VARCHAR(50),
    llm_model VARCHAR(100),
    prompt_version VARCHAR(20),
    tokens_used INTEGER,

    -- ===== QUALITY =====
    confidence_score DECIMAL(3,2),

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_analyses_session ON research_analyses(session_id);
CREATE INDEX idx_analyses_startup ON research_analyses(startup_id);
CREATE INDEX idx_analyses_type ON research_analyses(analysis_type);
CREATE INDEX idx_analyses_output ON research_analyses USING GIN(output);

-- =====================================================
-- 8. STARTUP SNAPSHOTS - Point-in-time state
-- =====================================================

-- Captures the full state of a startup at a point in time
CREATE TABLE startup_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    session_id UUID REFERENCES research_sessions(id) ON DELETE SET NULL,

    period VARCHAR(7) NOT NULL,      -- '2026-01' for monthly snapshots

    -- ===== GENAI CLASSIFICATION =====
    uses_genai BOOLEAN,
    genai_intensity VARCHAR(50),
    genai_confidence DECIMAL(3,2),
    models_mentioned TEXT[],

    -- ===== BUILD PATTERNS =====
    build_patterns JSONB,            -- [{name, confidence, evidence}]

    -- ===== TECH STACK =====
    tech_stack JSONB,                -- {llm_providers, frameworks, databases, ...}

    -- ===== COMPETITIVE POSITION =====
    competitive_analysis JSONB,      -- {moat, differentiators, competitors}

    -- ===== MARKET =====
    market_analysis JSONB,           -- {tam, positioning, trends}

    -- ===== FUNDING STATE =====
    funding_stage VARCHAR(50),
    total_funding_usd BIGINT,

    -- ===== SCORES =====
    technical_depth_score DECIMAL(3,2),
    innovation_score DECIMAL(3,2),
    market_fit_score DECIMAL(3,2),

    -- ===== BRIEF =====
    brief_markdown TEXT,
    brief_html TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(startup_id, period)
);

CREATE INDEX idx_snapshots_startup ON startup_snapshots(startup_id);
CREATE INDEX idx_snapshots_period ON startup_snapshots(period);

-- =====================================================
-- 9. LLM CALL LOG - All LLM interactions
-- =====================================================

CREATE TABLE llm_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES research_sessions(id) ON DELETE SET NULL,
    startup_id UUID REFERENCES startups(id) ON DELETE SET NULL,

    -- ===== CALL INFO =====
    call_type VARCHAR(100),          -- 'research', 'analysis', 'synthesis', 'brief'
    purpose VARCHAR(255),            -- Human-readable purpose

    -- ===== LLM =====
    provider VARCHAR(50),            -- 'azure_openai', 'anthropic', 'openai'
    model VARCHAR(100),

    -- ===== TOKENS =====
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,

    -- ===== COST =====
    cost_usd DECIMAL(10,6),

    -- ===== TIMING =====
    latency_ms INTEGER,

    -- ===== STATUS =====
    status VARCHAR(50),              -- 'success', 'error', 'timeout', 'rate_limited'
    error_message TEXT,

    -- ===== DEBUG (optional) =====
    prompt_hash VARCHAR(64),         -- For caching/deduplication
    request_payload JSONB,
    response_payload JSONB,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_llm_calls_session ON llm_calls(session_id);
CREATE INDEX idx_llm_calls_startup ON llm_calls(startup_id);
CREATE INDEX idx_llm_calls_created ON llm_calls(created_at DESC);
CREATE INDEX idx_llm_calls_model ON llm_calls(provider, model);

-- =====================================================
-- 10. REFERENCE TABLES
-- =====================================================

-- Build patterns catalog
CREATE TABLE build_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) UNIQUE NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    category VARCHAR(100),           -- 'architecture', 'data', 'security', 'infrastructure'
    description TEXT,
    detection_signals TEXT[],        -- Keywords/signals to detect this pattern
    examples TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed patterns
INSERT INTO build_patterns (name, slug, category, description) VALUES
    ('Agentic Architectures', 'agentic-architectures', 'architecture', 'Autonomous agents with tool use and multi-step reasoning'),
    ('Vertical Data Moats', 'vertical-data-moats', 'data', 'Industry-specific proprietary datasets'),
    ('RAG Pipelines', 'rag-pipelines', 'architecture', 'Retrieval-augmented generation for knowledge grounding'),
    ('Micro-model Meshes', 'micro-model-meshes', 'architecture', 'Multiple specialized small models orchestrated together'),
    ('Continuous Learning Flywheels', 'continuous-learning', 'data', 'Usage data continuously improving models'),
    ('Guardrail Systems', 'guardrail-systems', 'security', 'Secondary models for output validation and safety'),
    ('Knowledge Graphs', 'knowledge-graphs', 'data', 'Structured entity relationships for reasoning'),
    ('NL-to-Code Generation', 'nl-to-code', 'architecture', 'Natural language to executable code conversion'),
    ('Multi-modal Fusion', 'multi-modal', 'architecture', 'Combining text, image, audio, video understanding'),
    ('Fine-tuned Foundation Models', 'fine-tuned-models', 'architecture', 'Custom fine-tuned versions of base models')
ON CONFLICT (slug) DO NOTHING;

-- Verticals catalog
CREATE TABLE verticals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) UNIQUE NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    parent_vertical VARCHAR(255),
    description TEXT,
    keywords TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 11. AGGREGATIONS - Pre-computed for dashboards
-- =====================================================

CREATE TABLE dashboard_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period VARCHAR(7) NOT NULL,      -- '2026-01'
    metric_type VARCHAR(100) NOT NULL, -- 'overview', 'vertical', 'pattern', 'model', 'geo'

    -- ===== AGGREGATED DATA =====
    data JSONB NOT NULL,

    -- ===== COUNTS =====
    startup_count INTEGER,
    total_funding_usd BIGINT,

    computed_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(period, metric_type)
);

CREATE INDEX idx_metrics_period ON dashboard_metrics(period);

-- =====================================================
-- 12. USERS & SUBSCRIPTIONS
-- =====================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ===== AUTH =====
    email VARCHAR(255) UNIQUE NOT NULL,
    google_id VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255),      -- For email/password auth

    -- ===== PROFILE =====
    name VARCHAR(255),
    avatar_url TEXT,

    -- ===== STATUS =====
    email_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,

    -- ===== PREFERENCES =====
    preferences JSONB DEFAULT '{}'::jsonb,

    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_google ON users(google_id);

-- Subscriptions
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- ===== STRIPE =====
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255),

    -- ===== PLAN =====
    plan VARCHAR(50) DEFAULT 'free', -- 'free', 'starter', 'pro', 'enterprise'
    status VARCHAR(50) DEFAULT 'active', -- 'active', 'cancelled', 'past_due', 'trialing'

    -- ===== BILLING =====
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,

    -- ===== USAGE (reset monthly) =====
    research_credits_used INTEGER DEFAULT 0,
    research_credits_limit INTEGER DEFAULT 5,
    exports_used INTEGER DEFAULT 0,
    api_calls_used INTEGER DEFAULT 0,

    usage_reset_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id)
);

-- =====================================================
-- 13. USER ENGAGEMENT
-- =====================================================

-- Saved startups / watchlists
CREATE TABLE saved_startups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    list_name VARCHAR(255) DEFAULT 'Watchlist',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, startup_id, list_name)
);

-- Alerts
CREATE TABLE user_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    alert_type VARCHAR(50),          -- 'startup', 'search', 'pattern'
    target_id UUID,                  -- startup_id or null for search alerts
    search_filters JSONB,            -- For search-based alerts

    events TEXT[],                   -- ['funding', 'research_update', 'news']
    frequency VARCHAR(50) DEFAULT 'instant',

    is_active BOOLEAN DEFAULT TRUE,
    last_triggered_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Activity tracking
CREATE TABLE user_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,

    action VARCHAR(100) NOT NULL,    -- 'view', 'search', 'export', 'research_trigger'
    entity_type VARCHAR(50),
    entity_id UUID,

    metadata JSONB,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activity_user ON user_activity(user_id);
CREATE INDEX idx_activity_created ON user_activity(created_at DESC);

-- =====================================================
-- 14. HELPER FUNCTIONS & TRIGGERS
-- =====================================================

-- Update search vector
CREATE OR REPLACE FUNCTION update_startup_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.name, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.tagline, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.vertical, '')), 'C') ||
        setweight(to_tsvector('english', COALESCE(NEW.city, '')), 'D') ||
        setweight(to_tsvector('english', COALESCE(NEW.country, '')), 'D');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER startup_search_update
    BEFORE INSERT OR UPDATE ON startups
    FOR EACH ROW
    EXECUTE FUNCTION update_startup_search_vector();

-- Update timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER startups_updated_at
    BEFORE UPDATE ON startups
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- =====================================================
-- 15. VIEWS
-- =====================================================

-- Latest snapshot per startup
CREATE OR REPLACE VIEW v_startup_latest AS
SELECT DISTINCT ON (s.id)
    s.*,
    ss.period,
    ss.build_patterns,
    ss.tech_stack,
    ss.competitive_analysis,
    ss.brief_markdown,
    ss.technical_depth_score,
    ss.innovation_score
FROM startups s
LEFT JOIN startup_snapshots ss ON s.id = ss.startup_id
ORDER BY s.id, ss.period DESC;

-- Research status per startup
CREATE OR REPLACE VIEW v_startup_research_status AS
SELECT
    s.id,
    s.name,
    s.slug,
    COUNT(rs.id) as total_research_sessions,
    MAX(rs.completed_at) as last_researched_at,
    MAX(CASE WHEN rs.status = 'completed' THEN rs.created_at END) as last_successful_research
FROM startups s
LEFT JOIN research_sessions rs ON s.id = rs.startup_id
GROUP BY s.id, s.name, s.slug;

-- =====================================================
-- SCHEMA SUMMARY
-- =====================================================
--
-- CORE ENTITIES:
--   startups, investors, funding_rounds, round_investors
--
-- DEEP RESEARCH:
--   research_sessions   - Research runs (the main orchestrator)
--   research_sources    - URLs/APIs queried during research
--   research_findings   - Structured findings with citations
--   research_analyses   - LLM-generated analyses
--   startup_snapshots   - Point-in-time state capture
--   llm_calls          - All LLM interactions logged
--
-- REFERENCE:
--   build_patterns, verticals
--
-- AGGREGATIONS:
--   dashboard_metrics   - Pre-computed for fast dashboards
--
-- USERS:
--   users, subscriptions, saved_startups, user_alerts, user_activity
--
-- =====================================================
