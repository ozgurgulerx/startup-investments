-- 064_fix_onboarding_trace_dedupe_index.sql
-- Fix: allow `ON CONFLICT (dedupe_key)` inference by using a non-partial unique index.
--
-- Postgres cannot infer partial unique indexes for `ON CONFLICT (col)` unless
-- the conflict target includes the predicate. We rely on simple `ON CONFLICT
-- (dedupe_key) DO NOTHING`, so we need a plain unique index.

DROP INDEX IF EXISTS uq_onboarding_trace_events_dedupe;

-- UNIQUE allows multiple NULLs by default in Postgres, so this still behaves as
-- "dedupe only when a key is provided" while supporting ON CONFLICT inference.
CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_trace_events_dedupe
    ON onboarding_trace_events(dedupe_key);
