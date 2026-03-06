"""Seed crawl frontier from startups table so worker has active targets."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional

try:
    import asyncpg
except Exception:  # pragma: no cover
    asyncpg = None

from src.config import settings
from src.crawl_runtime.discovery import discover_seed_urls
from src.crawl_runtime.frontier import UrlFrontierStore, canonicalize_url, classify_page_type


COMMON_PATHS = [
    "",
    "/pricing",
    "/docs",
    "/blog",
    "/changelog",
    "/security",
    "/careers",
]

DISCOVERY_HINT_PATHS = [
    "/sitemap.xml",
    "/feed",
    "/blog/feed",
    "/news/feed",
    "/changelog/feed",
    "/rss.xml",
    "/atom.xml",
]

PAGE_TYPE_PRIORITY = {
    "pricing": 100,
    "docs": 95,
    "changelog": 90,
    "security": 85,
    "blog": 70,
    "news": 65,
    "careers": 50,
    "generic": 40,
}


@dataclass
class StartupSeed:
    slug: str
    website: str


def _slugify(name: str) -> str:
    return name.lower().replace(" ", "-").replace(".", "").replace(",", "").replace("&", "and")


def build_seed_urls(website: str, include_discovery_hints: bool = False) -> List[str]:
    base = canonicalize_url(website)
    if not base:
        return []

    if base.endswith("/"):
        base = base[:-1]

    urls: List[str] = []
    for suffix in COMMON_PATHS:
        url = f"{base}{suffix}"
        canonical = canonicalize_url(url)
        if canonical and canonical not in urls:
            urls.append(canonical)
    if include_discovery_hints:
        for suffix in DISCOVERY_HINT_PATHS:
            url = f"{base}{suffix}"
            canonical = canonicalize_url(url)
            if canonical and canonical not in urls:
                urls.append(canonical)
    return urls


def _seed_url_priority(url: str) -> int:
    page_type = classify_page_type(url)
    score = PAGE_TYPE_PRIORITY.get(page_type, PAGE_TYPE_PRIORITY["generic"])
    lower = url.lower()
    if "/api" in lower or "/reference" in lower or "/developer" in lower:
        score = max(score, 92)
    if "/product" in lower or "/platform" in lower:
        score = max(score, 72)
    return score


def prioritize_seed_urls(urls: Iterable[str]) -> List[str]:
    deduped: List[str] = []
    seen: set[str] = set()
    for raw in urls:
        canonical = canonicalize_url(raw)
        if not canonical or canonical in seen:
            continue
        seen.add(canonical)
        deduped.append(canonical)

    return sorted(deduped, key=lambda url: (-_seed_url_priority(url), len(url), url))


def parse_cursor(cursor: Optional[str]) -> int:
    """Parse cursor token as a non-negative integer offset."""
    if not cursor:
        return 0
    token = str(cursor).strip()
    if token == "":
        return 0
    try:
        value = int(token, 10)
    except ValueError as exc:
        raise ValueError(f"Invalid cursor '{cursor}': expected integer offset") from exc
    if value < 0:
        raise ValueError(f"Invalid cursor '{cursor}': offset must be >= 0")
    return value


class FrontierSeeder:
    """Seeds frontier queue from DB startups table."""

    def __init__(self, database_url: Optional[str] = None, frontier: Optional[UrlFrontierStore] = None):
        self.database_url = database_url or os.getenv("DATABASE_URL")
        self.frontier = frontier or UrlFrontierStore(self.database_url)

    async def _fetch_startups(self, limit: int = 5000, offset: int = 0) -> List[StartupSeed]:
        if asyncpg is None:
            raise RuntimeError("asyncpg is required for frontier seeding")
        if not self.database_url:
            raise RuntimeError("DATABASE_URL is required for frontier seeding")

        conn = await asyncpg.connect(self.database_url)
        try:
            rows = await conn.fetch(
                """
                SELECT slug, name, website
                FROM startups
                WHERE website IS NOT NULL
                  AND LENGTH(TRIM(website)) > 0
                ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
                LIMIT $1
                OFFSET $2
                """,
                max(1, limit),
                max(0, offset),
            )
        finally:
            await conn.close()

        seeds: List[StartupSeed] = []
        for row in rows:
            website = str(row.get("website") or "").strip()
            if not website:
                continue
            slug = str(row.get("slug") or "").strip() or _slugify(str(row.get("name") or "startup"))
            seeds.append(StartupSeed(slug=slug, website=website))

        return seeds

    async def seed(
        self,
        limit: int = 5000,
        cursor: Optional[str] = None,
        max_startups: int = 0,
        max_seconds: float = 0.0,
    ) -> Dict[str, Any]:
        await self.frontier.connect()

        offset = parse_cursor(cursor)
        startups = await self._fetch_startups(limit=max(1, int(limit)), offset=offset)
        seeded_startups = 0
        seeded_urls = 0
        startups_considered = 0
        start = time.monotonic()

        for item in startups:
            if max_startups > 0 and startups_considered >= max_startups:
                break
            # Always process at least one startup when a non-empty batch is fetched,
            # otherwise an extremely low max_seconds value could stall cursor progress.
            if max_seconds > 0 and startups_considered > 0 and (time.monotonic() - start) >= max_seconds:
                break

            startups_considered += 1
            urls = build_seed_urls(
                item.website,
                include_discovery_hints=settings.crawler.feed_discovery_enabled,
            )
            if settings.crawler.feed_discovery_enabled:
                try:
                    discovery = await discover_seed_urls(
                        item.website,
                        timeout_seconds=settings.crawler.feed_discovery_timeout_seconds,
                        max_urls=settings.crawler.feed_discovery_max_urls_per_startup,
                    )
                    for url in discovery.urls:
                        if url not in urls:
                            urls.append(url)
                except Exception:
                    # Seeder must stay robust; discovery failures should not block baseline seeding.
                    pass
            urls = prioritize_seed_urls(urls)
            if not urls:
                continue
            count = await self.frontier.enqueue_urls(item.slug, urls)
            seeded_urls += count
            seeded_startups += 1

        next_offset = offset + startups_considered
        reached_batch_end = startups_considered == len(startups)
        has_more = (not reached_batch_end) or (len(startups) >= max(1, int(limit)))

        return {
            "cursor": str(offset),
            "next_cursor": str(next_offset) if has_more else None,
            "exhausted": not has_more,
            "startups_considered": startups_considered,
            "startups_fetched": len(startups),
            "startups_seeded": seeded_startups,
            "urls_seeded": seeded_urls,
        }


async def run_seed_frontier(
    limit: int = 5000,
    cursor: Optional[str] = None,
    max_startups: int = 0,
    max_seconds: float = 0.0,
) -> Dict[str, Any]:
    seeder = FrontierSeeder()
    try:
        result = await seeder.seed(
            limit=limit,
            cursor=cursor,
            max_startups=max_startups,
            max_seconds=max_seconds,
        )
    finally:
        await seeder.frontier.close()
    return result


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed crawl frontier from startups table")
    parser.add_argument("--limit", type=int, default=5000)
    parser.add_argument("--cursor", type=str, default="")
    parser.add_argument("--max-startups", type=int, default=0)
    parser.add_argument("--max-seconds", type=float, default=0.0)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    result = asyncio.run(
        run_seed_frontier(
            limit=args.limit,
            cursor=args.cursor or None,
            max_startups=args.max_startups,
            max_seconds=args.max_seconds,
        )
    )
    print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
