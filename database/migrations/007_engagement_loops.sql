-- Migration: Engagement Loops
-- Run: psql -d startupinvestments -f 007_engagement_loops.sql

-- =============================================================================
-- USER NOTIFICATIONS TABLE
-- Stores notifications for users about watchlist changes, pattern alerts, etc.
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    startup_id UUID REFERENCES startups(id) ON DELETE CASCADE,
    event_id UUID REFERENCES startup_events(id) ON DELETE SET NULL,
    notification_type VARCHAR(50) NOT NULL,  -- 'funding_round', 'pattern_change', 'watchlist_update', 'filter_match'
    title VARCHAR(255) NOT NULL,
    body TEXT,
    link_type VARCHAR(50),  -- 'company', 'signal', 'brief', 'dealbook'
    link_slug VARCHAR(255),
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_notifications_user ON user_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON user_notifications(user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_notifications_created ON user_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_startup ON user_notifications(startup_id);

-- =============================================================================
-- ADD PLAN COLUMN TO USERS TABLE
-- Supports feature gating (free/pro/team)
-- =============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(20) DEFAULT 'free';

-- Index for plan-based queries
CREATE INDEX IF NOT EXISTS idx_users_plan ON users(plan);

-- =============================================================================
-- STARTUP EVENTS TABLE (if not exists)
-- For tracking changes to startups that trigger notifications
-- =============================================================================

CREATE TABLE IF NOT EXISTS startup_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,  -- 'funding_round', 'pattern_detected', 'website_change', 'news_mention'
    event_data JSONB,
    source VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_startup_events_startup ON startup_events(startup_id);
CREATE INDEX IF NOT EXISTS idx_startup_events_type ON startup_events(event_type);
CREATE INDEX IF NOT EXISTS idx_startup_events_created ON startup_events(created_at DESC);

-- =============================================================================
-- PATTERN CORRELATIONS TABLE (if not exists)
-- Stores pattern co-occurrence statistics
-- =============================================================================

CREATE TABLE IF NOT EXISTS pattern_correlations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period VARCHAR(10) NOT NULL,  -- e.g., '2026-01'
    pattern_a VARCHAR(100) NOT NULL,
    pattern_b VARCHAR(100) NOT NULL,
    co_occurrence_count INTEGER NOT NULL DEFAULT 0,
    pattern_a_count INTEGER NOT NULL DEFAULT 0,
    pattern_b_count INTEGER NOT NULL DEFAULT 0,
    correlation_score DECIMAL(5, 4),  -- -1 to 1
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(period, pattern_a, pattern_b)
);

CREATE INDEX IF NOT EXISTS idx_pattern_correlations_period ON pattern_correlations(period);
CREATE INDEX IF NOT EXISTS idx_pattern_correlations_patterns ON pattern_correlations(pattern_a, pattern_b);
