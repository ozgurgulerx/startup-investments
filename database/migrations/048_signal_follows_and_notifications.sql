-- Signal follows and notification support
-- Allows authenticated users to follow signals and track "new since last visit"

-- User signal follows
CREATE TABLE IF NOT EXISTS user_signal_follows (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, signal_id)
);
CREATE INDEX IF NOT EXISTS idx_user_signal_follows_signal ON user_signal_follows(signal_id);

-- Last-seen tracking for "new since" notification count
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_signals_at TIMESTAMPTZ;

-- Index for update-count queries (signals created/updated since timestamp)
CREATE INDEX IF NOT EXISTS idx_signals_first_seen_region
  ON signals(region, first_seen_at DESC)
  WHERE status NOT IN ('decaying');
