"""Frontier persistence and prioritization for modern crawling."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

try:
    import asyncpg
except Exception:  # pragma: no cover - optional at import time
    asyncpg = None

TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "gclid", "fbclid", "msclkid", "ref", "source", "campaign",
}


def canonicalize_url(url: str) -> str:
    if not url:
        return ""
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"
    parsed = urlparse(url)
    scheme = "https"
    host = parsed.netloc.lower().removeprefix("www.")
    path = parsed.path or "/"
    if path != "/" and path.endswith("/"):
        path = path[:-1]
    query_pairs = [
        (k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=False)
        if k.lower() not in TRACKING_PARAMS
    ]
    query_pairs.sort(key=lambda x: (x[0], x[1]))
    query = urlencode(query_pairs)
    return urlunparse((scheme, host, path, "", query, ""))


def extract_domain(url: str) -> str:
    if not url:
        return ""
    parsed = urlparse(url if "://" in url else f"https://{url}")
    host = parsed.netloc.lower().removeprefix("www.")
    return host.split(":")[0]


@dataclass
class FrontierUrl:
    startup_slug: str
    url: str
    canonical_url: str
    domain: str
    page_type: str
    priority_score: int
    next_crawl_at: datetime
    content_hash: Optional[str] = None
    etag: Optional[str] = None
    last_modified: Optional[str] = None


HIGH_PRIORITY_HINTS = {
    "pricing": 100,
    "docs": 95,
    "changelog": 90,
    "security": 85,
    "api": 85,
    "careers": 70,
    "blog": 60,
    "news": 55,
    "generic": 40,
}


def classify_page_type(url: str) -> str:
    path = canonicalize_url(url)
    if not path:
        return "generic"

    lower = path.lower()
    if any(x in lower for x in ["/pricing", "plans"]):
        return "pricing"
    if any(x in lower for x in ["/docs", "/documentation", "/developer", "/api", "/reference"]):
        return "docs"
    if any(x in lower for x in ["changelog", "release", "updates", "what's-new"]):
        return "changelog"
    if any(x in lower for x in ["security", "trust", "compliance"]):
        return "security"
    if any(x in lower for x in ["careers", "jobs", "hiring"]):
        return "careers"
    if any(x in lower for x in ["/blog", "/engineering", "/insights"]):
        return "blog"
    if any(x in lower for x in ["/news", "/press"]):
        return "news"
    return "generic"


def score_frontier_priority(page_type: str, change_rate: float = 0.0, is_new: bool = False) -> int:
    base = HIGH_PRIORITY_HINTS.get(page_type, 40)
    change_boost = int(max(0.0, min(change_rate, 1.0)) * 20)
    new_boost = 10 if is_new else 0
    return min(120, base + change_boost + new_boost)


class UrlFrontierStore:
    """Postgres-backed frontier queue with graceful no-op fallback."""

    def __init__(self, database_url: Optional[str] = None):
        self.database_url = database_url
        self.pool = None

    async def connect(self):
        if self.pool or not self.database_url or asyncpg is None:
            return
        self.pool = await asyncpg.create_pool(self.database_url, min_size=1, max_size=5)

    async def close(self):
        if self.pool:
            await self.pool.close()
            self.pool = None

    @property
    def enabled(self) -> bool:
        return self.pool is not None

    async def enqueue_urls(
        self,
        startup_slug: str,
        urls: Iterable[str],
        default_change_rate: float = 0.0,
    ) -> int:
        """Upsert URLs and queue them for crawl."""
        if not self.pool:
            return 0

        count = 0
        now = datetime.now(timezone.utc)

        async with self.pool.acquire() as conn:
            for raw_url in urls:
                canonical = canonicalize_url(raw_url)
                if not canonical:
                    continue

                domain = extract_domain(canonical)
                if not domain:
                    continue

                page_type = classify_page_type(canonical)
                priority = score_frontier_priority(page_type, default_change_rate, is_new=True)

                await conn.execute(
                    """
                    INSERT INTO crawl_frontier_urls (
                        startup_slug, url, canonical_url, domain, page_type,
                        priority_score, next_crawl_at, discovered_at, updated_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
                    ON CONFLICT (canonical_url) DO UPDATE
                    SET startup_slug = EXCLUDED.startup_slug,
                        page_type = EXCLUDED.page_type,
                        priority_score = GREATEST(crawl_frontier_urls.priority_score, EXCLUDED.priority_score),
                        updated_at = NOW()
                    """,
                    startup_slug,
                    raw_url,
                    canonical,
                    domain,
                    page_type,
                    priority,
                    now,
                )

                await conn.execute(
                    """
                    INSERT INTO crawl_frontier_queue (canonical_url, available_at, lease_attempts)
                    VALUES ($1, NOW(), 0)
                    ON CONFLICT (canonical_url) DO UPDATE
                    SET available_at = LEAST(crawl_frontier_queue.available_at, NOW())
                    """,
                    canonical,
                )
                count += 1

        return count

    async def lease_urls(self, limit: int, worker_id: str) -> List[FrontierUrl]:
        """Lease due URLs for worker execution."""
        if not self.pool or limit <= 0:
            return []

        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                WITH due AS (
                    SELECT q.canonical_url
                    FROM crawl_frontier_queue q
                    JOIN crawl_frontier_urls u ON u.canonical_url = q.canonical_url
                    WHERE q.leased_at IS NULL
                      AND q.available_at <= NOW()
                      AND u.next_crawl_at <= NOW()
                    ORDER BY u.priority_score DESC, q.available_at ASC
                    LIMIT $1
                    FOR UPDATE SKIP LOCKED
                )
                UPDATE crawl_frontier_queue q
                SET leased_at = NOW(),
                    lease_owner = $2,
                    lease_attempts = q.lease_attempts + 1
                FROM due
                WHERE q.canonical_url = due.canonical_url
                RETURNING q.canonical_url
                """,
                limit,
                worker_id,
            )

            if not rows:
                return []

            canonical_urls = [r["canonical_url"] for r in rows]
            detail_rows = await conn.fetch(
                """
                SELECT
                    startup_slug, url, canonical_url, domain, page_type, priority_score,
                    next_crawl_at, content_hash, etag, last_modified
                FROM crawl_frontier_urls
                WHERE canonical_url = ANY($1::text[])
                """,
                canonical_urls,
            )

        return [
            FrontierUrl(
                startup_slug=r["startup_slug"],
                url=r["url"],
                canonical_url=r["canonical_url"],
                domain=r["domain"],
                page_type=r["page_type"],
                priority_score=r["priority_score"],
                next_crawl_at=r["next_crawl_at"],
                content_hash=r["content_hash"],
                etag=r["etag"],
                last_modified=r["last_modified"],
            )
            for r in detail_rows
        ]

    async def mark_crawled(
        self,
        canonical_url: str,
        status_code: int,
        content_hash: Optional[str],
        etag: Optional[str],
        last_modified: Optional[str],
        changed: bool,
        response_time_ms: int,
    ) -> None:
        if not self.pool:
            return

        next_delay = timedelta(days=1)
        if not changed:
            next_delay = timedelta(days=7)
        if status_code >= 400:
            next_delay = timedelta(hours=6)
        next_delay_seconds = int(next_delay.total_seconds())

        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE crawl_frontier_urls
                SET last_status_code = $2,
                    content_hash = COALESCE($3, content_hash),
                    etag = COALESCE($4, etag),
                    last_modified = COALESCE($5, last_modified),
                    last_crawled_at = NOW(),
                    next_crawl_at = NOW() + make_interval(secs => $6),
                    change_rate = CASE
                        WHEN $7 THEN LEAST(1.0, COALESCE(change_rate, 0) * 0.8 + 0.2)
                        ELSE COALESCE(change_rate, 0) * 0.8
                    END,
                    last_response_ms = $8,
                    updated_at = NOW()
                WHERE canonical_url = $1
                """,
                canonical_url,
                status_code,
                content_hash,
                etag,
                last_modified,
                next_delay_seconds,
                changed,
                response_time_ms,
            )

            # Keep URL in queue for recurring crawl; just release lease and schedule next execution.
            await conn.execute(
                """
                INSERT INTO crawl_frontier_queue (canonical_url, available_at, leased_at, lease_owner, updated_at)
                VALUES ($1, NOW() + make_interval(secs => $2), NULL, NULL, NOW())
                ON CONFLICT (canonical_url) DO UPDATE
                SET available_at = NOW() + make_interval(secs => $2),
                    leased_at = NULL,
                    lease_owner = NULL,
                    updated_at = NOW()
                """,
                canonical_url,
                next_delay_seconds,
            )

    async def requeue_failed(self, canonical_url: str, backoff_seconds: int = 300) -> None:
        if not self.pool:
            return

        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE crawl_frontier_queue
                SET leased_at = NULL,
                    lease_owner = NULL,
                    available_at = NOW() + make_interval(secs => $2),
                    updated_at = NOW()
                WHERE canonical_url = $1
                """,
                canonical_url,
                max(30, backoff_seconds),
            )

    async def recover_stale_leases(self, max_lease_minutes: int = 30) -> int:
        """Release stale leases for crashed workers so URLs can be retried."""
        if not self.pool:
            return 0

        async with self.pool.acquire() as conn:
            result = await conn.execute(
                """
                UPDATE crawl_frontier_queue
                SET leased_at = NULL,
                    lease_owner = NULL,
                    available_at = NOW(),
                    updated_at = NOW()
                WHERE leased_at IS NOT NULL
                  AND leased_at < NOW() - make_interval(mins => $1)
                """,
                max(5, max_lease_minutes),
            )
        try:
            return int(result.split()[-1])
        except Exception:
            return 0


def compute_next_recrawl(change_rate: float, page_type: str) -> datetime:
    """Adaptive recrawl policy based on page type and observed change rate."""
    now = datetime.now(timezone.utc)
    if page_type in {"pricing", "changelog"}:
        base = timedelta(days=1)
    elif page_type in {"docs", "security"}:
        base = timedelta(days=3)
    else:
        base = timedelta(days=7)

    if change_rate >= 0.7:
        base = max(timedelta(hours=12), base / 2)
    elif change_rate <= 0.1:
        base = min(timedelta(days=30), base * 2)

    return now + base
