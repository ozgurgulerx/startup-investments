-- Migration 076: GIN index on startup_events.evidence_ids
--
-- Enables fast "trace back" queries from evidence_id -> events.
-- Must be standalone because CREATE INDEX CONCURRENTLY cannot run inside a
-- multi-statement transaction block.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_startup_events_evidence_ids_gin
    ON startup_events USING gin (evidence_ids);

