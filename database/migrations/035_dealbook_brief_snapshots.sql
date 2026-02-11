-- Migration 035: Dealbook Brief Snapshots
-- Living brief system — stores computed snapshots of the dealbook intelligence brief
-- with revision tracking, delta computation, and LLM-generated sections.

CREATE TABLE IF NOT EXISTS dealbook_brief_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    region TEXT NOT NULL DEFAULT 'global'
        CHECK (region IN ('global', 'turkey')),
    period_type TEXT NOT NULL
        CHECK (period_type IN ('monthly', 'weekly')),
    period_key TEXT NOT NULL,            -- "2026-02" or "2026-W07"
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    period_label TEXT NOT NULL,          -- "February 2026 (MTD)" or "Week of Feb 3–9"
    revision_number INTEGER NOT NULL DEFAULT 1,

    metrics_json JSONB NOT NULL,         -- BriefSnapshotMetrics
    prev_period_json JSONB,              -- same shape for prev period
    deltas_json JSONB,                   -- BriefSnapshotDeltas

    -- LLM-generated sections
    delta_bullets TEXT[] DEFAULT '{}',
    executive_summary TEXT,
    theme_json JSONB,
    builder_lessons_json JSONB,
    what_watching TEXT[] DEFAULT '{}',

    -- Computed sections (deterministic, no LLM)
    top_deals_json JSONB,
    geography_json JSONB,
    investors_json JSONB,
    spotlight_json JSONB,
    patterns_json JSONB,                 -- patternLandscape
    funding_by_stage_json JSONB,
    methodology_json JSONB,

    -- News context (linked clusters)
    news_context_json JSONB,             -- top news clusters linked to this period's startups

    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'ready', 'sealed')),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_brief_snapshots_unique
    ON dealbook_brief_snapshots(region, period_type, period_key, revision_number);
CREATE INDEX idx_brief_snapshots_latest
    ON dealbook_brief_snapshots(region, period_type, status, generated_at DESC);
