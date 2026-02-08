-- Periodic briefs (weekly, monthly) for both global and Turkey regions.
--
-- 1. news_periodic_briefs — stores generated brief content (stats + LLM narrative)
-- 2. Adds digest_frequency to news_email_subscriptions for delivery preferences

-- =========================================================================
-- 1. news_periodic_briefs — weekly/monthly intelligence briefs
-- =========================================================================
CREATE TABLE IF NOT EXISTS news_periodic_briefs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    region TEXT NOT NULL DEFAULT 'global'
        CHECK (region IN ('global', 'turkey')),
    period_type TEXT NOT NULL
        CHECK (period_type IN ('weekly', 'monthly')),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    title TEXT,
    -- Template stats (story counts, funding totals, top entities, etc.)
    stats_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- LLM narrative sections (executive_summary, trend_analysis, builder_lessons, outlook)
    narrative_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Source data references
    top_cluster_ids UUID[] NOT NULL DEFAULT '{}',
    top_entity_names TEXT[] NOT NULL DEFAULT '{}',
    story_count INTEGER NOT NULL DEFAULT 0,
    -- Lifecycle
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'ready', 'sent', 'archived')),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One brief per region + period type + start date
CREATE UNIQUE INDEX IF NOT EXISTS idx_periodic_briefs_unique
    ON news_periodic_briefs(region, period_type, period_start);

CREATE INDEX IF NOT EXISTS idx_periodic_briefs_status
    ON news_periodic_briefs(region, period_type, status, period_start DESC);

COMMENT ON TABLE news_periodic_briefs IS
    'Weekly and monthly intelligence briefs with template stats and LLM narrative sections';

-- =========================================================================
-- 2. Add digest_frequency to email subscriptions
-- =========================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'news_email_subscriptions' AND column_name = 'digest_frequency'
    ) THEN
        ALTER TABLE news_email_subscriptions
            ADD COLUMN digest_frequency TEXT NOT NULL DEFAULT 'daily';
        ALTER TABLE news_email_subscriptions
            ADD CONSTRAINT chk_digest_frequency CHECK (digest_frequency IN ('daily', 'weekly', 'monthly'));
    END IF;
END $$;

-- Note: this migration is idempotent (safe to re-run).
