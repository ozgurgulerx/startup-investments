-- Memory-gated editorial intelligence system
--
-- Adds persistent memory layers for the news pipeline:
-- 1. Entity facts — tracks claims about companies/investors with provenance
-- 2. Item extractions — per-cluster structured extraction results
-- 3. Item decisions — routing decisions (publish/watchlist/accumulate/drop)
-- 4. Pattern library — build patterns accumulated from news
-- 5. GTM taxonomy — go-to-market tags with frequency
-- 6. Calibration labels — human feedback for threshold tuning

-- =========================================================================
-- 1. news_entity_facts — persistent memory of entity claims
-- =========================================================================
CREATE TABLE IF NOT EXISTS news_entity_facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_name TEXT NOT NULL,
    entity_type TEXT NOT NULL DEFAULT 'company'
        CHECK (entity_type IN ('company', 'person', 'investor', 'product')),
    linked_startup_id UUID REFERENCES startups(id) ON DELETE SET NULL,
    linked_investor_id UUID REFERENCES investors(id) ON DELETE SET NULL,
    fact_key TEXT NOT NULL,
    fact_value TEXT NOT NULL,
    fact_confidence NUMERIC(3,2) NOT NULL DEFAULT 0.50,
    source_cluster_id UUID REFERENCES news_clusters(id) ON DELETE SET NULL,
    source_url TEXT,
    source_text_span TEXT,
    superseded_by UUID REFERENCES news_entity_facts(id) ON DELETE SET NULL,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    confirmation_count INTEGER NOT NULL DEFAULT 1,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entity_facts_current
    ON news_entity_facts(entity_name, fact_key)
    WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_entity_facts_startup
    ON news_entity_facts(linked_startup_id)
    WHERE is_current = TRUE AND linked_startup_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_entity_facts_investor
    ON news_entity_facts(linked_investor_id)
    WHERE is_current = TRUE AND linked_investor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_entity_facts_cluster
    ON news_entity_facts(source_cluster_id)
    WHERE source_cluster_id IS NOT NULL;

COMMENT ON TABLE news_entity_facts IS
    'Persistent memory of structured entity claims with provenance and lifecycle tracking';

-- =========================================================================
-- 2. news_item_extractions — per-cluster extraction results (1:1)
-- =========================================================================
CREATE TABLE IF NOT EXISTS news_item_extractions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cluster_id UUID NOT NULL UNIQUE REFERENCES news_clusters(id) ON DELETE CASCADE,
    claims_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    linked_entities_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    matched_patterns TEXT[] NOT NULL DEFAULT '{}',
    pattern_novelty_score NUMERIC(3,2),
    gtm_tags TEXT[] NOT NULL DEFAULT '{}',
    delivery_model TEXT,
    extraction_method TEXT NOT NULL DEFAULT 'heuristic'
        CHECK (extraction_method IN ('heuristic', 'llm', 'hybrid')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_item_extractions_patterns
    ON news_item_extractions USING GIN(matched_patterns);

CREATE INDEX IF NOT EXISTS idx_item_extractions_gtm
    ON news_item_extractions USING GIN(gtm_tags);

COMMENT ON TABLE news_item_extractions IS
    'Per-cluster extraction results: entities linked, claims extracted, patterns matched';

-- =========================================================================
-- 3. news_item_decisions — routing decisions per cluster (1:1)
-- =========================================================================
CREATE TABLE IF NOT EXISTS news_item_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cluster_id UUID NOT NULL UNIQUE REFERENCES news_clusters(id) ON DELETE CASCADE,
    score_builder_insight NUMERIC(3,2),
    score_pattern_novelty NUMERIC(3,2),
    score_gtm_uniqueness NUMERIC(3,2),
    score_evidence_quality NUMERIC(3,2),
    score_composite NUMERIC(3,2),
    decision TEXT NOT NULL DEFAULT 'publish'
        CHECK (decision IN ('publish', 'watchlist', 'accumulate', 'drop')),
    decision_reason TEXT,
    contradictions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    has_contradiction BOOLEAN NOT NULL DEFAULT FALSE,
    is_duplicate_of UUID REFERENCES news_clusters(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_item_decisions_decision
    ON news_item_decisions(decision);

CREATE INDEX IF NOT EXISTS idx_item_decisions_composite
    ON news_item_decisions(score_composite DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_item_decisions_contradiction
    ON news_item_decisions(cluster_id)
    WHERE has_contradiction = TRUE;

COMMENT ON TABLE news_item_decisions IS
    'Routing decisions per cluster: publish/watchlist/accumulate/drop with scoring breakdown';

-- =========================================================================
-- 4. news_pattern_library — build patterns accumulated from news
-- =========================================================================
CREATE TABLE IF NOT EXISTS news_pattern_library (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pattern_name TEXT NOT NULL UNIQUE,
    pattern_category TEXT,
    canonical BOOLEAN NOT NULL DEFAULT FALSE,
    mention_count INTEGER NOT NULL DEFAULT 0,
    example_cluster_ids UUID[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE news_pattern_library IS
    'Build patterns accumulated from news with frequency and examples';

-- =========================================================================
-- 5. news_gtm_taxonomy — go-to-market tags with frequency
-- =========================================================================
CREATE TABLE IF NOT EXISTS news_gtm_taxonomy (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag TEXT NOT NULL UNIQUE,
    parent_tag TEXT,
    mention_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE news_gtm_taxonomy IS
    'Go-to-market classification tags with hierarchy and frequency';

-- =========================================================================
-- 6. news_calibration_labels — human feedback for threshold tuning
-- =========================================================================
CREATE TABLE IF NOT EXISTS news_calibration_labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cluster_id UUID NOT NULL REFERENCES news_clusters(id) ON DELETE CASCADE,
    label TEXT NOT NULL
        CHECK (label IN ('publish', 'watchlist', 'accumulate', 'drop')),
    label_source TEXT NOT NULL DEFAULT 'manual'
        CHECK (label_source IN ('manual', 'implicit_click', 'implicit_share')),
    system_decision TEXT,
    system_scores_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calibration_labels_cluster
    ON news_calibration_labels(cluster_id);

CREATE INDEX IF NOT EXISTS idx_calibration_labels_source
    ON news_calibration_labels(label_source, created_at DESC);

COMMENT ON TABLE news_calibration_labels IS
    'Human feedback labels for calibrating memory gate thresholds';

-- Note: this migration is idempotent (safe to re-run).
