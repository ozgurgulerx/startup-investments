CREATE TABLE IF NOT EXISTS pipeline_runtime_state (
    job_name TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'global',
    state_key TEXT NOT NULL DEFAULT 'default',
    state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (job_name, scope, state_key)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runtime_state_updated_at
    ON pipeline_runtime_state (updated_at DESC);
