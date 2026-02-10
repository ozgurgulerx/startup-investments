-- Migration 033: Editorial Feedback Loop
-- Adds admin editorial actions (reject/approve/flag/pin) and auto-generated filtering rules.

-- =============================================================================
-- Table: news_editorial_actions — every admin decision on a cluster
-- =============================================================================

CREATE TABLE IF NOT EXISTS news_editorial_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cluster_id UUID NOT NULL REFERENCES news_clusters(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (action IN ('reject', 'approve', 'flag', 'pin')),
    reason_category TEXT CHECK (reason_category IN (
        'irrelevant_topic', 'not_startup', 'consumer_noise', 'duplicate',
        'low_quality_source', 'spam', 'off_region', 'big_tech_noise',
        'domain_chatter', 'other'
    )),
    reason_text TEXT,
    region TEXT NOT NULL DEFAULT 'global' CHECK (region IN ('global', 'turkey')),
    source_key TEXT,
    topic_tags TEXT[],
    entities TEXT[],
    title_keywords TEXT[],
    system_decision TEXT,
    system_composite_score NUMERIC,
    admin_id TEXT NOT NULL DEFAULT 'admin',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for querying recent actions by region
CREATE INDEX IF NOT EXISTS idx_editorial_actions_region_created
    ON news_editorial_actions (region, created_at DESC);

-- Index for aggregating by source_key (auto-rule generation)
CREATE INDEX IF NOT EXISTS idx_editorial_actions_source_key
    ON news_editorial_actions (source_key, created_at DESC)
    WHERE source_key IS NOT NULL;

-- Index for aggregating by reason_category
CREATE INDEX IF NOT EXISTS idx_editorial_actions_reason
    ON news_editorial_actions (reason_category, created_at DESC)
    WHERE reason_category IS NOT NULL;

-- Prevent duplicate actions on same cluster by same admin
CREATE UNIQUE INDEX IF NOT EXISTS idx_editorial_actions_unique
    ON news_editorial_actions (cluster_id, admin_id, action);

-- =============================================================================
-- Table: news_editorial_rules — active filtering rules (auto or manual)
-- =============================================================================

CREATE TABLE IF NOT EXISTS news_editorial_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_type TEXT NOT NULL CHECK (rule_type IN (
        'keyword_exclude', 'domain_exclude', 'source_downweight',
        'topic_exclude', 'entity_exclude', 'title_pattern_exclude'
    )),
    region TEXT NOT NULL DEFAULT 'global' CHECK (region IN ('global', 'turkey')),
    rule_value TEXT NOT NULL,
    rule_weight NUMERIC DEFAULT 1.0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_auto_generated BOOLEAN NOT NULL DEFAULT false,
    supporting_action_count INT NOT NULL DEFAULT 0,
    sample_action_ids UUID[],
    confidence NUMERIC DEFAULT 0.0 CHECK (confidence >= 0 AND confidence <= 1),
    approved_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes TEXT
);

-- Unique constraint: one active rule per (type, region, value)
CREATE UNIQUE INDEX IF NOT EXISTS idx_editorial_rules_unique
    ON news_editorial_rules (rule_type, region, rule_value)
    WHERE is_active = true;

-- Index for loading active approved rules at pipeline start
CREATE INDEX IF NOT EXISTS idx_editorial_rules_active
    ON news_editorial_rules (is_active, region)
    WHERE is_active = true AND approved_at IS NOT NULL;

-- Index for finding pending suggestions
CREATE INDEX IF NOT EXISTS idx_editorial_rules_pending
    ON news_editorial_rules (is_auto_generated, approved_at)
    WHERE is_auto_generated = true AND approved_at IS NULL;
