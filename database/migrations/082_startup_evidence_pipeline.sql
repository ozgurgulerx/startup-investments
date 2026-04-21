-- 082_startup_evidence_pipeline.sql
-- First-class startup evidence + promotion queue for field-driven onboarding.

-- ---------------------------------------------------------------------------
-- 1) Startup evidence source documents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS startup_source_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    period TEXT,
    run_key TEXT,
    source_url TEXT NOT NULL,
    canonical_url TEXT,
    source_type TEXT NOT NULL DEFAULT 'website',
    page_type TEXT NOT NULL DEFAULT 'unknown',
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    content_hash TEXT,
    snippet TEXT,
    locator_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    extractor_type TEXT NOT NULL DEFAULT 'crawler',
    extractor_version TEXT,
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_startup_source_documents_startup_time
    ON startup_source_documents(startup_id, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_startup_source_documents_startup_type
    ON startup_source_documents(startup_id, source_type, page_type, fetched_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_startup_source_documents_dedupe
    ON startup_source_documents(
        startup_id,
        COALESCE(canonical_url, source_url),
        COALESCE(content_hash, ''),
        COALESCE(extractor_type, 'crawler'),
        COALESCE(period, ''),
        COALESCE(run_key, '')
    );

COMMENT ON TABLE startup_source_documents IS
    'Normalized source documents captured for startup intelligence coverage, extraction, and citation-backed research.';

-- ---------------------------------------------------------------------------
-- 2) Extracted field observations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS startup_field_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    source_document_id UUID REFERENCES startup_source_documents(id) ON DELETE CASCADE,
    period TEXT,
    run_key TEXT,
    field_name TEXT NOT NULL,
    value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    normalized_value TEXT,
    source_url TEXT NOT NULL,
    canonical_url TEXT,
    source_type TEXT NOT NULL DEFAULT 'website',
    page_type TEXT NOT NULL DEFAULT 'unknown',
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    content_hash TEXT,
    snippet TEXT,
    locator_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    extractor_type TEXT NOT NULL DEFAULT 'deterministic',
    extractor_version TEXT,
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_startup_field_observations_startup_field
    ON startup_field_observations(startup_id, field_name, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_startup_field_observations_startup_confidence
    ON startup_field_observations(startup_id, confidence DESC, fetched_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_startup_field_observations_dedupe
    ON startup_field_observations(
        startup_id,
        field_name,
        COALESCE(normalized_value, ''),
        COALESCE(source_url, ''),
        COALESCE(content_hash, ''),
        COALESCE(extractor_type, 'deterministic'),
        COALESCE(period, ''),
        COALESCE(run_key, '')
    );

COMMENT ON TABLE startup_field_observations IS
    'Field-level extracted observations with source provenance for intelligence-page coverage and promotion decisions.';

-- ---------------------------------------------------------------------------
-- 3) Structured startup claims + citations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS startup_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    period TEXT,
    run_key TEXT,
    claim_type TEXT NOT NULL,
    claim_value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    normalized_value TEXT,
    thesis TEXT,
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    contradiction_state TEXT NOT NULL DEFAULT 'none'
        CHECK (contradiction_state IN ('none', 'possible', 'confirmed')),
    source_count INTEGER NOT NULL DEFAULT 0,
    extractor_type TEXT NOT NULL DEFAULT 'deterministic',
    extractor_version TEXT,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_startup_claims_startup_type
    ON startup_claims(startup_id, claim_type, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_startup_claims_dedupe
    ON startup_claims(
        startup_id,
        claim_type,
        COALESCE(normalized_value, ''),
        COALESCE(period, ''),
        COALESCE(run_key, '')
    );

CREATE TABLE IF NOT EXISTS startup_claim_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id UUID NOT NULL REFERENCES startup_claims(id) ON DELETE CASCADE,
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    source_document_id UUID REFERENCES startup_source_documents(id) ON DELETE CASCADE,
    field_observation_id UUID REFERENCES startup_field_observations(id) ON DELETE SET NULL,
    period TEXT,
    run_key TEXT,
    source_url TEXT NOT NULL,
    canonical_url TEXT,
    source_type TEXT NOT NULL DEFAULT 'website',
    page_type TEXT NOT NULL DEFAULT 'unknown',
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    content_hash TEXT,
    snippet TEXT,
    locator_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    extractor_type TEXT NOT NULL DEFAULT 'deterministic',
    extractor_version TEXT,
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_startup_claim_evidence_claim
    ON startup_claim_evidence(claim_id, confidence DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_startup_claim_evidence_startup
    ON startup_claim_evidence(startup_id, created_at DESC);

COMMENT ON TABLE startup_claims IS
    'Consolidated structured claims about startups used by research synthesis and promotion decisions.';

COMMENT ON TABLE startup_claim_evidence IS
    'Citation layer tying startup claims to source documents and field observations.';

-- ---------------------------------------------------------------------------
-- 4) Promotion queue + coverage state
-- ---------------------------------------------------------------------------
ALTER TABLE startups
    ADD COLUMN IF NOT EXISTS required_field_coverage DOUBLE PRECISION NOT NULL DEFAULT 0.0;

ALTER TABLE startups
    ADD COLUMN IF NOT EXISTS required_field_coverage_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_startups_required_field_coverage
    ON startups(dataset_region, period, required_field_coverage DESC);

CREATE TABLE IF NOT EXISTS startup_promotion_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    requested_status TEXT NOT NULL,
    current_status TEXT,
    region TEXT NOT NULL DEFAULT 'global'
        CHECK (region IN ('global', 'turkey')),
    priority INTEGER NOT NULL DEFAULT 5,
    source TEXT NOT NULL DEFAULT 'system',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    reason TEXT,
    period TEXT,
    run_key TEXT,
    coverage_score DOUBLE PRECISION,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    retry_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_startup_promotion_queue_status
    ON startup_promotion_queue(status, priority, queued_at);

CREATE INDEX IF NOT EXISTS idx_startup_promotion_queue_startup
    ON startup_promotion_queue(startup_id, queued_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_startup_promotion_queue_active
    ON startup_promotion_queue(startup_id, requested_status)
    WHERE status IN ('pending', 'processing');

COMMENT ON TABLE startup_promotion_queue IS
    'Reusable promotion worker queue shared by monthly onboarding and live news-driven onboarding.';
