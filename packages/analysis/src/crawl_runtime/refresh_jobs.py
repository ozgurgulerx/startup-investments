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
    "manual": 50,
}


# ---------------------------------------------------------------------------
# Enqueue
# ---------------------------------------------------------------------------

async def enqueue_refresh_job(
    conn: "asyncpg.Connection",
    startup_id: str,
    reason: str,
    trigger_event_id: Optional[str] = None,
) -> Optional[str]:
    """Insert a refresh job (deduped: one active job per startup).

    Returns job ID if inserted, None if deduped away.
    """
    boost = REASON_TO_BOOST.get(reason, 30)
    row = await conn.fetchrow(
        """INSERT INTO startup_refresh_jobs
               (startup_id, trigger_event_id, reason, priority_boost)
           VALUES ($1::uuid, $2::uuid, $3, $4)
           ON CONFLICT (startup_id) WHERE status IN ('pending', 'processing')
               DO NOTHING
           RETURNING id::text""",
        startup_id,
        trigger_event_id,
        reason,
        boost,
    )
    if row:
        logger.info("Enqueued refresh job for startup %s reason=%s boost=%d", startup_id, reason, boost)
        return row["id"]
    return None


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
    4. Mark job completed with urls_boosted count
    """
    import asyncpg as apg

    url = database_url or os.environ.get("DATABASE_URL", "")
    conn = await apg.connect(url)

    stats = {"jobs_processed": 0, "total_urls_boosted": 0, "errors": 0}
    try:
        # Fetch pending jobs with startup slug
        jobs = await conn.fetch(
            """SELECT j.id, j.startup_id, j.priority_boost, j.reason,
                      s.slug AS startup_slug
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

            try:
                # Mark processing
                await conn.execute(
                    """UPDATE startup_refresh_jobs
                       SET status = 'processing', started_at = NOW()
                       WHERE id = $1""",
                    job_id,
                )

                # Boost frontier URLs for this startup
                urls_boosted = await conn.fetchval(
                    """WITH updated AS (
                           UPDATE crawl_frontier_urls
                           SET priority_score = LEAST(120, priority_score + $2),
                               next_crawl_at = NOW()
                           WHERE startup_slug = $1
                           RETURNING canonical_url
                       )
                       SELECT count(*) FROM updated""",
                    slug,
                    boost,
                )

                # Also make them immediately available in the queue
                if urls_boosted and urls_boosted > 0:
                    await conn.execute(
                        """UPDATE crawl_frontier_queue
                           SET available_at = NOW(), leased_at = NULL, lease_owner = NULL
                           WHERE canonical_url IN (
                               SELECT canonical_url FROM crawl_frontier_urls
                               WHERE startup_slug = $1
                           )""",
                        slug,
                    )

                # Mark completed
                await conn.execute(
                    """UPDATE startup_refresh_jobs
                       SET status = 'completed', completed_at = NOW(), urls_boosted = $2
                       WHERE id = $1""",
                    job_id,
                    urls_boosted or 0,
                )

                stats["jobs_processed"] += 1
                stats["total_urls_boosted"] += urls_boosted or 0
                logger.info(
                    "Refresh job %s: boosted %d URLs for %s (reason=%s, boost=%d)",
                    job_id, urls_boosted or 0, slug, job["reason"], boost,
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
        await conn.close()

    logger.info(
        "Refresh jobs done: %d processed, %d URLs boosted, %d errors",
        stats["jobs_processed"], stats["total_urls_boosted"], stats["errors"],
    )
    return stats
