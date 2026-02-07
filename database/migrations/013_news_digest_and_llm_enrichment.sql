-- Daily news subscriptions, delivery tracking, and LLM/builder enrichment fields

ALTER TABLE news_clusters
    ADD COLUMN IF NOT EXISTS builder_takeaway TEXT,
    ADD COLUMN IF NOT EXISTS llm_summary TEXT,
    ADD COLUMN IF NOT EXISTS llm_model TEXT;

CREATE TABLE IF NOT EXISTS news_email_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    email_normalized TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unsubscribed', 'bounced')),
    source TEXT NOT NULL DEFAULT 'website',
    unsubscribe_token UUID NOT NULL DEFAULT gen_random_uuid(),
    preferences_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_news_email_subscriptions_token ON news_email_subscriptions(unsubscribe_token);
CREATE INDEX IF NOT EXISTS idx_news_email_subscriptions_status ON news_email_subscriptions(status);

CREATE TABLE IF NOT EXISTS news_digest_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    edition_date DATE NOT NULL,
    subscription_id UUID NOT NULL REFERENCES news_email_subscriptions(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
    provider_message_id TEXT,
    error_text TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_news_digest_delivery UNIQUE (edition_date, subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_news_digest_deliveries_date ON news_digest_deliveries(edition_date DESC);
CREATE INDEX IF NOT EXISTS idx_news_digest_deliveries_status ON news_digest_deliveries(status);
