-- Migration 021: GIN index for build_patterns JSONB containment + funding_rounds composite
--
-- build_patterns: Used by dealbook pattern filter (@> containment operator)
-- funding_rounds composite: Used by dealbook's correlated subquery for latest round type

CREATE INDEX IF NOT EXISTS idx_startups_build_patterns_gin
  ON startups USING GIN ((analysis_data->'build_patterns'));

CREATE INDEX IF NOT EXISTS idx_funding_rounds_startup_date
  ON funding_rounds (startup_id, announced_date DESC NULLS LAST, created_at DESC);
