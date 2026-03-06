"""Frontier persistence and prioritization for modern crawling."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from src.config import settings

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


@dataclass
class DomainPolicy:
    domain: str
    respect_robots: bool = True
    crawl_delay_ms: int = 1500
    max_concurrent: int = 2
    blocked: bool = False
    proxy_tier: str = "datacenter"
    render_required: bool = False
    block_rate: float = 0.0
    consecutive_blocks: int = 0


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
        domain_cap = max(1, int(settings.crawler.frontier_domain_cap))

        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                WITH due AS (
                    SELECT q2.canonical_url
                    FROM (
                        SELECT
                            q.canonical_url,
                            u.domain,
                            u.priority_score,
                            q.available_at,
                            ROW_NUMBER() OVER (
                                PARTITION BY u.domain
                                ORDER BY u.priority_score DESC, q.available_at ASC
                            ) AS domain_rank
                        FROM crawl_frontier_queue q
                        JOIN crawl_frontier_urls u ON u.canonical_url = q.canonical_url
                        WHERE q.leased_at IS NULL
                          AND q.available_at <= NOW()
                          AND u.next_crawl_at <= NOW()
                          AND q.lease_attempts < 10
                          AND NOT EXISTS (
                              SELECT 1
                              FROM domain_policies p
                              WHERE p.domain = u.domain
                                AND p.blocked = TRUE
                          )
                    ) ranked
                    JOIN crawl_frontier_queue q2
                      ON q2.canonical_url = ranked.canonical_url
                    WHERE ranked.domain_rank <= $3
                    ORDER BY ranked.priority_score DESC, ranked.available_at ASC
                    LIMIT $1
                    FOR UPDATE OF q2 SKIP LOCKED
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
                domain_cap,
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

    async def get_domain_policy(self, domain: str) -> DomainPolicy:
        if not self.pool or not domain:
            return DomainPolicy(domain=domain or "")

        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT
                    domain, respect_robots, crawl_delay_ms, max_concurrent,
                    blocked, proxy_tier, render_required,
                    COALESCE(block_rate, 0) AS block_rate,
                    COALESCE(consecutive_blocks, 0) AS consecutive_blocks
                FROM domain_policies
                WHERE domain = $1
                """,
                domain,
            )

            if row is None:
                await conn.execute(
                    """
                    INSERT INTO domain_policies (
                        domain, respect_robots, crawl_delay_ms, max_concurrent, blocked,
                        proxy_tier, render_required, block_rate, consecutive_blocks, updated_at
                    )
                    VALUES ($1, TRUE, 1500, 2, FALSE, 'datacenter', FALSE, 0, 0, NOW())
                    ON CONFLICT (domain) DO NOTHING
                    """,
                    domain,
                )
                return DomainPolicy(domain=domain)

            return DomainPolicy(
                domain=row["domain"],
                respect_robots=bool(row["respect_robots"]),
                crawl_delay_ms=int(row["crawl_delay_ms"]),
                max_concurrent=int(row["max_concurrent"]),
                blocked=bool(row["blocked"]),
                proxy_tier=str(row["proxy_tier"] or "datacenter"),
                render_required=bool(row["render_required"]),
                block_rate=float(row["block_rate"] or 0.0),
                consecutive_blocks=int(row["consecutive_blocks"] or 0),
            )

    async def upsert_domain_policy(
        self,
        domain: str,
        *,
        render_required: Optional[bool] = None,
        proxy_tier: Optional[str] = None,
        blocked: Optional[bool] = None,
    ) -> None:
        if not self.pool or not domain:
            return

        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO domain_policies (
                    domain, render_required, proxy_tier, blocked, updated_at
                )
                VALUES (
                    $1, COALESCE($2, FALSE), COALESCE($3, 'datacenter'), COALESCE($4, FALSE), NOW()
                )
                ON CONFLICT (domain) DO UPDATE
                SET render_required = COALESCE($2, domain_policies.render_required),
                    proxy_tier = COALESCE($3, domain_policies.proxy_tier),
                    blocked = COALESCE($4, domain_policies.blocked),
                    updated_at = NOW()
                """,
                domain,
                render_required,
                proxy_tier,
                blocked,
            )

    @staticmethod
    def _compute_next_delay_seconds(
        *,
        changed: bool,
        status_code: int,
        quality_score: float,
        blocked_detected: bool,
    ) -> int:
        # Conservative ramp: boost quality/high-change pages, but avoid starvation.
        if status_code == 304:
            base = timedelta(days=7)
        elif status_code >= 500:
            base = timedelta(hours=24)
        elif status_code >= 400:
            base = timedelta(hours=8)
        else:
            base = timedelta(days=1 if changed else 7)

        if changed and quality_score >= 0.75:
            base = max(timedelta(hours=12), base / 2)
        if (not changed) and quality_score < 0.2:
            base = min(timedelta(days=14), base * 2)
        if blocked_detected:
            base = max(base, timedelta(hours=8))

        return int(base.total_seconds())

    async def mark_crawled(
        self,
        canonical_url: str,
        status_code: int,
        content_hash: Optional[str],
        etag: Optional[str],
        last_modified: Optional[str],
        changed: bool,
        response_time_ms: int,
        quality_score: float = 0.0,
        error_category: Optional[str] = None,
        blocked_detected: bool = False,
        fetch_method: str = "http",
        proxy_tier: str = "none",
        capture_id: Optional[str] = None,
        last_content_sample: Optional[str] = None,
    ) -> None:
        if not self.pool:
            return

        next_delay_seconds = self._compute_next_delay_seconds(
            changed=changed,
            status_code=status_code,
            quality_score=max(0.0, min(float(quality_score or 0.0), 1.0)),
            blocked_detected=bool(blocked_detected),
        )

        quality_score = max(0.0, min(float(quality_score or 0.0), 1.0))
        should_update_sample = bool(changed and quality_score >= 0.2 and (last_content_sample or "").strip())
        sample = (last_content_sample or "")[:2000] if should_update_sample else None
        quality_delta = 3 if quality_score >= 0.75 else (-2 if quality_score < 0.2 else 0)
        block_delta = -6 if blocked_detected else 0
        change_delta = 4 if changed else -1

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
                    last_quality_score = $9,
                    last_error_category = $10,
                    last_fetch_method = $11,
                    last_proxy_tier = $12,
                    last_blocked_detected = $13,
                    last_capture_id = COALESCE($14::uuid, last_capture_id),
                    last_content_sample = CASE
                        WHEN $18 THEN COALESCE($19, last_content_sample)
                        ELSE last_content_sample
                    END,
                    priority_score = LEAST(
                        120,
                        GREATEST(10, COALESCE(priority_score, 40) + $15 + $16 + $17)
                    ),
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
                quality_score,
                error_category,
                fetch_method,
                proxy_tier,
                blocked_detected,
                capture_id,
                quality_delta,
                block_delta,
                change_delta,
                should_update_sample,
                sample,
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

        await self.record_domain_outcome(
            canonical_url=canonical_url,
            blocked_detected=blocked_detected,
            status_code=status_code,
            fetch_method=fetch_method,
        )

    async def record_domain_outcome(
        self,
        *,
        canonical_url: str,
        blocked_detected: bool,
        status_code: int,
        fetch_method: str,
    ) -> None:
        if not self.pool:
            return

        async with self.pool.acquire() as conn:
            domain_row = await conn.fetchrow(
                "SELECT domain FROM crawl_frontier_urls WHERE canonical_url = $1",
                canonical_url,
            )
            if not domain_row:
                return
            domain = str(domain_row["domain"] or "")
            if not domain:
                return

            await conn.execute(
                """
                INSERT INTO domain_policies (
                    domain, respect_robots, crawl_delay_ms, max_concurrent, blocked,
                    proxy_tier, render_required, block_rate, consecutive_blocks, updated_at
                )
                VALUES ($1, TRUE, 1500, 2, FALSE, 'datacenter', FALSE, 0, 0, NOW())
                ON CONFLICT (domain) DO NOTHING
                """,
                domain,
            )

            provider_success = fetch_method.startswith("provider_") and not blocked_detected and status_code < 400
            await conn.execute(
                """
                UPDATE domain_policies
                SET block_rate = LEAST(
                        1.0,
                        GREATEST(
                            0.0,
                            COALESCE(block_rate, 0) * 0.85 + CASE WHEN $2 THEN 0.15 ELSE 0 END
                        )
                    ),
                    consecutive_blocks = CASE
                        WHEN $2 THEN COALESCE(consecutive_blocks, 0) + 1
                        ELSE 0
                    END,
                    last_blocked_at = CASE WHEN $2 THEN NOW() ELSE last_blocked_at END,
                    last_provider_success_at = CASE WHEN $3 THEN NOW() ELSE last_provider_success_at END,
                    render_required = CASE
                        WHEN $2 THEN TRUE
                        ELSE render_required
                    END,
                    proxy_tier = CASE
                        WHEN $2 AND COALESCE(consecutive_blocks, 0) + 1 >= 3 THEN 'residential'
                        ELSE proxy_tier
                    END,
                    blocked = CASE
                        WHEN COALESCE(consecutive_blocks, 0) + CASE WHEN $2 THEN 1 ELSE 0 END >= 8 THEN TRUE
                        ELSE FALSE
                    END,
                    policy_version = COALESCE(policy_version, 1) + 1,
                    updated_at = NOW()
                WHERE domain = $1
                """,
                domain,
                blocked_detected or status_code in {403, 429, 503},
                provider_success,
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
