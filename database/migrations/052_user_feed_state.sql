-- Migration 052: User Feed State
--
-- Tracks per-user read position in the movers feed.
-- Enables unread count badges and "mark as seen" functionality.

CREATE TABLE IF NOT EXISTS user_feed_state (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    region          TEXT NOT NULL DEFAULT 'global',
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01',
    UNIQUE (user_id, region)
);

COMMENT ON TABLE user_feed_state IS
    'Per-user read position in the movers delta feed. Used to compute unread event counts.';
