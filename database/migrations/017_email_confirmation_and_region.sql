-- Email subscription: double opt-in confirmation flow + regional support
-- Adds pending_confirmation status, confirmation token, confirmed_at timestamp,
-- and region column so the same email can subscribe to both Global and Turkey digests.

-- 1. Expand status check to include 'pending_confirmation'
ALTER TABLE news_email_subscriptions
  DROP CONSTRAINT IF EXISTS news_email_subscriptions_status_check;
ALTER TABLE news_email_subscriptions
  ADD CONSTRAINT news_email_subscriptions_status_check
  CHECK (status IN ('pending_confirmation', 'active', 'unsubscribed', 'bounced'));

-- 2. Confirmation fields
ALTER TABLE news_email_subscriptions
  ADD COLUMN IF NOT EXISTS confirmation_token UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

-- 3. Region column (existing rows default to 'global')
ALTER TABLE news_email_subscriptions
  ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT 'global';

ALTER TABLE news_email_subscriptions
  DROP CONSTRAINT IF EXISTS news_email_subscriptions_region_check;
ALTER TABLE news_email_subscriptions
  ADD CONSTRAINT news_email_subscriptions_region_check
  CHECK (region IN ('global', 'turkey'));

-- 4. Unique index on confirmation_token
CREATE UNIQUE INDEX IF NOT EXISTS idx_news_email_subs_confirmation_token
  ON news_email_subscriptions(confirmation_token);

-- 5. Replace old unique on email_normalized with (email_normalized, region)
--    so the same email can subscribe to both regions independently
-- Column UNIQUE constraints typically own the underlying index; drop the constraint first.
ALTER TABLE news_email_subscriptions
  DROP CONSTRAINT IF EXISTS news_email_subscriptions_email_normalized_key;
-- Safety: if the index exists independently (older schema variants), drop it too.
DROP INDEX IF EXISTS news_email_subscriptions_email_normalized_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_news_email_subs_email_region
  ON news_email_subscriptions(email_normalized, region);

-- 6. Index for filtering subscribers by region + status (used by digest sender)
CREATE INDEX IF NOT EXISTS idx_news_email_subs_region_status
  ON news_email_subscriptions(region, status);
