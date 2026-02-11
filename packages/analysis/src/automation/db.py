"""Database connection helper for automation components."""

import os
import asyncio
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from contextlib import asynccontextmanager

import asyncpg


class DatabaseConnection:
    """Async PostgreSQL connection manager."""

    def __init__(self, database_url: Optional[str] = None):
        self.database_url = database_url or os.getenv("DATABASE_URL")
        if not self.database_url:
            raise ValueError("DATABASE_URL environment variable not set")
        self._pool: Optional[asyncpg.Pool] = None

    async def connect(self):
        """Initialize connection pool."""
        if not self._pool:
            self._pool = await asyncpg.create_pool(
                self.database_url,
                min_size=3,
                max_size=10,
                command_timeout=60,
                timeout=30,
            )

    async def close(self):
        """Close connection pool."""
        if self._pool:
            await self._pool.close()
            self._pool = None

    @asynccontextmanager
    async def acquire(self):
        """Acquire a connection from the pool."""
        if not self._pool:
            await self.connect()
        async with self._pool.acquire() as conn:
            yield conn

    async def execute(self, query: str, *args) -> str:
        """Execute a query and return status."""
        async with self.acquire() as conn:
            return await conn.execute(query, *args)

    async def fetch(self, query: str, *args) -> List[asyncpg.Record]:
        """Fetch multiple rows."""
        async with self.acquire() as conn:
            return await conn.fetch(query, *args)

    async def fetchrow(self, query: str, *args) -> Optional[asyncpg.Record]:
        """Fetch a single row."""
        async with self.acquire() as conn:
            return await conn.fetchrow(query, *args)

    async def fetchval(self, query: str, *args) -> Any:
        """Fetch a single value."""
        async with self.acquire() as conn:
            return await conn.fetchval(query, *args)

    # =========================================================================
    # Startup Events Operations
    # =========================================================================

    async def get_unprocessed_events(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Get unprocessed startup events."""
        rows = await self.fetch("""
            SELECT
                e.id, e.startup_id, e.event_type, e.event_source,
                e.event_title, e.event_url, e.event_content,
                e.event_date, e.detected_at,
                s.name as startup_name, s.website as startup_website
            FROM startup_events e
            LEFT JOIN startups s ON e.startup_id = s.id
            WHERE e.processed = false
            ORDER BY e.detected_at ASC
            LIMIT $1
        """, limit)
        return [dict(r) for r in rows]

    async def mark_event_processed(
        self,
        event_id: str,
        triggered_reanalysis: bool = False,
        analysis_id: Optional[str] = None
    ):
        """Mark an event as processed."""
        await self.execute("""
            UPDATE startup_events
            SET processed = true,
                processed_at = $2,
                triggered_reanalysis = $3,
                analysis_id = $4
            WHERE id = $1
        """, event_id, datetime.now(timezone.utc), triggered_reanalysis, analysis_id)

    async def create_startup_event(
        self,
        startup_id: Optional[str],
        event_type: str,
        event_source: str,
        event_title: Optional[str] = None,
        event_url: Optional[str] = None,
        event_content: Optional[str] = None,
        event_date: Optional[datetime] = None
    ) -> str:
        """Create a new startup event."""
        event_id = await self.fetchval("""
            INSERT INTO startup_events
                (startup_id, event_type, event_source, event_title,
                 event_url, event_content, event_date)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id
        """, startup_id, event_type, event_source, event_title,
             event_url, event_content, event_date or datetime.now(timezone.utc))
        return str(event_id)

    # =========================================================================
    # Deep Research Queue Operations
    # =========================================================================

    async def get_pending_research_items(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get pending research queue items by priority."""
        rows = await self.fetch("""
            SELECT
                q.id, q.startup_id, q.priority, q.reason,
                q.research_depth, q.focus_areas, q.retry_count, q.queued_at,
                s.name as startup_name, s.website as startup_website,
                s.description as startup_description
            FROM deep_research_queue q
            JOIN startups s ON q.startup_id = s.id
            WHERE q.status = 'pending'
            ORDER BY q.priority ASC, q.queued_at ASC
            LIMIT $1
        """, limit)
        return [dict(r) for r in rows]

    async def claim_research_item(self, item_id: str) -> bool:
        """Claim a research item for processing (atomic operation)."""
        result = await self.execute("""
            UPDATE deep_research_queue
            SET status = 'processing',
                started_at = $2
            WHERE id = $1 AND status = 'pending'
        """, item_id, datetime.now(timezone.utc))
        return "UPDATE 1" in result

    async def complete_research_item(
        self,
        item_id: str,
        research_output: Dict[str, Any],
        tokens_used: int = 0,
        cost_usd: float = 0.0
    ):
        """Mark a research item as completed."""
        import json
        await self.execute("""
            UPDATE deep_research_queue
            SET status = 'completed',
                completed_at = $2,
                research_output = $3,
                tokens_used = $4,
                cost_usd = $5
            WHERE id = $1
        """, item_id, datetime.now(timezone.utc),
             json.dumps(research_output), tokens_used, cost_usd)

    async def fail_research_item(self, item_id: str, error_message: str):
        """Mark a research item as failed."""
        await self.execute("""
            UPDATE deep_research_queue
            SET status = 'failed',
                completed_at = $2,
                error_message = $3,
                retry_count = retry_count + 1
            WHERE id = $1
        """, item_id, datetime.now(timezone.utc), error_message)

    async def requeue_failed_item(self, item_id: str, max_retries: int = 3) -> bool:
        """Requeue a failed item if under retry limit."""
        result = await self.execute("""
            UPDATE deep_research_queue
            SET status = 'pending',
                started_at = NULL,
                error_message = NULL,
                priority = priority + 1
            WHERE id = $1 AND retry_count < $2
        """, item_id, max_retries)
        return "UPDATE 1" in result

    async def enqueue_research(
        self,
        startup_id: str,
        reason: str,
        priority: int = 5,
        research_depth: str = "standard",
        focus_areas: Optional[List[str]] = None
    ) -> str:
        """Add a startup to the research queue."""
        import json
        item_id = await self.fetchval("""
            INSERT INTO deep_research_queue
                (startup_id, priority, reason, research_depth, focus_areas)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT DO NOTHING
            RETURNING id
        """, startup_id, priority, reason, research_depth,
             json.dumps(focus_areas) if focus_areas else None)
        return str(item_id) if item_id else None

    # =========================================================================
    # Startup Operations
    # =========================================================================

    async def get_startups_for_monitoring(self, limit: int = 100) -> List[Dict[str, Any]]:
        """Get startups that need website monitoring."""
        rows = await self.fetch("""
            SELECT id, name, website, content_hash, last_crawl_at, last_content_sample
            FROM startups
            WHERE website IS NOT NULL
            ORDER BY last_crawl_at ASC NULLS FIRST
            LIMIT $1
        """, limit)
        return [dict(r) for r in rows]

    async def update_startup_content_hash(
        self,
        startup_id: str,
        content_hash: str,
        crawl_success: bool = True,
        canonical_url: Optional[str] = None,
        content_changed: bool = False
    ):
        """Update a startup's content hash after crawl.

        Also updates change tracking fields:
        - change_rate: Exponential moving average of change frequency
        - last_changed_at: When content last changed
        - consecutive_unchanged: Count of consecutive unchanged crawls
        """
        now = datetime.now(timezone.utc)

        # Build dynamic update based on content change
        if content_changed:
            await self.execute("""
                UPDATE startups
                SET content_hash = $2,
                    last_crawl_at = $3,
                    crawl_success_rate = CASE
                        WHEN crawl_success_rate IS NULL THEN $4::decimal
                        ELSE (crawl_success_rate * 0.9 + $4::decimal * 0.1)
                    END,
                    canonical_url = COALESCE($5, canonical_url),
                    last_changed_at = $3,
                    change_rate = COALESCE(change_rate, 0) * 0.8 + 0.2,
                    consecutive_unchanged = 0
                WHERE id = $1
            """, startup_id, content_hash, now,
                 1.0 if crawl_success else 0.0, canonical_url)
        else:
            await self.execute("""
                UPDATE startups
                SET content_hash = $2,
                    last_crawl_at = $3,
                    crawl_success_rate = CASE
                        WHEN crawl_success_rate IS NULL THEN $4::decimal
                        ELSE (crawl_success_rate * 0.9 + $4::decimal * 0.1)
                    END,
                    canonical_url = COALESCE($5, canonical_url),
                    change_rate = COALESCE(change_rate, 0) * 0.8,
                    consecutive_unchanged = COALESCE(consecutive_unchanged, 0) + 1
                WHERE id = $1
            """, startup_id, content_hash, now,
                 1.0 if crawl_success else 0.0, canonical_url)

    async def update_startup_content_sample(
        self,
        startup_id: str,
        content_sample: str,
    ) -> None:
        """Store first 2000 chars of crawl text for diff analysis."""
        await self.execute(
            "UPDATE startups SET last_content_sample = $2 WHERE id = $1",
            startup_id, content_sample[:2000],
        )

    async def find_startup_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """Find a startup by name (case-insensitive)."""
        row = await self.fetchrow("""
            SELECT id, name, website, description, content_hash
            FROM startups
            WHERE LOWER(name) = LOWER($1)
        """, name)
        return dict(row) if row else None

    async def get_all_startups_with_patterns(self) -> List[Dict[str, Any]]:
        """Get all startups with their patterns for correlation analysis."""
        rows = await self.fetch("""
            SELECT
                s.id, s.name, s.pattern,
                SUM(fr.amount_usd) as total_funding
            FROM startups s
            LEFT JOIN funding_rounds fr ON fr.startup_id = s.id
            WHERE s.pattern IS NOT NULL
            GROUP BY s.id, s.name, s.pattern
        """)
        return [dict(r) for r in rows]

    # =========================================================================
    # Pattern Correlation Operations
    # =========================================================================

    async def upsert_pattern_correlation(
        self,
        pattern_a: str,
        pattern_b: str,
        period: str,
        co_occurrence_count: int,
        total_a: int,
        total_b: int,
        avg_funding_both: Optional[int],
        avg_funding_a_only: Optional[int],
        avg_funding_b_only: Optional[int],
        correlation_coefficient: float,
        lift_score: float
    ):
        """Insert or update a pattern correlation."""
        await self.execute("""
            INSERT INTO pattern_correlations
                (pattern_a, pattern_b, period, co_occurrence_count,
                 total_startups_with_a, total_startups_with_b,
                 avg_funding_with_both, avg_funding_with_a_only, avg_funding_with_b_only,
                 correlation_coefficient, lift_score, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (pattern_a, pattern_b, period)
            DO UPDATE SET
                co_occurrence_count = $4,
                total_startups_with_a = $5,
                total_startups_with_b = $6,
                avg_funding_with_both = $7,
                avg_funding_with_a_only = $8,
                avg_funding_with_b_only = $9,
                correlation_coefficient = $10,
                lift_score = $11,
                updated_at = $12
        """, pattern_a, pattern_b, period, co_occurrence_count,
             total_a, total_b, avg_funding_both, avg_funding_a_only, avg_funding_b_only,
             correlation_coefficient, lift_score, datetime.now(timezone.utc))

    # =========================================================================
    # Crawl Log Operations
    # =========================================================================

    async def log_crawl(
        self,
        startup_id: str,
        source_type: str,
        url: str,
        status: str,
        http_status: Optional[int] = None,
        error_message: Optional[str] = None,
        content_length: Optional[int] = None,
        duration_ms: Optional[int] = None,
        canonical_url: Optional[str] = None,
        quality_score: Optional[float] = None,
        content_type: Optional[str] = None,
        error_category: Optional[str] = None,
        capture_id: Optional[str] = None,
    ):
        """Log a crawl attempt with enhanced metadata.

        Args:
            startup_id: ID of the startup
            source_type: Type of source (website, blog, docs, etc.)
            url: URL that was crawled
            status: Status of crawl (success, failed)
            http_status: HTTP response status code
            error_message: Error message if failed
            content_length: Length of content in bytes
            duration_ms: Request duration in milliseconds
            canonical_url: Canonical form of URL
            quality_score: Content quality score (0-1)
            content_type: How content was fetched (static, js_rendered)
            error_category: Error type (transient, permanent, rate_limited, etc.)
            capture_id: Optional replay-capture reference
        """
        await self.execute("""
            INSERT INTO crawl_logs
                (startup_id, source_type, url, status, http_status,
                 error_message, content_length, duration_ms,
                 crawl_started_at, crawl_completed_at,
                 canonical_url, quality_score, content_type, error_category, capture_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11, $12, $13, $14::uuid)
        """, startup_id, source_type, url, status, http_status,
             error_message, content_length, duration_ms,
             datetime.now(timezone.utc),
             canonical_url, quality_score, content_type, error_category, capture_id)

    # =========================================================================
    # Domain Stats Operations (for throttling)
    # =========================================================================

    async def get_domain_stats(self, domain: str) -> Optional[Dict[str, Any]]:
        """Get stats for a domain."""
        row = await self.fetchrow("""
            SELECT * FROM domain_stats WHERE domain = $1
        """, domain)
        return dict(row) if row else None

    async def upsert_domain_stats(
        self,
        domain: str,
        next_allowed_at: Optional[datetime] = None,
        in_flight_count: int = 0,
        crawl_delay_ms: int = 2000,
        error_rate: float = 0.0,
        requires_js: bool = False,
        avg_response_ms: Optional[int] = None
    ):
        """Insert or update domain stats."""
        now = datetime.now(timezone.utc)
        await self.execute("""
            INSERT INTO domain_stats
                (domain, next_allowed_at, in_flight_count, crawl_delay_ms,
                 error_rate, requires_js, avg_response_ms, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (domain) DO UPDATE SET
                next_allowed_at = COALESCE($2, domain_stats.next_allowed_at),
                in_flight_count = $3,
                crawl_delay_ms = $4,
                error_rate = $5,
                requires_js = $6,
                avg_response_ms = COALESCE($7, domain_stats.avg_response_ms),
                updated_at = $8
        """, domain, next_allowed_at or now, in_flight_count, crawl_delay_ms,
             error_rate, requires_js, avg_response_ms, now)

    async def increment_domain_in_flight(self, domain: str) -> bool:
        """Atomically increment in_flight_count and check if allowed.

        Returns True if crawl is allowed, False if rate limited.
        Ensures the domain row exists before attempting the atomic UPDATE,
        so first-time crawls for new domains are not silently blocked.
        """
        # Ensure domain row exists (no-op if already present)
        await self.execute("""
            INSERT INTO domain_stats (domain, in_flight_count, crawl_delay_ms)
            VALUES ($1, 0, 2000)
            ON CONFLICT (domain) DO NOTHING
        """, domain)

        # Atomic claim: only increments if under concurrency limit and not rate-limited
        result = await self.fetchrow("""
            UPDATE domain_stats
            SET in_flight_count = in_flight_count + 1,
                updated_at = NOW()
            WHERE domain = $1
              AND in_flight_count < 2
              AND (next_allowed_at IS NULL OR next_allowed_at <= NOW())
            RETURNING domain
        """, domain)
        return result is not None

    async def release_domain_slot(
        self,
        domain: str,
        success: bool,
        status_code: int,
        delay_ms: int = 2000
    ):
        """Release a domain slot and update stats after request."""
        next_allowed = datetime.now(timezone.utc)
        await self.execute("""
            UPDATE domain_stats
            SET
                in_flight_count = GREATEST(0, in_flight_count - 1),
                next_allowed_at = $2 + INTERVAL '1 millisecond' * $3,
                error_rate = CASE
                    WHEN $4 THEN COALESCE(error_rate, 0) * 0.9
                    ELSE LEAST(1.0, COALESCE(error_rate, 0) * 0.9 + 0.1)
                END,
                last_429_at = CASE WHEN $5 = 429 THEN NOW() ELSE last_429_at END,
                total_requests = COALESCE(total_requests, 0) + 1,
                successful_requests = CASE
                    WHEN $4 THEN COALESCE(successful_requests, 0) + 1
                    ELSE successful_requests
                END,
                updated_at = NOW()
            WHERE domain = $1
        """, domain, next_allowed, delay_ms, success, status_code)

    async def mark_domain_requires_js(self, domain: str, requires_js: bool = True):
        """Mark a domain as requiring JavaScript rendering."""
        await self.execute("""
            INSERT INTO domain_stats (domain, requires_js, crawl_delay_ms)
            VALUES ($1, $2, 2000)
            ON CONFLICT (domain) DO UPDATE
            SET requires_js = $2, updated_at = NOW()
        """, domain, requires_js)

    async def get_domain_requires_js(self, domain: str) -> bool:
        """Check if a domain requires JavaScript rendering."""
        result = await self.fetchval("""
            SELECT requires_js FROM domain_stats WHERE domain = $1
        """, domain)
        return result or False

    async def get_domains_ready_to_crawl(self, limit: int = 100) -> List[str]:
        """Get domains that are ready for crawling (not rate limited)."""
        rows = await self.fetch("""
            SELECT domain FROM domain_stats
            WHERE (next_allowed_at IS NULL OR next_allowed_at <= NOW())
              AND in_flight_count < 2
              AND error_rate < 0.8
            ORDER BY next_allowed_at ASC NULLS FIRST
            LIMIT $1
        """, limit)
        return [r['domain'] for r in rows]
