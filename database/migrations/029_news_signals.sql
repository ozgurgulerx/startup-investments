-- Community signals: upvote, save, hide, not_useful
-- Supports both logged-in users (user_id) and anonymous visitors (anon_id cookie)

-- Individual user actions (toggle rows)
CREATE TABLE IF NOT EXISTS news_item_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cluster_id UUID NOT NULL REFERENCES news_clusters(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL CHECK (action_type IN ('upvote', 'save', 'hide', 'not_useful')),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    anon_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Exactly one of user_id or anon_id must be set
    CONSTRAINT signal_identity_check CHECK (
        (user_id IS NOT NULL AND anon_id IS NULL) OR
        (user_id IS NULL AND anon_id IS NOT NULL)
    )
);

-- Partial unique indexes: one signal per (cluster, action, identity)
CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_user
    ON news_item_signals (cluster_id, action_type, user_id)
    WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_anon
    ON news_item_signals (cluster_id, action_type, anon_id)
    WHERE anon_id IS NOT NULL;

-- Lookup indexes for fetching user's signals
CREATE INDEX IF NOT EXISTS idx_signals_by_user ON news_item_signals (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signals_by_anon ON news_item_signals (anon_id) WHERE anon_id IS NOT NULL;

-- Aggregated public counts (materialized at app level, no triggers)
CREATE TABLE IF NOT EXISTS news_item_stats (
    cluster_id UUID PRIMARY KEY REFERENCES news_clusters(id) ON DELETE CASCADE,
    upvote_count INT NOT NULL DEFAULT 0,
    save_count INT NOT NULL DEFAULT 0,
    not_useful_count INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
