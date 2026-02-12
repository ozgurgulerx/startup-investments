-- 046_startup_merge_infrastructure.sql
-- Startup merge/dedup infrastructure: aliases table + merge tracking columns

-- A) startup_aliases table — maps old names/slugs/domains to canonical startup after merge
CREATE TABLE IF NOT EXISTS startup_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alias TEXT NOT NULL,
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    alias_type VARCHAR(20) NOT NULL,  -- name | slug | domain | manual
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_startup_aliases_alias
    ON startup_aliases (alias);

CREATE INDEX IF NOT EXISTS idx_startup_aliases_startup
    ON startup_aliases (startup_id);

COMMENT ON TABLE startup_aliases IS 'Maps old names/slugs/domains to canonical startup after merge';

-- B) Merge columns on startups
ALTER TABLE startups
    ADD COLUMN IF NOT EXISTS merged_into_startup_id UUID REFERENCES startups(id),
    ADD COLUMN IF NOT EXISTS onboarding_status VARCHAR(20) NOT NULL DEFAULT 'verified';

CREATE INDEX IF NOT EXISTS idx_startups_merged_into
    ON startups (merged_into_startup_id) WHERE merged_into_startup_id IS NOT NULL;

COMMENT ON COLUMN startups.merged_into_startup_id IS 'Points to canonical startup after merge';
COMMENT ON COLUMN startups.onboarding_status IS 'stub | verified | rejected | merged';
