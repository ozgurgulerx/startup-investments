-- 027: Add timezone column to news_email_subscriptions
-- Enables per-subscriber delivery at 08:45 local time (default: Istanbul)

ALTER TABLE news_email_subscriptions
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Europe/Istanbul';

COMMENT ON COLUMN news_email_subscriptions.timezone IS
  'IANA timezone (e.g. Europe/Istanbul, America/New_York). Digest emails are delivered at 08:45 in this timezone.';
