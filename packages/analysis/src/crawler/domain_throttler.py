"""Per-Domain Rate Limiting for Crawler.

Provides fair, polite crawling by:
- Limiting concurrent requests per domain
- Adaptive backoff on errors
- Domain capability caching (JS requirement detection)
- Rate limit (429) handling
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple, Dict, Any
import asyncpg

from .url_normalizer import extract_domain

logger = logging.getLogger(__name__)


class DomainThrottler:
    """Per-domain rate limiting with adaptive backoff.

    Features:
    - Max concurrent requests per domain (default: 2)
    - Configurable crawl delay per domain
    - Exponential backoff on errors
    - Tracks domain capabilities (requires_js)
    - Handles 429 rate limit responses specially

    Usage:
        throttler = DomainThrottler(pool, default_delay_ms=2000)

        # Before crawling
        can_crawl, wait_ms = await throttler.can_crawl(url)
        if not can_crawl:
            await asyncio.sleep(wait_ms / 1000)

        try:
            result = await do_crawl(url)
        finally:
            await throttler.release(url, success=True, status_code=200)
    """

    def __init__(
        self,
        pool: asyncpg.Pool,
        default_delay_ms: int = 2000,
        max_concurrent_per_domain: int = 2,
        rate_limit_backoff_ms: int = 30000,
        error_backoff_ms: int = 10000,
    ):
        """Initialize the domain throttler.

        Args:
            pool: asyncpg connection pool
            default_delay_ms: Default delay between requests to same domain
            max_concurrent_per_domain: Max concurrent requests per domain
            rate_limit_backoff_ms: Backoff time on 429 responses
            error_backoff_ms: Backoff time on server errors
        """
        self.pool = pool
        self.default_delay = default_delay_ms
        self.max_concurrent = max_concurrent_per_domain
        self.rate_limit_backoff = rate_limit_backoff_ms
        self.error_backoff = error_backoff_ms

        # In-memory tracking for domains not yet in DB
        self._local_locks: Dict[str, asyncio.Lock] = {}
        self._local_in_flight: Dict[str, int] = {}

    async def can_crawl(self, url: str) -> Tuple[bool, int]:
        """Check if domain is ready for crawling.

        Args:
            url: URL to crawl

        Returns:
            Tuple of (can_crawl, wait_ms). If can_crawl is False,
            wait_ms indicates how long to wait before retrying.
        """
        domain = extract_domain(url)
        if not domain:
            return True, 0

        try:
            async with self.pool.acquire() as conn:
                # Ensure domain row exists (no-op if already present)
                await conn.execute("""
                    INSERT INTO domain_stats (domain, in_flight_count, crawl_delay_ms)
                    VALUES ($1, 0, $2)
                    ON CONFLICT (domain) DO NOTHING
                """, domain, self.default_delay)

                # Atomic check-and-claim: single UPDATE with all conditions
                # Prevents race condition where separate SELECT + UPDATE allowed
                # multiple workers to exceed max_concurrent_per_domain
                result = await conn.fetchrow("""
                    UPDATE domain_stats
                    SET in_flight_count = in_flight_count + 1,
                        updated_at = NOW()
                    WHERE domain = $1
                      AND in_flight_count < $2
                      AND (next_allowed_at IS NULL OR next_allowed_at <= NOW())
                    RETURNING in_flight_count, next_allowed_at, crawl_delay_ms
                """, domain, self.max_concurrent)

                if result:
                    return True, 0

                # Claim failed — read current state to determine wait time
                row = await conn.fetchrow("""
                    SELECT next_allowed_at, in_flight_count, crawl_delay_ms
                    FROM domain_stats WHERE domain = $1
                """, domain)

                now = datetime.now(timezone.utc)
                if row and row['next_allowed_at'] and row['next_allowed_at'] > now:
                    wait_ms = int((row['next_allowed_at'] - now).total_seconds() * 1000)
                    return False, max(wait_ms, 0)

                delay = (row['crawl_delay_ms'] if row else None) or self.default_delay
                return False, delay

        except Exception as e:
            logger.warning(f"Error checking domain throttle for {domain}: {e}")
            # Fall back to local tracking
            return await self._can_crawl_local(domain)

    async def _can_crawl_local(self, domain: str) -> Tuple[bool, int]:
        """Local fallback when DB is unavailable."""
        if domain not in self._local_locks:
            self._local_locks[domain] = asyncio.Lock()
            self._local_in_flight[domain] = 0

        async with self._local_locks[domain]:
            if self._local_in_flight[domain] >= self.max_concurrent:
                return False, self.default_delay

            self._local_in_flight[domain] += 1
            return True, 0

    async def release(
        self,
        url: str,
        success: bool,
        status_code: int = 200,
        response_time_ms: Optional[int] = None
    ):
        """Release domain slot and update stats after request completes.

        Args:
            url: URL that was crawled
            success: Whether the request succeeded
            status_code: HTTP status code
            response_time_ms: Optional response time in milliseconds
        """
        domain = extract_domain(url)
        if not domain:
            return

        # Calculate appropriate delay for next request
        delay_ms = self.default_delay

        if status_code == 429:
            # Rate limited - longer backoff
            delay_ms = self.rate_limit_backoff
            logger.warning(f"Rate limited by {domain}, backing off {delay_ms}ms")
        elif status_code >= 500:
            # Server error - medium backoff
            delay_ms = self.error_backoff
        elif not success:
            # Network/timeout error
            delay_ms = self.error_backoff

        next_allowed = datetime.now(timezone.utc) + timedelta(milliseconds=delay_ms)

        try:
            async with self.pool.acquire() as conn:
                # Update stats with exponential moving average for error_rate
                await conn.execute("""
                    UPDATE domain_stats
                    SET
                        in_flight_count = GREATEST(0, in_flight_count - 1),
                        next_allowed_at = $2,
                        error_rate = CASE
                            WHEN $3 THEN COALESCE(error_rate, 0) * 0.9
                            ELSE LEAST(1.0, COALESCE(error_rate, 0) * 0.9 + 0.1)
                        END,
                        last_429_at = CASE WHEN $4 = 429 THEN NOW() ELSE last_429_at END,
                        avg_response_ms = CASE
                            WHEN $5 IS NOT NULL THEN
                                COALESCE((COALESCE(avg_response_ms, $5) * 0.8 + $5 * 0.2)::INT, $5)
                            ELSE avg_response_ms
                        END,
                        updated_at = NOW()
                    WHERE domain = $1
                """, domain, next_allowed, success, status_code, response_time_ms)

        except Exception as e:
            logger.warning(f"Error releasing domain throttle for {domain}: {e}")
            # Update local tracking
            if domain in self._local_in_flight:
                self._local_in_flight[domain] = max(0, self._local_in_flight[domain] - 1)

    async def get_domain_requires_js(self, domain: str) -> bool:
        """Check if a domain is known to require JavaScript rendering.

        Args:
            domain: Domain to check

        Returns:
            True if domain requires JS rendering
        """
        try:
            async with self.pool.acquire() as conn:
                result = await conn.fetchval("""
                    SELECT requires_js FROM domain_stats WHERE domain = $1
                """, domain)
                return result or False
        except Exception:
            return False

    async def mark_domain_requires_js(self, domain: str, requires_js: bool = True):
        """Mark a domain as requiring JavaScript rendering.

        Args:
            domain: Domain to mark
            requires_js: Whether JS is required
        """
        try:
            async with self.pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO domain_stats (domain, requires_js, crawl_delay_ms)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (domain) DO UPDATE
                    SET requires_js = $2, updated_at = NOW()
                """, domain, requires_js, self.default_delay)
        except Exception as e:
            logger.warning(f"Error marking domain JS requirement for {domain}: {e}")

    async def get_domain_stats(self, domain: str) -> Optional[Dict[str, Any]]:
        """Get full stats for a domain.

        Args:
            domain: Domain to get stats for

        Returns:
            Dict with domain stats or None if not found
        """
        try:
            async with self.pool.acquire() as conn:
                row = await conn.fetchrow("""
                    SELECT *
                    FROM domain_stats
                    WHERE domain = $1
                """, domain)
                return dict(row) if row else None
        except Exception:
            return None

    async def update_crawl_delay(self, domain: str, delay_ms: int):
        """Update the crawl delay for a domain.

        Use this to respect robots.txt Crawl-delay directive.

        Args:
            domain: Domain to update
            delay_ms: New crawl delay in milliseconds
        """
        try:
            async with self.pool.acquire() as conn:
                await conn.execute("""
                    UPDATE domain_stats
                    SET crawl_delay_ms = $2, updated_at = NOW()
                    WHERE domain = $1
                """, domain, delay_ms)
        except Exception as e:
            logger.warning(f"Error updating crawl delay for {domain}: {e}")

    async def reset_domain(self, domain: str):
        """Reset all throttling state for a domain.

        Useful after prolonged downtime or when manually clearing rate limits.

        Args:
            domain: Domain to reset
        """
        try:
            async with self.pool.acquire() as conn:
                await conn.execute("""
                    UPDATE domain_stats
                    SET
                        in_flight_count = 0,
                        next_allowed_at = NOW(),
                        error_rate = 0,
                        last_429_at = NULL,
                        updated_at = NOW()
                    WHERE domain = $1
                """, domain)
        except Exception as e:
            logger.warning(f"Error resetting domain {domain}: {e}")

        # Also reset local tracking
        if domain in self._local_in_flight:
            self._local_in_flight[domain] = 0


class ThrottledCrawlContext:
    """Context manager for throttled crawling.

    Usage:
        async with ThrottledCrawlContext(throttler, url) as can_proceed:
            if can_proceed:
                result = await do_crawl(url)
            else:
                # Handle skip/retry
                pass
    """

    def __init__(
        self,
        throttler: DomainThrottler,
        url: str,
        max_wait_ms: int = 10000
    ):
        self.throttler = throttler
        self.url = url
        self.max_wait_ms = max_wait_ms
        self._can_proceed = False
        self._claimed = False

    async def __aenter__(self) -> bool:
        """Try to acquire crawl permission."""
        total_waited = 0

        while total_waited < self.max_wait_ms:
            can_crawl, wait_ms = await self.throttler.can_crawl(self.url)

            if can_crawl:
                self._claimed = True
                self._can_proceed = True
                return True

            if wait_ms > 0 and total_waited + wait_ms <= self.max_wait_ms:
                await asyncio.sleep(wait_ms / 1000)
                total_waited += wait_ms
            else:
                break

        return False

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Release crawl permission."""
        if self._claimed:
            success = exc_type is None
            await self.throttler.release(self.url, success=success)
