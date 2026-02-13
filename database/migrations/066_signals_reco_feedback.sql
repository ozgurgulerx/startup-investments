-- 066_signals_reco_feedback.sql
-- Lightweight persistence for Signals recommendations feedback:
-- - Dismiss a recommended signal (hide it from future recommendations)
-- - Per-domain preference weights to nudge ranking

CREATE TABLE IF NOT EXISTS user_signal_reco_dismissals (
  user_id uuid NOT NULL,
  signal_id uuid NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, signal_id)
);

CREATE INDEX IF NOT EXISTS idx_user_signal_reco_dismissals_user
  ON user_signal_reco_dismissals (user_id);

CREATE TABLE IF NOT EXISTS user_signal_domain_prefs (
  user_id uuid NOT NULL,
  region text NOT NULL DEFAULT 'global',
  domain text NOT NULL,
  weight int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, region, domain)
);

CREATE INDEX IF NOT EXISTS idx_user_signal_domain_prefs_user_region
  ON user_signal_domain_prefs (user_id, region);

