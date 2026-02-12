"""Event-driven startup refresh job queue.

When the news pipeline detects important events (funding, product launch, key hire),
affected startups are queued here. A processor bumps crawl frontier priority so the
next worker cycle picks up the boosted URLs first.

Usage:
    enqueue_refresh_job(conn, startup_id, reason)  — called from event_extractor
    process_refresh_jobs(database_url)              — called from CLI / cron
"""

from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING, Dict, Optional

if TYPE_CHECKING:
    import asyncpg

    from .frontier import UrlFrontierStore as _UrlFrontierStore

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Event type → refresh reason + priority boost mapping
# ---------------------------------------------------------------------------

EVENT_TYPE_TO_REASON: Dict[str, str] = {
    "cap_funding_raised": "funding_event",
    "cap_acquisition_announced": "acquisition",
    "prod_launched": "product_launch",
    "prod_major_update": "product_launch",
    "org_key_hire": "key_hire",
    "gtm_enterprise_tier_launched": "pricing_change",
}

REASON_TO_BOOST: Dict[str, int] = {
    "funding_event": 40,
    "product_launch": 30,
    "key_hire": 20,
    "acquisition": 40,
    "pricing_change": 25,
    "crawl_diff_analysis": 15,
    "news_onboard": 35,
    "manual": 50,
}

# Cooldown: skip re-enqueue if a completed job with same startup+reason
# exists within these many hours. Prevents churn from repeated events.
_REASON_COOLDOWN_HOURS: Dict[str, int] = {
    "crawl_diff_analysis": 168,  # 7 days
    "news_onboard": 72,          # 3 days
    "funding_event": 24,
    "product_launch": 48,
    "key_hire": 72,
    "acquisition": 24,
    "pricing_change": 48,
    "manual": 0,                 # no cooldown for manual
}

# ---------------------------------------------------------------------------
# SQL constants
# ---------------------------------------------------------------------------

# Fix #1: Single CTE that boosts frontier URLs and only unlocks the rows it
# actually touched, with a guard against clobbering fresh leases (<15 min).
BOOST_AND_UNLOCK_SQL = """
WITH updated AS (
    UPDATE crawl_frontier_urls
    SET priority_score = LEAST(120, priority_score + $2),
        next_crawl_at = NOW()
    WHERE startup_slug = $1
    RETURNING canonical_url
),
unlocked AS (
    UPDATE crawl_frontier_queue q
    SET available_at = NOW(),
        leased_at = NULL,
        lease_owner = NULL
    WHERE q.canonical_url IN (SELECT canonical_url FROM updated)
      AND (q.leased_at IS NULL OR q.leased_at < NOW() - INTERVAL '15 minutes')
    RETURNING 1
)
SELECT
    (SELECT count(*) FROM updated)  AS urls_boosted,
    (SELECT count(*) FROM unlocked) AS urls_unlocked;
"""

# Fix #4: Reset jobs stuck in 'processing' for > 45 minutes.
RESET_STALE_SQL = """
UPDATE startup_refresh_jobs
SET status = 'pending',
    error_message = COALESCE(error_message, '') || ' | stale processing reset',
    started_at = NULL
WHERE status = 'processing'
  AND started_at < NOW() - INTERVAL '45 minutes';
"""


# ---------------------------------------------------------------------------
# Enqueue
# ---------------------------------------------------------------------------

async def enqueue_refresh_job(
    conn: "asyncpg.Connection",
    startup_id: str,
    reason: str,
    trigger_event_id: Optional[str] = None,
) -> str:
    """Insert or escalate a refresh job for a startup.

    If an active (pending/processing) job already exists for this startup,
    the priority_boost is escalated to the higher value and the reason is
    updated to match the winning boost. Always returns the job ID.
    """
    boost = REASON_TO_BOOST.get(reason, 30)

    # Cooldown check: skip if a completed job for same startup+reason
    # exists within the cooldown window
    cooldown_hours = _REASON_COOLDOWN_HOURS.get(reason, 0)
    if cooldown_hours > 0:
        existing_id = await conn.fetchval(
            """SELECT id::text FROM startup_refresh_jobs
               WHERE startup_id = $1::uuid
                 AND reason = $2
                 AND status = 'completed'
                 AND completed_at > NOW() - make_interval(hours => $3)
               LIMIT 1""",
            startup_id,
            reason,
            cooldown_hours,
        )
        if existing_id:
            logger.info(
                "Cooldown active for startup %s reason=%s (%dh), skipping enqueue",
                startup_id, reason, cooldown_hours,
            )
            return existing_id

    row = await conn.fetchrow(
        """INSERT INTO startup_refresh_jobs
               (startup_id, trigger_event_id, reason, priority_boost)
           VALUES ($1::uuid, $2::uuid, $3, $4)
           ON CONFLICT (startup_id) WHERE status IN ('pending', 'processing')
           DO UPDATE SET
               priority_boost = GREATEST(startup_refresh_jobs.priority_boost, EXCLUDED.priority_boost),
               trigger_event_id = COALESCE(EXCLUDED.trigger_event_id, startup_refresh_jobs.trigger_event_id),
               reason = CASE
                   WHEN EXCLUDED.priority_boost > startup_refresh_jobs.priority_boost THEN EXCLUDED.reason
                   ELSE startup_refresh_jobs.reason
               END
           RETURNING id::text""",
        startup_id,
        trigger_event_id,
        reason,
        boost,
    )
    logger.info("Enqueued refresh job for startup %s reason=%s boost=%d", startup_id, reason, boost)
    return row["id"]


# ---------------------------------------------------------------------------
# Seed fallback helper (fix #2)
# ---------------------------------------------------------------------------

async def _seed_and_boost(
    conn: "asyncpg.Connection",
    frontier_store: "_UrlFrontierStore",
    slug: str,
    website: Optional[str],
    boost: int,
) -> Dict[str, int]:
    """Seed frontier URLs for a startup with no existing URLs, then boost.

    Returns dict with urls_boosted and urls_unlocked counts.
    """
    from .seed_frontier import build_seed_urls

    if not website:
        return {"urls_boosted": 0, "urls_unlocked": 0}

    seed_urls = build_seed_urls(website)
    if not seed_urls:
        return {"urls_boosted": 0, "urls_unlocked": 0}

    seeded = await frontier_store.enqueue_urls(slug, seed_urls)
    logger.info("Seeded %d frontier URLs for %s (website=%s)", seeded, slug, website)

    # Re-run boost+unlock now that URLs exist
    row = await conn.fetchrow(BOOST_AND_UNLOCK_SQL, slug, boost)
    return {
        "urls_boosted": row["urls_boosted"] if row else 0,
        "urls_unlocked": row["urls_unlocked"] if row else 0,
    }


# ---------------------------------------------------------------------------
# Process
# ---------------------------------------------------------------------------

async def process_refresh_jobs(
    database_url: Optional[str] = None,
    batch_size: int = 50,
) -> Dict[str, int]:
    """Pick up pending refresh jobs and boost crawl frontier URLs.

    For each job:
    1. Resolve startup slug from startups table
    2. Bump priority_score on crawl_frontier_urls for that slug
    3. Set available_at = NOW() on crawl_frontier_queue for those URLs
       (only if the lease is stale or absent — fresh leases are preserved)
    4. If no frontier URLs exist, seed them from the startup's website
    5. Mark job completed with urls_boosted count
    """
    import asyncpg as apg

    from .frontier import UrlFrontierStore

    url = database_url or os.environ.get("DATABASE_URL", "")
    conn = await apg.connect(url)

    stats = {"jobs_processed": 0, "total_urls_boosted": 0, "errors": 0, "stale_reset": 0}
    frontier_store: Optional[UrlFrontierStore] = None
    try:
        # Fix #4: Reset stuck processing jobs before claiming new ones
        stale_result = await conn.execute(RESET_STALE_SQL)
        try:
            stale_count = int(stale_result.split()[-1])
        except Exception:
            stale_count = 0
        if stale_count:
            logger.warning("Reset %d stale processing jobs", stale_count)
            stats["stale_reset"] = stale_count

        # Fetch pending jobs with startup slug + website
        jobs = await conn.fetch(
            """SELECT j.id, j.startup_id, j.priority_boost, j.reason,
                      s.slug AS startup_slug, s.website
               FROM startup_refresh_jobs j
               JOIN startups s ON s.id = j.startup_id
               WHERE j.status = 'pending'
               ORDER BY j.created_at ASC
               LIMIT $1""",
            batch_size,
        )
        if not jobs:
            logger.info("No pending refresh jobs")
            return stats

        logger.info("Processing %d refresh jobs", len(jobs))

        for job in jobs:
            job_id = job["id"]
            slug = job["startup_slug"]
            boost = job["priority_boost"]
            website = job["website"]

            try:
                # Mark processing
                await conn.execute(
                    """UPDATE startup_refresh_jobs
                       SET status = 'processing', started_at = NOW()
                       WHERE id = $1""",
                    job_id,
                )

                # Fix #1: Single CTE boost + unlock
                row = await conn.fetchrow(BOOST_AND_UNLOCK_SQL, slug, boost)
                urls_boosted = row["urls_boosted"] if row else 0
                urls_unlocked = row["urls_unlocked"] if row else 0

                # Fix #2: Seed fallback when no frontier URLs exist
                if urls_boosted == 0 and website:
                    if frontier_store is None:
                        frontier_store = UrlFrontierStore(url)
                        await frontier_store.connect()
                    result = await _seed_and_boost(conn, frontier_store, slug, website, boost)
                    urls_boosted = result["urls_boosted"]
                    urls_unlocked = result["urls_unlocked"]

                # Mark completed
                await conn.execute(
                    """UPDATE startup_refresh_jobs
                       SET status = 'completed', completed_at = NOW(), urls_boosted = $2
                       WHERE id = $1""",
                    job_id,
                    urls_boosted,
                )

                stats["jobs_processed"] += 1
                stats["total_urls_boosted"] += urls_boosted
                logger.info(
                    "Refresh job %s: boosted %d URLs (unlocked %d) for %s (reason=%s, boost=%d)",
                    job_id, urls_boosted, urls_unlocked, slug, job["reason"], boost,
                )

            except Exception:
                stats["errors"] += 1
                logger.warning("Failed to process refresh job %s", job_id, exc_info=True)
                await conn.execute(
                    """UPDATE startup_refresh_jobs
                       SET status = 'failed', error_message = $2, completed_at = NOW()
                       WHERE id = $1""",
                    job_id,
                    "processing error — see logs",
                )
    finally:
        if frontier_store is not None:
            await frontier_store.close()
        await conn.close()

    logger.info(
        "Refresh jobs done: %d processed, %d URLs boosted, %d errors, %d stale reset",
        stats["jobs_processed"], stats["total_urls_boosted"], stats["errors"], stats["stale_reset"],
    )
    return stats
