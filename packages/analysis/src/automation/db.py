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
                min_size=1,
                max_size=10,
                command_timeout=60
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
            SELECT id, name, website, content_hash, last_crawl_at
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
        crawl_success: bool = True
    ):
        """Update a startup's content hash after crawl."""
        await self.execute("""
            UPDATE startups
            SET content_hash = $2,
                last_crawl_at = $3,
                crawl_success_rate = CASE
                    WHEN crawl_success_rate IS NULL THEN $4::decimal
                    ELSE (crawl_success_rate * 0.9 + $4::decimal * 0.1)
                END
            WHERE id = $1
        """, startup_id, content_hash, datetime.now(timezone.utc),
             1.0 if crawl_success else 0.0)

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
                (SELECT SUM(fr.amount_usd) FROM funding_rounds fr WHERE fr.startup_id = s.id) as total_funding
            FROM startups s
            WHERE s.pattern IS NOT NULL
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
        duration_ms: Optional[int] = None
    ):
        """Log a crawl attempt."""
        await self.execute("""
            INSERT INTO crawl_logs
                (startup_id, source_type, url, status, http_status,
                 error_message, content_length, duration_ms,
                 crawl_started_at, crawl_completed_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
        """, startup_id, source_type, url, status, http_status,
             error_message, content_length, duration_ms,
             datetime.now(timezone.utc))
