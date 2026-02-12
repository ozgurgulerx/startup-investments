-- Migration 043: Add effective_date to startup_events
--
-- effective_date is the canonical date for all time-based signal queries.
-- It uses the real event date (when the event happened) rather than
-- detected_at (when BuildAtlas processed it), eliminating scheduler-
-- artifact momentum spikes from batch runs.

-- Add effective_date column (DATE, not timestamp — day granularity is sufficient)
ALTER TABLE startup_events
ADD COLUMN IF NOT EXISTS effective_date DATE;

-- Backfill from event_date (preferred) or detected_at (fallback)
UPDATE startup_events
SET effective_date = COALESCE(event_date::date, detected_at::date)
WHERE effective_date IS NULL;

-- Covering index for signal engine lookback queries
CREATE INDEX IF NOT EXISTS idx_startup_events_effective_date
    ON startup_events (effective_date DESC, event_type, event_key);
