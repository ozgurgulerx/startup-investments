"""Tests for frontier seeding helpers and workflow wiring behavior."""

from __future__ import annotations

import asyncio

from src.config import settings
from src.crawl_runtime.seed_frontier import COMMON_PATHS, FrontierSeeder, StartupSeed, build_seed_urls


class FakeFrontier:
    def __init__(self):
        self.connected = False
        self.enqueued = []

    async def connect(self):
        self.connected = True

    async def enqueue_urls(self, startup_slug: str, urls, default_change_rate: float = 0.0):
        batch = list(urls)
        self.enqueued.append((startup_slug, batch, default_change_rate))
        return len(batch)

    async def close(self):
        return None


def test_build_seed_urls_returns_canonical_paths():
    urls = build_seed_urls("www.Acme.com")
    assert len(urls) == len(COMMON_PATHS)
    assert urls[0] == "https://acme.com/"
    assert "https://acme.com/pricing" in urls
    assert "https://acme.com/changelog" in urls


def test_build_seed_urls_returns_empty_for_invalid_input():
    assert build_seed_urls("") == []


def test_seeder_reads_startups_and_enqueues_urls():
    frontier = FakeFrontier()
    seeder = FrontierSeeder(database_url="postgres://example", frontier=frontier)
    old_discovery = settings.crawler.feed_discovery_enabled
    settings.crawler.feed_discovery_enabled = False
    try:
        async def fake_fetch_startups(limit: int = 5000):
            assert limit == 100
            return [
                StartupSeed(slug="acme", website="acme.com"),
                StartupSeed(slug="zen", website="https://zen.ai"),
            ]

        seeder._fetch_startups = fake_fetch_startups  # type: ignore[method-assign]
        summary = asyncio.run(seeder.seed(limit=100))

        assert frontier.connected is True
        assert summary["startups_considered"] == 2
        assert summary["startups_seeded"] == 2
        assert summary["urls_seeded"] == len(COMMON_PATHS) * 2
        assert frontier.enqueued[0][0] == "acme"
        assert frontier.enqueued[1][0] == "zen"
    finally:
        settings.crawler.feed_discovery_enabled = old_discovery
