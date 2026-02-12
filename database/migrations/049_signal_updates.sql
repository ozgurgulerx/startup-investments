-- Migration 049: Signal updates tracking + follow notification preferences
-- Tracks signal lifecycle changes for notification system

-- Signal updates log (emitted by signal_engine.py)
CREATE TABLE IF NOT EXISTS signal_updates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
    update_type TEXT NOT NULL CHECK (update_type IN (
      'created', 'status_change', 'evidence_spike', 'score_change'
    )),
    old_value TEXT,
    new_value TEXT,
    metadata_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signal_updates_created ON signal_updates(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_updates_signal ON signal_updates(signal_id);

-- Add notification preferences to follows table
ALTER TABLE user_signal_follows
  ADD COLUMN IF NOT EXISTS notify_on TEXT[] NOT NULL DEFAULT ARRAY['status_change', 'evidence_spike'];
