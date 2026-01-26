-- Migration: Add users table for authentication
-- Run: psql -d startupinvestments -f 006_add_users_table.sql

-- =============================================================================
-- USERS TABLE
-- Stores user accounts for authentication (Google OAuth and credentials)
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    email_lower VARCHAR(255) NOT NULL UNIQUE,  -- Lowercase for case-insensitive lookup
    password_hash VARCHAR(255),  -- NULL for OAuth-only users
    full_name VARCHAR(255),
    role VARCHAR(50) NOT NULL DEFAULT 'user',  -- 'user', 'admin', 'editor'
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    -- OAuth tracking
    google_id VARCHAR(255),
    avatar_url VARCHAR(500),

    -- Timestamps
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(email_lower);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Updated_at trigger
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- USER WATCHLISTS TABLE
-- Tracks user's saved/watched startups
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_watchlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, startup_id)
);

CREATE INDEX IF NOT EXISTS idx_watchlists_user ON user_watchlists(user_id);
CREATE INDEX IF NOT EXISTS idx_watchlists_startup ON user_watchlists(startup_id);

-- =============================================================================
-- USER PREFERENCES TABLE
-- Stores user settings and preferences
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    audience VARCHAR(20) DEFAULT 'builders',  -- 'builders' or 'investors'
    email_notifications BOOLEAN DEFAULT TRUE,
    saved_filters JSONB,  -- User's saved filter presets
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_preferences_user ON user_preferences(user_id);

-- Updated_at trigger for preferences
DROP TRIGGER IF EXISTS update_user_preferences_updated_at ON user_preferences;
CREATE TRIGGER update_user_preferences_updated_at
    BEFORE UPDATE ON user_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
