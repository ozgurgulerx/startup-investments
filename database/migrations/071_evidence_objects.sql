-- Migration 071: Canonical evidence_objects contract
--
-- Introduces a single evidence contract used across the system:
-- - news_item, news_cluster (news ingest)
-- - page_snapshot, page_diff (crawler)
-- - github_release, job_post (enrichment)
-- - manual (operator/editorial)
--
-- Downstream objects (signals, graphs, narratives) should link back to
-- evidence_objects.evidence_id for traceability.

CREATE TABLE IF NOT EXISTS evidence_objects (
    evidence_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evidence_type TEXT NOT NULL CHECK (evidence_type IN (
        'news_cluster', 'news_item', 'page_snapshot', 'page_diff',
        'github_release', 'job_post', 'manual'
    )),
    uri TEXT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    source_weight NUMERIC(5,4) NOT NULL DEFAULT 0.5000,
    language VARCHAR(12) NOT NULL DEFAULT 'en',
    content_ref TEXT,
    content_text_gzip BYTEA,
    hash TEXT NOT NULL,
    canonicalization_version INTEGER NOT NULL DEFAULT 1,
    provenance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent upsert key: evidence_type + stable hash.
CREATE UNIQUE INDEX IF NOT EXISTS uq_evidence_objects_type_hash
    ON evidence_objects (evidence_type, hash);

CREATE INDEX IF NOT EXISTS idx_evidence_objects_captured_at
    ON evidence_objects (captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_evidence_objects_uri
    ON evidence_objects (uri);

COMMENT ON TABLE evidence_objects IS
    'Canonical evidence envelope. Every derived object should be traceable to evidence_id(s).';

-- Evidence composition/containment, e.g. a news_cluster evidence object contains
-- its member news_item evidence objects (one marked is_primary).
CREATE TABLE IF NOT EXISTS evidence_object_members (
    evidence_id UUID NOT NULL REFERENCES evidence_objects(evidence_id) ON DELETE CASCADE,
    member_evidence_id UUID NOT NULL REFERENCES evidence_objects(evidence_id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (evidence_id, member_evidence_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_object_members_member
    ON evidence_object_members (member_evidence_id);

COMMENT ON TABLE evidence_object_members IS
    'Composition edges between evidence objects (cluster->items, diff->snapshots, etc).';

