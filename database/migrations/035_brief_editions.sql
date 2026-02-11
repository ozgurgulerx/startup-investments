-- Migration 035: Brief Editions + Revisions
-- Two-table model for dealbook living briefs.
-- brief_editions: one row per region × period_type × period range × kind
-- brief_revisions: each regeneration creates a new revision (only if input changed)

CREATE TABLE IF NOT EXISTS brief_editions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    region TEXT NOT NULL CHECK (region IN ('global', 'turkey')),
    period_type TEXT NOT NULL CHECK (period_type IN ('weekly', 'monthly')),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    kind TEXT NOT NULL DEFAULT 'rolling' CHECK (kind IN ('rolling', 'sealed')),
    latest_revision_id UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sealed_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX idx_brief_editions_unique
    ON brief_editions(region, period_type, period_start, period_end, kind);
CREATE INDEX idx_brief_editions_browse
    ON brief_editions(region, period_type, kind, period_start DESC);

CREATE TABLE IF NOT EXISTS brief_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    edition_id UUID NOT NULL REFERENCES brief_editions(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    input_hash TEXT NOT NULL,
    prompt_version TEXT NOT NULL DEFAULT 'brief-v2',
    model TEXT NOT NULL DEFAULT 'gpt-5-nano',
    metrics_snapshot JSONB NOT NULL,
    deltas_snapshot JSONB NOT NULL DEFAULT '{}',
    content_sections JSONB NOT NULL,
    computed_sections JSONB NOT NULL DEFAULT '{}',
    top_signal_refs JSONB NULL
);

CREATE UNIQUE INDEX idx_brief_revisions_edition_rev
    ON brief_revisions(edition_id, revision);
CREATE INDEX idx_brief_revisions_latest
    ON brief_revisions(edition_id, generated_at DESC);
CREATE INDEX idx_brief_revisions_hash
    ON brief_revisions(input_hash);

-- FK: brief_editions.latest_revision_id → brief_revisions.id
-- Added as ALTER because of circular dependency
ALTER TABLE brief_editions
    ADD CONSTRAINT fk_brief_editions_latest_revision
    FOREIGN KEY (latest_revision_id) REFERENCES brief_revisions(id)
    ON DELETE SET NULL;
