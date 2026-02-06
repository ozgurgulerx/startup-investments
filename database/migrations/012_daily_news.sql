-- Daily startup news ingestion, clustering, ranking, and edition snapshots

CREATE TABLE IF NOT EXISTS news_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('rss', 'api', 'community', 'crawler')),
    base_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    credibility_weight NUMERIC(4,3) NOT NULL DEFAULT 0.500,
    legal_mode TEXT NOT NULL DEFAULT 'headline_snippet',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_sources_active ON news_sources(is_active);

CREATE TABLE IF NOT EXISTS news_items_raw (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES news_sources(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    url TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    title TEXT NOT NULL,
    summary_raw TEXT,
    published_at TIMESTAMPTZ,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    language VARCHAR(12) NOT NULL DEFAULT 'en',
    author TEXT,
    engagement_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_news_items_raw_source_external UNIQUE (source_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_news_items_raw_canonical ON news_items_raw(canonical_url);
CREATE INDEX IF NOT EXISTS idx_news_items_raw_published ON news_items_raw(published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_news_items_raw_fetched ON news_items_raw(fetched_at DESC);

CREATE TABLE IF NOT EXISTS news_clusters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cluster_key TEXT NOT NULL UNIQUE,
    canonical_url TEXT,
    title TEXT NOT NULL,
    summary TEXT,
    published_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    topic_tags TEXT[] NOT NULL DEFAULT '{}',
    entities TEXT[] NOT NULL DEFAULT '{}',
    story_type TEXT NOT NULL DEFAULT 'news',
    source_count INTEGER NOT NULL DEFAULT 1,
    rank_score NUMERIC(8,4) NOT NULL DEFAULT 0,
    rank_reason TEXT,
    trust_score NUMERIC(5,4) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_news_clusters_published ON news_clusters(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_clusters_rank ON news_clusters(rank_score DESC, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_clusters_tags ON news_clusters USING GIN(topic_tags);

CREATE TABLE IF NOT EXISTS news_cluster_items (
    cluster_id UUID NOT NULL REFERENCES news_clusters(id) ON DELETE CASCADE,
    raw_item_id UUID NOT NULL REFERENCES news_items_raw(id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    source_rank NUMERIC(8,4) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (cluster_id, raw_item_id)
);

CREATE INDEX IF NOT EXISTS idx_news_cluster_items_primary ON news_cluster_items(cluster_id, is_primary);

CREATE TABLE IF NOT EXISTS news_daily_editions (
    edition_date DATE PRIMARY KEY,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'ready',
    top_cluster_ids UUID[] NOT NULL DEFAULT '{}',
    stats_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS news_topic_index (
    topic TEXT NOT NULL,
    cluster_id UUID NOT NULL REFERENCES news_clusters(id) ON DELETE CASCADE,
    edition_date DATE NOT NULL,
    rank_score NUMERIC(8,4) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (topic, cluster_id, edition_date)
);

CREATE INDEX IF NOT EXISTS idx_news_topic_index_date_topic ON news_topic_index(edition_date DESC, topic, rank_score DESC);

CREATE TABLE IF NOT EXISTS news_ingestion_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running',
    sources_attempted INTEGER NOT NULL DEFAULT 0,
    items_fetched INTEGER NOT NULL DEFAULT 0,
    items_kept INTEGER NOT NULL DEFAULT 0,
    clusters_built INTEGER NOT NULL DEFAULT 0,
    errors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    stats_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_news_ingestion_runs_started ON news_ingestion_runs(started_at DESC);

COMMENT ON TABLE news_sources IS 'Configurable source registry for daily news ingest';
COMMENT ON TABLE news_items_raw IS 'Raw normalized items collected from RSS/API/community/crawler sources';
COMMENT ON TABLE news_clusters IS 'Deduplicated story clusters with ranking and tags';
COMMENT ON TABLE news_daily_editions IS 'Daily snapshot of ranked top story clusters';
COMMENT ON TABLE news_topic_index IS 'Topic-to-cluster lookup table by daily edition';
COMMENT ON TABLE news_ingestion_runs IS 'Operational telemetry for ingestion runs';
