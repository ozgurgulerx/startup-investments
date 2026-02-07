-- Migration 016: Event retry tracking
-- Adds retry tracking columns to startup_events for robust error handling.
-- Failed events are no longer permanently lost — they can be retried up to 3 times.

ALTER TABLE startup_events
    ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_error TEXT,
    ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending';

-- Index for finding failed events that need attention
CREATE INDEX IF NOT EXISTS idx_startup_events_status
    ON startup_events (status) WHERE status = 'failed';

-- Backfill: mark already-processed events as 'completed', unprocessed as 'pending'
UPDATE startup_events SET status = 'completed' WHERE processed = true AND status = 'pending';
