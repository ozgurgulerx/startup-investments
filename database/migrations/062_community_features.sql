-- Migration 062: Community features for Signals + Watchlist intelligence
-- Adds:
-- 1) Trust + reputation fields on users
-- 2) Signal discussion threads + votes
-- 3) Signal polls + votes
-- 4) Shared watchlists
-- 5) User notification hygiene preferences

-- =============================================================================
-- 1) TRUST + REPUTATION
-- =============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS reputation_points INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS trust_level INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_trust_level_range'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_trust_level_range CHECK (trust_level BETWEEN 0 AND 3);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_trust_level ON users(trust_level);
CREATE INDEX IF NOT EXISTS idx_users_reputation_points ON users(reputation_points DESC);

-- =============================================================================
-- 2) SIGNAL THREADS
-- =============================================================================

CREATE TABLE IF NOT EXISTS signal_thread_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_post_id UUID REFERENCES signal_thread_posts(id) ON DELETE CASCADE,
  post_type TEXT NOT NULL DEFAULT 'answer'
    CHECK (post_type IN ('question', 'answer', 'evidence', 'counterpoint', 'update')),
  body TEXT NOT NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signal_thread_posts_signal
  ON signal_thread_posts(signal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_thread_posts_user
  ON signal_thread_posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_thread_posts_parent
  ON signal_thread_posts(parent_post_id)
  WHERE parent_post_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS signal_thread_votes (
  post_id UUID NOT NULL REFERENCES signal_thread_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote SMALLINT NOT NULL CHECK (vote IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_signal_thread_votes_post ON signal_thread_votes(post_id);
CREATE INDEX IF NOT EXISTS idx_signal_thread_votes_user ON signal_thread_votes(user_id);

-- =============================================================================
-- 3) SIGNAL POLLS
-- =============================================================================

CREATE TABLE IF NOT EXISTS signal_polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  options_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  closes_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signal_polls_signal
  ON signal_polls(signal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_polls_status
  ON signal_polls(status, created_at DESC);

CREATE TABLE IF NOT EXISTS signal_poll_votes (
  poll_id UUID NOT NULL REFERENCES signal_polls(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poll_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_signal_poll_votes_poll ON signal_poll_votes(poll_id);
CREATE INDEX IF NOT EXISTS idx_signal_poll_votes_user ON signal_poll_votes(user_id);

-- =============================================================================
-- 4) SHARED WATCHLISTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS shared_watchlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'team', 'public')),
  invite_code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shared_watchlists_owner
  ON shared_watchlists(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shared_watchlists_visibility
  ON shared_watchlists(visibility, updated_at DESC);

CREATE TABLE IF NOT EXISTS shared_watchlist_members (
  watchlist_id UUID NOT NULL REFERENCES shared_watchlists(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'editor', 'viewer')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (watchlist_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_shared_watchlist_members_user
  ON shared_watchlist_members(user_id, joined_at DESC);

CREATE TABLE IF NOT EXISTS shared_watchlist_items (
  watchlist_id UUID NOT NULL REFERENCES shared_watchlists(id) ON DELETE CASCADE,
  startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
  notes TEXT,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (watchlist_id, startup_id)
);

CREATE INDEX IF NOT EXISTS idx_shared_watchlist_items_watchlist
  ON shared_watchlist_items(watchlist_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shared_watchlist_items_startup
  ON shared_watchlist_items(startup_id);

-- =============================================================================
-- 5) NOTIFICATION HYGIENE PREFERENCES
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  digest_frequency TEXT NOT NULL DEFAULT 'daily'
    CHECK (digest_frequency IN ('realtime', 'daily', 'weekly', 'off')),
  mute_low_severity BOOLEAN NOT NULL DEFAULT FALSE,
  muted_delta_types TEXT[] NOT NULL DEFAULT '{}',
  quiet_hours_start SMALLINT NOT NULL DEFAULT 22
    CHECK (quiet_hours_start BETWEEN 0 AND 23),
  quiet_hours_end SMALLINT NOT NULL DEFAULT 7
    CHECK (quiet_hours_end BETWEEN 0 AND 23),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  enable_recommended_follows BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_notification_preferences_digest
  ON user_notification_preferences(digest_frequency);
