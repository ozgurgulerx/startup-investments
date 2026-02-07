"""Seed crawl frontier from startups table so worker has active targets."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional

try:
    import asyncpg
except Exception:  # pragma: no cover
    asyncpg = None

from src.config import settings
from src.crawl_runtime.discovery import discover_seed_urls
from src.crawl_runtime.frontier import UrlFrontierStore, canonicalize_url


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


class FrontierSeeder:
    """Seeds frontier queue from DB startups table."""

    def __init__(self, database_url: Optional[str] = None, frontier: Optional[UrlFrontierStore] = None):
        self.database_url = database_url or os.getenv("DATABASE_URL")
        self.frontier = frontier or UrlFrontierStore(self.database_url)

    async def _fetch_startups(self, limit: int = 5000) -> List[StartupSeed]:
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
                """,
                max(1, limit),
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

    async def seed(self, limit: int = 5000) -> Dict[str, Any]:
        await self.frontier.connect()

        startups = await self._fetch_startups(limit=limit)
        seeded_startups = 0
        seeded_urls = 0

        for item in startups:
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
            if not urls:
                continue
            count = await self.frontier.enqueue_urls(item.slug, urls)
            seeded_urls += count
            seeded_startups += 1

        return {
            "startups_considered": len(startups),
            "startups_seeded": seeded_startups,
            "urls_seeded": seeded_urls,
        }


async def run_seed_frontier(limit: int = 5000) -> Dict[str, Any]:
    seeder = FrontierSeeder()
    try:
        result = await seeder.seed(limit=limit)
    finally:
        await seeder.frontier.close()
    return result


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed crawl frontier from startups table")
    parser.add_argument("--limit", type=int, default=5000)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    result = asyncio.run(run_seed_frontier(limit=args.limit))
    print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
