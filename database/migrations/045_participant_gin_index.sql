-- GIN index on startup_events.metadata_json for participant lookups
-- Enables efficient queries like: WHERE metadata_json @> '{"participants": [{"startup_id": "..."}]}'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_startup_events_metadata_gin
ON startup_events USING gin (metadata_json jsonb_path_ops);
