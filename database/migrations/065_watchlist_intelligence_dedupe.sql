-- Migration 065: Watchlist Intelligence Dedupe + Idempotency Guards
--
-- Adds unique indexes to keep alert/digest generation idempotent, and
-- removes exact duplicates if they exist (safe: keeps one row per key).

-- =============================================================================
-- 1) USER ALERTS — ensure 1 alert per (user, scope, delta)
-- =============================================================================

-- Best-effort dedupe (keep oldest row for each key)
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY user_id, scope, delta_id
            ORDER BY created_at ASC, id ASC
        ) AS rn
    FROM user_alerts
)
DELETE FROM user_alerts ua
USING ranked r
WHERE ua.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_alerts_dedupe
    ON user_alerts(user_id, scope, delta_id);

-- =============================================================================
-- 2) USER DIGEST THREADS — ensure 1 digest per (user, scope, period)
-- =============================================================================

WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY user_id, scope, period_start, period_end
            ORDER BY created_at ASC, id ASC
        ) AS rn
    FROM user_digest_threads
)
DELETE FROM user_digest_threads udt
USING ranked r
WHERE udt.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_digest_threads_dedupe
    ON user_digest_threads(user_id, scope, period_start, period_end);

