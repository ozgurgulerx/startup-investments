-- 032_topic_research.sql
-- Hot topic research queue and cluster research context.
-- Enables async web-search enrichment of newsworthy clusters.

-- Research queue: tracks topics that need deeper web research
CREATE TABLE IF NOT EXISTS news_research_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cluster_id UUID REFERENCES news_clusters(id) ON DELETE CASCADE,
    cluster_key TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT 'global',
    title TEXT NOT NULL,
    entities TEXT[] DEFAULT '{}',
    topic_tags TEXT[] DEFAULT '{}',
    gating_scores JSONB,
    priority INTEGER NOT NULL DEFAULT 5,
    status TEXT NOT NULL DEFAULT 'pending',
    search_queries TEXT[] DEFAULT '{}',
    search_results JSONB,
    research_output JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_research_queue_status
    ON news_research_queue (status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_research_queue_cluster
    ON news_research_queue (cluster_id);

-- Add research_context column to clusters for storing research output
ALTER TABLE news_clusters ADD COLUMN IF NOT EXISTS research_context JSONB;
