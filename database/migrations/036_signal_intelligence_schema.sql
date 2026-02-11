-- Migration 036: Signal Intelligence Engine — Core Schema
--
-- Creates the foundation for the Signal Intelligence Engine:
--   1. event_registry — canonical event type definitions (5 domains, 32 types)
--   2. Extend startup_events — add structured fields for signal extraction
--   3. pattern_registry — authoritative pattern definitions with aliases/keywords
--   4. signals — statistical claims with lifecycle scoring + pgvector embedding
--   5. signal_evidence — links signals to events/clusters with weight
--
-- All changes to startup_events are additive (nullable/defaulted columns),
-- preserving backward compatibility with event_processor.py.

-- =============================================================================
-- 1. EVENT REGISTRY — Canonical event type definitions
-- =============================================================================

CREATE TABLE IF NOT EXISTS event_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain TEXT NOT NULL CHECK (domain IN (
        'architecture', 'gtm', 'capital', 'org', 'product'
    )),
    event_type TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,
    extraction_method TEXT NOT NULL DEFAULT 'heuristic'
        CHECK (extraction_method IN ('heuristic', 'llm', 'hybrid')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE event_registry IS
    'Canonical event type definitions. 5 domains × ~5-10 types each. Used by event_extractor.py for structured event extraction from news clusters.';

-- =============================================================================
-- 2. EXTEND STARTUP_EVENTS — Add structured fields for signal extraction
-- =============================================================================
-- All columns are nullable or have defaults → backward-compatible with
-- existing event_processor.py that writes event_type='website_change' etc.

ALTER TABLE startup_events
    ADD COLUMN IF NOT EXISTS event_registry_id UUID REFERENCES event_registry(id),
    ADD COLUMN IF NOT EXISTS confidence NUMERIC(3,2),
    ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'news'
        CHECK (source_type IN ('news', 'crawl_diff', 'blog', 'social', 'manual')),
    ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS cluster_id UUID REFERENCES news_clusters(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT 'global'
        CHECK (region IN ('global', 'turkey'));

CREATE INDEX IF NOT EXISTS idx_startup_events_registry
    ON startup_events(event_registry_id) WHERE event_registry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_startup_events_cluster
    ON startup_events(cluster_id) WHERE cluster_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_startup_events_region_type
    ON startup_events(region, event_type, detected_at DESC);

-- =============================================================================
-- 3. PATTERN REGISTRY — Authoritative pattern definitions
-- =============================================================================
-- Separate from news_pattern_library (which tracks mention counts from news).
-- This is the canonical source for pattern names, aliases, and keywords.

CREATE TABLE IF NOT EXISTS pattern_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain TEXT NOT NULL CHECK (domain IN ('architecture', 'gtm')),
    cluster_name TEXT NOT NULL,
    pattern_name TEXT NOT NULL,
    aliases TEXT[] NOT NULL DEFAULT '{}',
    keywords TEXT[] NOT NULL DEFAULT '{}',
    category TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'deprecated', 'merged')),
    merged_into_id UUID REFERENCES pattern_registry(id),
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_pattern_registry_name UNIQUE (domain, pattern_name)
);

CREATE INDEX IF NOT EXISTS idx_pattern_registry_active
    ON pattern_registry(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_pattern_registry_domain
    ON pattern_registry(domain, cluster_name);

ALTER TABLE pattern_registry
    ADD CONSTRAINT chk_no_unknown_label CHECK (pattern_name <> 'unknown');

COMMENT ON TABLE pattern_registry IS
    'Authoritative pattern definitions. 20 architecture patterns (from _PATTERN_KEYWORDS) + 6 GTM parent categories (from _GTM_PARENT). Linked by name to news_pattern_library for mention counts.';

-- =============================================================================
-- 4. SIGNALS — Statistical claims with lifecycle scoring
-- =============================================================================

CREATE TABLE IF NOT EXISTS signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Classification
    domain TEXT NOT NULL,
    cluster_name TEXT,
    pattern_id UUID REFERENCES pattern_registry(id),
    claim TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT 'global'
        CHECK (region IN ('global', 'turkey')),

    -- Scoring (all 0-1 except adoption_velocity which is unbounded)
    conviction NUMERIC(5,4) NOT NULL DEFAULT 0,
    momentum NUMERIC(5,4) NOT NULL DEFAULT 0,
    impact NUMERIC(5,4) NOT NULL DEFAULT 0,
    adoption_velocity NUMERIC(8,4) NOT NULL DEFAULT 0,

    -- Lifecycle
    status TEXT NOT NULL DEFAULT 'candidate'
        CHECK (status IN (
            'candidate', 'emerging', 'accelerating', 'established', 'decaying'
        )),

    -- Evidence tracking
    evidence_count INTEGER NOT NULL DEFAULT 0,
    unique_company_count INTEGER NOT NULL DEFAULT 0,

    -- Temporal
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_evidence_at TIMESTAMPTZ,
    last_scored_at TIMESTAMPTZ,

    -- Embedding for merge detection (same config as news_clusters)
    embedding vector(1536),
    embedded_at TIMESTAMPTZ,

    -- Metadata (lifecycle transitions, scoring history, etc.)
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signals_status_region
    ON signals(region, status, conviction DESC);
CREATE INDEX IF NOT EXISTS idx_signals_domain
    ON signals(domain, status);
CREATE INDEX IF NOT EXISTS idx_signals_momentum
    ON signals(region, momentum DESC) WHERE status IN ('emerging', 'accelerating');
CREATE INDEX IF NOT EXISTS idx_signals_pattern
    ON signals(pattern_id) WHERE pattern_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signals_embedding
    ON signals USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

COMMENT ON TABLE signals IS
    'Statistical claims about pattern adoption acceleration. Lifecycle-managed (candidate → emerging → accelerating → established → decaying) with vector-based merge detection via pgvector.';

-- =============================================================================
-- 5. SIGNAL EVIDENCE — Links signals to events/clusters
-- =============================================================================

CREATE TABLE IF NOT EXISTS signal_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
    event_id UUID REFERENCES startup_events(id) ON DELETE SET NULL,
    cluster_id UUID REFERENCES news_clusters(id) ON DELETE SET NULL,
    startup_id UUID REFERENCES startups(id) ON DELETE SET NULL,
    weight NUMERIC(5,4) NOT NULL DEFAULT 1.0,
    evidence_type TEXT NOT NULL DEFAULT 'event'
        CHECK (evidence_type IN ('event', 'cluster', 'crawl_diff', 'manual')),
    snippet TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_evidence_source CHECK (
        event_id IS NOT NULL OR cluster_id IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_signal_evidence_signal
    ON signal_evidence(signal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_evidence_event
    ON signal_evidence(event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signal_evidence_cluster
    ON signal_evidence(cluster_id) WHERE cluster_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signal_evidence_startup
    ON signal_evidence(startup_id) WHERE startup_id IS NOT NULL;

COMMENT ON TABLE signal_evidence IS
    'Links signals to their supporting events/clusters with relevance weight. A signal''s conviction increases as evidence accumulates from diverse sources.';
