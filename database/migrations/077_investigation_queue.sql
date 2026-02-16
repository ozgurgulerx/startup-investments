-- Investigation queue for paid headline seeds that failed open-web corroboration.
--
-- Pipeline:
--   paid_headline_seeds (status='failed') → LLM triage → investigation_queue
--   → DuckDuckGo research + LLM synthesis → quality gate → news_clusters (story_type='investigation')
--
-- Seeds scoring ≥2 on AI-relevance triage get deep-researched from public sources
-- and surfaced as "Signal Watch" cards in the news feed.

CREATE TABLE IF NOT EXISTS investigation_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seed_id UUID NOT NULL REFERENCES paid_headline_seeds(id) ON DELETE CASCADE,
    publisher_key TEXT NOT NULL,
    headline_title TEXT NOT NULL,
    headline_url TEXT NOT NULL,
    -- LLM triage results
    triage_score INTEGER DEFAULT 0,        -- 0=irrelevant, 1=maybe, 2=relevant, 3=high-priority
    triage_reason TEXT,
    -- Extracted context
    entities TEXT[] DEFAULT '{}',
    topic_tags TEXT[] DEFAULT '{}',
    -- Status
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','processing','completed','failed','insufficient','promoted')),
    priority INTEGER NOT NULL DEFAULT 5,
    -- Research results
    search_queries TEXT[] DEFAULT '{}',
    search_results JSONB,
    investigation_output JSONB,
    entity_context JSONB,
    social_signals JSONB,
    -- Quality gate
    quality_score NUMERIC(3,2),
    quality_reason TEXT,
    -- Lifecycle
    cluster_id UUID,
    corroboration_checks INTEGER NOT NULL DEFAULT 0,
    last_corroboration_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_investigation_seed UNIQUE (seed_id)
);

CREATE INDEX IF NOT EXISTS idx_investigation_queue_status
    ON investigation_queue (status, priority, created_at);

CREATE INDEX IF NOT EXISTS idx_investigation_queue_cluster
    ON investigation_queue (cluster_id) WHERE cluster_id IS NOT NULL;

-- Traceability column on news_clusters
ALTER TABLE news_clusters ADD COLUMN IF NOT EXISTS investigation_seed_id UUID;
