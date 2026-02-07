-- Rate limiting support for email subscriptions + explicit confirmation timestamp

ALTER TABLE news_email_subscriptions
  ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ;

-- Lightweight request log for abuse control (rate limiting).
-- Note: stores IP address as text. If you want to avoid raw IP storage, switch to a hash.
CREATE TABLE IF NOT EXISTS news_email_subscription_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'global',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT news_email_subscription_requests_region_check
    CHECK (region IN ('global', 'turkey'))
);

CREATE INDEX IF NOT EXISTS idx_news_email_sub_req_ip_created
  ON news_email_subscription_requests(ip, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_news_email_sub_req_email_region_created
  ON news_email_subscription_requests(email_normalized, region, created_at DESC);

