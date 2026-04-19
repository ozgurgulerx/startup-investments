-- Migration 084 — Ecosystem-level memory + startup exclusion list (PR #4.1)
--
-- Adds three tables that complement the existing Memory Gate (migrations
-- 023–025):
--
--   * news_ecosystem_facts     — time-series ecosystem facts (e.g. "TR has
--                                 7 unicorns as of 2026-Q1", "mobile gaming
--                                 dominant sector"). Region-aware. Feeds
--                                 daily-brief commentary with long-horizon
--                                 context that per-entity facts can't
--                                 provide.
--
--   * news_ecosystem_sources   — provenance for every external document we
--                                 distilled memory from (KPMG PDFs,
--                                 startups.watch blog posts, YouTube
--                                 transcripts). Keeps raw_text for
--                                 re-distillation if prompts change.
--
--   * startup_exclusions       — canonical blocklist of known non-startup
--                                 Turkish entities (A101 grocery, banks,
--                                 telcos, media, holdings). Fixes the
--                                 relevance gate leak that admitted a
--                                 retail-expansion story about A101.
--                                 `overridden_by_startup_id` whitelists
--                                 spinoff brands (Akbank vs Akbank LAB).

BEGIN;

-- =========================================================================
-- news_ecosystem_sources — external documents we distill memory from
-- =========================================================================
CREATE TABLE IF NOT EXISTS news_ecosystem_sources (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key           TEXT UNIQUE NOT NULL,
    source_type          TEXT NOT NULL CHECK (source_type IN (
        'pdf', 'blog', 'youtube_transcript', 'curated'
    )),
    url                  TEXT,
    title                TEXT NOT NULL,
    publisher            TEXT,
    period_covered       TEXT,
    published_at         DATE,
    downloaded_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    content_hash         TEXT,
    distilled_fact_count INT NOT NULL DEFAULT 0,
    region               TEXT NOT NULL CHECK (region IN ('global', 'turkey', 'both')),
    raw_text             TEXT,
    processed_at         TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ecosystem_sources_region_period
    ON news_ecosystem_sources (region, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_ecosystem_sources_source_type
    ON news_ecosystem_sources (source_type);

COMMENT ON TABLE news_ecosystem_sources IS
    'Provenance for external reports/transcripts distilled into ecosystem memory.';

-- =========================================================================
-- news_ecosystem_facts — time-series ecosystem facts
-- =========================================================================
CREATE TABLE IF NOT EXISTS news_ecosystem_facts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    region         TEXT NOT NULL CHECK (region IN ('global', 'turkey')),
    sector         TEXT,                       -- NULL = whole market
    fact_key       TEXT NOT NULL,              -- e.g. unicorn_count, total_funding_usd
    fact_value     JSONB NOT NULL,             -- e.g. {"value":7,"unit":"count"}
    narrative      TEXT NOT NULL,              -- LLM-friendly one-liner
    source_type    TEXT NOT NULL CHECK (source_type IN (
        'report', 'news_aggregate', 'ecosystem_index', 'curated', 'transcript'
    )),
    source_ref_id  UUID REFERENCES news_ecosystem_sources(id) ON DELETE SET NULL,
    as_of_date     DATE NOT NULL,              -- when the fact is true
    valid_until    DATE,                       -- NULL = open-ended
    confidence     FLOAT NOT NULL DEFAULT 0.8 CHECK (confidence BETWEEN 0 AND 1),
    superseded_by  UUID REFERENCES news_ecosystem_facts(id) ON DELETE SET NULL,
    is_current     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary query path: "give me current facts for a region, most relevant first".
CREATE INDEX IF NOT EXISTS idx_ecosystem_facts_current
    ON news_ecosystem_facts (region, sector, fact_key)
    WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_ecosystem_facts_recency
    ON news_ecosystem_facts (as_of_date DESC)
    WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_ecosystem_facts_source_ref
    ON news_ecosystem_facts (source_ref_id)
    WHERE source_ref_id IS NOT NULL;

-- Upsert lookup: a new fact supersedes the current one on (region, sector, fact_key).
-- Partial unique index would break ON CONFLICT (per project rule); use a regular
-- unique only over the current row by maintaining is_current manually.
CREATE INDEX IF NOT EXISTS idx_ecosystem_facts_supersede_lookup
    ON news_ecosystem_facts (region, COALESCE(sector, ''), fact_key)
    WHERE is_current = TRUE;

COMMENT ON TABLE news_ecosystem_facts IS
    'Ecosystem-level facts (region-aware) feeding daily-brief commentary.';
COMMENT ON COLUMN news_ecosystem_facts.narrative IS
    'Short one-liner suitable for LLM prompt injection without further processing.';

-- =========================================================================
-- startup_exclusions — non-startup entity blocklist
-- =========================================================================
CREATE TABLE IF NOT EXISTS startup_exclusions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_name      TEXT NOT NULL,
    entity_name_norm TEXT GENERATED ALWAYS AS
        (lower(regexp_replace(btrim(entity_name), '\s+', ' ', 'g'))) STORED,
    category         TEXT NOT NULL CHECK (category IN (
        'grocery_retail', 'bank', 'telecom', 'media', 'holding',
        'public_corp', 'consumer_brand', 'real_estate', 'defense_prime',
        'education', 'energy', 'other'
    )),
    reason           TEXT,
    overridden_by_startup_id UUID,
    region           TEXT NOT NULL DEFAULT 'turkey',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive unique per region.
CREATE UNIQUE INDEX IF NOT EXISTS idx_startup_exclusions_name
    ON startup_exclusions (entity_name_norm, region);

COMMENT ON TABLE startup_exclusions IS
    'Known non-startup entities that must not be treated as ecosystem signal. '
    'Consumer brands, banks (the bank, not their VC arms), telcos, media, holdings.';
COMMENT ON COLUMN startup_exclusions.overridden_by_startup_id IS
    'When set, the related startup alias (e.g. Akbank LAB) is NOT excluded even '
    'though the parent name (Akbank) appears in this table.';

COMMIT;
