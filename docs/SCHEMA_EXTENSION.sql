-- =====================================================
-- AI STARTUPS PLATFORM - SCHEMA EXTENSION
-- Extends existing schema with LLM analysis storage
-- =====================================================

-- =====================================================
-- 1. EXTEND STARTUPS TABLE (add columns to existing)
-- =====================================================

ALTER TABLE startups ADD COLUMN IF NOT EXISTS
    vertical VARCHAR(100);

ALTER TABLE startups ADD COLUMN IF NOT EXISTS
    sub_vertical VARCHAR(255);

ALTER TABLE startups ADD COLUMN IF NOT EXISTS
    market_type VARCHAR(50); -- 'horizontal', 'vertical'

ALTER TABLE startups ADD COLUMN IF NOT EXISTS
    target_market VARCHAR(50); -- 'b2b', 'b2c', 'b2b2c'

ALTER TABLE startups ADD COLUMN IF NOT EXISTS
    city VARCHAR(255);

ALTER TABLE startups ADD COLUMN IF NOT EXISTS
    country VARCHAR(255);

ALTER TABLE startups ADD COLUMN IF NOT EXISTS
    continent VARCHAR(100);

ALTER TABLE startups ADD COLUMN IF NOT EXISTS
    crunchbase_url VARCHAR(500);

ALTER TABLE startups ADD COLUMN IF NOT EXISTS
    github_url VARCHAR(500);

ALTER TABLE startups ADD COLUMN IF NOT EXISTS
    total_funding_usd BIGINT DEFAULT 0;

-- Full-text search vector
ALTER TABLE startups ADD COLUMN IF NOT EXISTS
    search_vector TSVECTOR;

CREATE INDEX IF NOT EXISTS idx_startups_search
    ON startups USING GIN(search_vector);

CREATE INDEX IF NOT EXISTS idx_startups_vertical
    ON startups(vertical);

CREATE INDEX IF NOT EXISTS idx_startups_country
    ON startups(country);

CREATE INDEX IF NOT EXISTS idx_startups_total_funding
    ON startups(total_funding_usd DESC);

-- =====================================================
-- 2. STARTUP ANALYSES (Monthly LLM Analysis Snapshots)
-- This is the CORE table storing all AI-generated analysis
-- =====================================================

CREATE TABLE IF NOT EXISTS startup_analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    period VARCHAR(7) NOT NULL, -- '2026-01' format

    -- ===== GENAI CLASSIFICATION =====
    uses_genai BOOLEAN DEFAULT FALSE,
    genai_intensity VARCHAR(50), -- 'core', 'enhancement', 'tooling', 'none'
    genai_confidence DECIMAL(3,2), -- 0.00 to 1.00
    models_mentioned TEXT[], -- ['GPT-4', 'Claude', 'Llama']

    -- ===== MARKET CLASSIFICATION =====
    market_type VARCHAR(50), -- 'horizontal', 'vertical'
    vertical VARCHAR(100),
    sub_vertical VARCHAR(255),
    target_market VARCHAR(50), -- 'b2b', 'b2c', 'b2b2c'

    -- ===== TECHNICAL ASSESSMENT =====
    technical_depth VARCHAR(50), -- 'high', 'medium', 'low'

    -- ===== BUILD PATTERNS (JSONB for flexibility) =====
    -- Array of: {name, confidence, description, evidence}
    build_patterns JSONB DEFAULT '[]'::jsonb,

    -- ===== TECH STACK (JSONB) =====
    -- {llm_providers: [], llm_models: [], frameworks: [],
    --  cloud_providers: [], databases: [], approach: '', has_custom_models: bool}
    tech_stack JSONB DEFAULT '{}'::jsonb,

    -- ===== COMPETITIVE ANALYSIS (JSONB) =====
    -- {competitive_moat: '', secret_sauce: {core_advantage, defensibility},
    --  competitors: [{name, similarity, how_different}]}
    competitive_analysis JSONB DEFAULT '{}'::jsonb,

    -- ===== STORY ANGLES (JSONB array) =====
    -- [{angle_type, headline, summary, uniqueness_score}]
    story_angles JSONB DEFAULT '[]'::jsonb,

    -- ===== UNIQUE FINDINGS =====
    unique_findings TEXT[],

    -- ===== ANTI-PATTERNS / WARNINGS =====
    -- [{pattern_type, severity, description}]
    anti_patterns JSONB DEFAULT '[]'::jsonb,

    -- ===== EVIDENCE & SOURCES =====
    evidence_quotes TEXT[],
    source_urls TEXT[],
    pages_crawled INTEGER DEFAULT 0,
    content_analyzed_chars INTEGER DEFAULT 0,

    -- ===== NEWSLETTER POTENTIAL =====
    newsletter_potential VARCHAR(50), -- 'high', 'medium', 'low'

    -- ===== RAW LLM OUTPUTS (for debugging/improvement) =====
    raw_llm_response JSONB, -- Store complete LLM response
    llm_model_used VARCHAR(100), -- 'gpt-4', 'claude-3-opus', etc.
    llm_tokens_used INTEGER,

    -- ===== METADATA =====
    analysis_version VARCHAR(20) DEFAULT '1.0', -- Track analysis algorithm version
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure one analysis per startup per period
    UNIQUE(startup_id, period)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_analyses_startup ON startup_analyses(startup_id);
CREATE INDEX IF NOT EXISTS idx_analyses_period ON startup_analyses(period);
CREATE INDEX IF NOT EXISTS idx_analyses_uses_genai ON startup_analyses(uses_genai);
CREATE INDEX IF NOT EXISTS idx_analyses_genai_intensity ON startup_analyses(genai_intensity);
CREATE INDEX IF NOT EXISTS idx_analyses_vertical ON startup_analyses(vertical);
CREATE INDEX IF NOT EXISTS idx_analyses_newsletter ON startup_analyses(newsletter_potential);

-- GIN indexes for JSONB queries
CREATE INDEX IF NOT EXISTS idx_analyses_patterns ON startup_analyses USING GIN(build_patterns);
CREATE INDEX IF NOT EXISTS idx_analyses_tech_stack ON startup_analyses USING GIN(tech_stack);

-- =====================================================
-- 3. STARTUP BRIEFS (Generated Markdown Reports)
-- =====================================================

CREATE TABLE IF NOT EXISTS startup_briefs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    period VARCHAR(7) NOT NULL, -- '2026-01'

    -- ===== BRIEF CONTENT =====
    title VARCHAR(500),
    brief_markdown TEXT NOT NULL, -- Full markdown content
    brief_html TEXT, -- Pre-rendered HTML (optional, for faster serving)

    -- ===== SECTIONS (for partial updates/queries) =====
    summary_section TEXT,
    genai_section TEXT,
    patterns_section TEXT,
    competitive_section TEXT,
    findings_section TEXT,

    -- ===== METADATA =====
    word_count INTEGER,
    reading_time_minutes INTEGER,

    -- ===== GENERATION INFO =====
    llm_model_used VARCHAR(100),
    llm_tokens_used INTEGER,
    generation_prompt_version VARCHAR(20),

    generated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(startup_id, period)
);

CREATE INDEX IF NOT EXISTS idx_briefs_startup ON startup_briefs(startup_id);
CREATE INDEX IF NOT EXISTS idx_briefs_period ON startup_briefs(period);

-- =====================================================
-- 4. BUILD PATTERNS REFERENCE TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS build_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) UNIQUE NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    category VARCHAR(100), -- 'architecture', 'data', 'security', 'infrastructure'
    description TEXT,
    examples TEXT[],
    detection_keywords TEXT[], -- Keywords used to detect this pattern
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed initial patterns
INSERT INTO build_patterns (name, slug, category, description) VALUES
    ('Agentic Architectures', 'agentic-architectures', 'architecture', 'Autonomous agents with tool use and multi-step reasoning'),
    ('Vertical Data Moats', 'vertical-data-moats', 'data', 'Industry-specific proprietary datasets'),
    ('RAG (Retrieval-Augmented Generation)', 'rag', 'architecture', 'Retrieval-augmented generation pipelines'),
    ('Micro-model Meshes', 'micro-model-meshes', 'architecture', 'Multiple specialized small models'),
    ('Continuous-learning Flywheels', 'continuous-learning', 'data', 'Usage data improving models over time'),
    ('Guardrail-as-LLM', 'guardrail-as-llm', 'security', 'Secondary models for output validation'),
    ('Knowledge Graphs', 'knowledge-graphs', 'data', 'Structured entity relationships'),
    ('Natural-Language-to-Code', 'nl-to-code', 'architecture', 'Converting natural language to executable code')
ON CONFLICT (slug) DO NOTHING;

-- =====================================================
-- 5. MONTHLY REPORTS (Aggregated Statistics)
-- =====================================================

CREATE TABLE IF NOT EXISTS monthly_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period VARCHAR(7) UNIQUE NOT NULL, -- '2026-01'

    -- ===== DEAL SUMMARY =====
    total_deals INTEGER,
    total_funding_usd BIGINT,
    average_deal_size BIGINT,
    median_deal_size BIGINT,
    largest_deal_usd BIGINT,

    -- ===== GENAI STATS =====
    total_analyzed INTEGER,
    genai_adoption_rate DECIMAL(5,2),
    genai_core_count INTEGER,
    genai_enhancement_count INTEGER,

    -- ===== DISTRIBUTIONS (JSONB) =====
    pattern_distribution JSONB, -- {pattern_name: count}
    funding_by_stage JSONB, -- {stage: {count, total_funding}}
    funding_by_continent JSONB, -- {continent: {count, total_funding}}
    funding_by_vertical JSONB, -- {vertical: {count, total_funding}}
    model_usage_distribution JSONB, -- {provider: {count, total_funding}}

    -- ===== TOP LISTS =====
    top_deals JSONB, -- [{startup_id, name, funding, stage}]
    top_investors JSONB, -- [{investor_id, name, deal_count, total_invested}]

    -- ===== NEWSLETTER CONTENT =====
    newsletter_markdown TEXT,
    highlights JSONB, -- Key insights for the month

    generated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 6. CRAWL METADATA (Track Data Sources)
-- =====================================================

CREATE TABLE IF NOT EXISTS crawl_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    period VARCHAR(7) NOT NULL,

    -- ===== CRAWL INFO =====
    urls_crawled TEXT[],
    pages_count INTEGER,
    total_chars INTEGER,

    -- ===== BY SOURCE TYPE =====
    website_urls TEXT[],
    blog_urls TEXT[],
    docs_urls TEXT[],
    github_urls TEXT[],
    news_urls TEXT[],

    -- ===== TIMING =====
    crawl_started_at TIMESTAMPTZ,
    crawl_completed_at TIMESTAMPTZ,
    crawl_duration_seconds INTEGER,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(startup_id, period)
);

CREATE INDEX IF NOT EXISTS idx_crawl_startup ON crawl_metadata(startup_id);
CREATE INDEX IF NOT EXISTS idx_crawl_period ON crawl_metadata(period);

-- =====================================================
-- 7. ANALYSIS HISTORY (Track All LLM Calls)
-- For debugging, cost tracking, and improvement
-- =====================================================

CREATE TABLE IF NOT EXISTS llm_analysis_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID REFERENCES startups(id) ON DELETE SET NULL,

    -- ===== REQUEST INFO =====
    analysis_type VARCHAR(100), -- 'base_analysis', 'viral_analysis', 'brief_generation'
    llm_provider VARCHAR(50), -- 'openai', 'anthropic', 'azure'
    llm_model VARCHAR(100), -- 'gpt-4-turbo', 'claude-3-opus'

    -- ===== PROMPT =====
    prompt_template_version VARCHAR(20),
    prompt_tokens INTEGER,

    -- ===== RESPONSE =====
    completion_tokens INTEGER,
    total_tokens INTEGER,
    response_time_ms INTEGER,

    -- ===== COST =====
    cost_usd DECIMAL(10,6),

    -- ===== STATUS =====
    status VARCHAR(50), -- 'success', 'error', 'timeout'
    error_message TEXT,

    -- ===== RAW DATA (optional, can be large) =====
    request_payload JSONB,
    response_payload JSONB,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_log_startup ON llm_analysis_log(startup_id);
CREATE INDEX IF NOT EXISTS idx_llm_log_type ON llm_analysis_log(analysis_type);
CREATE INDEX IF NOT EXISTS idx_llm_log_created ON llm_analysis_log(created_at DESC);

-- =====================================================
-- 8. USER FEATURES (Extend existing users table)
-- =====================================================

-- Add subscription fields to existing users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS
    google_id VARCHAR(255) UNIQUE;

ALTER TABLE users ADD COLUMN IF NOT EXISTS
    avatar_url TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS
    email_verified BOOLEAN DEFAULT FALSE;

-- Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- ===== STRIPE =====
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255),

    -- ===== PLAN =====
    plan_type VARCHAR(50) NOT NULL DEFAULT 'free', -- 'free', 'basic', 'pro'
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active', 'cancelled', 'past_due'

    -- ===== BILLING PERIOD =====
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,

    -- ===== USAGE TRACKING =====
    briefs_used_this_month INTEGER DEFAULT 0,
    exports_used_this_month INTEGER DEFAULT 0,
    api_calls_this_month INTEGER DEFAULT 0,
    usage_reset_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe ON subscriptions(stripe_customer_id);

-- =====================================================
-- 9. USER ENGAGEMENT TABLES
-- =====================================================

-- Saved startups (lists)
CREATE TABLE IF NOT EXISTS saved_startups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    list_name VARCHAR(255) DEFAULT 'Saved',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, startup_id, list_name)
);

-- Alerts
CREATE TABLE IF NOT EXISTS user_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Alert target (one of these)
    startup_id UUID REFERENCES startups(id) ON DELETE CASCADE,
    investor_id UUID REFERENCES investors(id) ON DELETE CASCADE,
    search_filters JSONB, -- For search-based alerts

    alert_type VARCHAR(50), -- 'startup', 'investor', 'search'
    alert_events TEXT[], -- ['funding', 'news', 'analysis_update']
    frequency VARCHAR(50) DEFAULT 'instant', -- 'instant', 'daily', 'weekly'

    is_active BOOLEAN DEFAULT TRUE,
    last_triggered_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Activity log
CREATE TABLE IF NOT EXISTS user_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,

    action VARCHAR(100) NOT NULL, -- 'view_startup', 'search', 'export', 'save'
    entity_type VARCHAR(50), -- 'startup', 'investor', 'report'
    entity_id UUID,

    metadata JSONB, -- Additional context
    ip_address INET,
    user_agent TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_user ON user_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON user_activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_action ON user_activity(action);

-- =====================================================
-- 10. HELPER FUNCTIONS
-- =====================================================

-- Update search vector when startup changes
CREATE OR REPLACE FUNCTION update_startup_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.name, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.sector, '')), 'C') ||
        setweight(to_tsvector('english', COALESCE(NEW.vertical, '')), 'C') ||
        setweight(to_tsvector('english', COALESCE(NEW.city, '')), 'D');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger if not exists
DROP TRIGGER IF EXISTS startup_search_update ON startups;
CREATE TRIGGER startup_search_update
    BEFORE INSERT OR UPDATE ON startups
    FOR EACH ROW
    EXECUTE FUNCTION update_startup_search_vector();

-- =====================================================
-- 11. VIEWS FOR COMMON QUERIES
-- =====================================================

-- Current startup analysis (latest period)
CREATE OR REPLACE VIEW v_startup_current_analysis AS
SELECT DISTINCT ON (s.id)
    s.*,
    sa.period,
    sa.uses_genai,
    sa.genai_intensity,
    sa.build_patterns,
    sa.tech_stack,
    sa.competitive_analysis,
    sa.newsletter_potential,
    sa.technical_depth
FROM startups s
LEFT JOIN startup_analyses sa ON s.id = sa.startup_id
ORDER BY s.id, sa.period DESC;

-- Startup with latest brief
CREATE OR REPLACE VIEW v_startup_with_brief AS
SELECT DISTINCT ON (s.id)
    s.id,
    s.name,
    s.slug,
    sb.brief_markdown,
    sb.period as brief_period
FROM startups s
LEFT JOIN startup_briefs sb ON s.id = sb.startup_id
ORDER BY s.id, sb.period DESC;

-- =====================================================
-- DONE! Summary of new tables:
--
-- 1. startup_analyses    - Monthly LLM analysis snapshots
-- 2. startup_briefs      - Generated markdown reports
-- 3. build_patterns      - Reference table for patterns
-- 4. monthly_reports     - Aggregated monthly statistics
-- 5. crawl_metadata      - Track data sources per startup
-- 6. llm_analysis_log    - All LLM calls for debugging
-- 7. subscriptions       - User subscription management
-- 8. saved_startups      - User saved lists
-- 9. user_alerts         - User alert preferences
-- 10. user_activity      - User action tracking
-- =====================================================
