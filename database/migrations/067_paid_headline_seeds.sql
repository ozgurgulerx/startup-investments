-- Paid headline seeds (manual paywalled-source leads)
--
-- Purpose:
-- - Store headline-only URLs from paywalled sources (e.g. The Information).
-- - Use them as leads to find corroborating coverage on the open web.
-- - Never store/paywall-bypass full paid article content.

CREATE TABLE IF NOT EXISTS paid_headline_seeds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publisher_key TEXT NOT NULL,
    url TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    title TEXT,
    summary TEXT,
    published_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'processed', 'failed', 'ignored')),
    attempt_count INT NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_paid_headline_seeds_publisher_canonical UNIQUE (publisher_key, canonical_url)
);

CREATE INDEX IF NOT EXISTS idx_paid_headline_seeds_status_created
    ON paid_headline_seeds(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_paid_headline_seeds_publisher_created
    ON paid_headline_seeds(publisher_key, created_at DESC);

COMMENT ON TABLE paid_headline_seeds IS 'Manual seeds for paywalled headline-only sources; used as leads for open-web corroboration.';

