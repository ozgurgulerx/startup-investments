"""Tests for incremental frontier seeding cursor behavior."""

from __future__ import annotations

import asyncio

import pytest

from src.config import settings
from src.crawl_runtime.seed_frontier import (
    COMMON_PATHS,
    FrontierSeeder,
    StartupSeed,
    build_seed_urls,
    parse_cursor,
    prioritize_seed_urls,
)


class FakeFrontier:
    def __init__(self):
        self.connected = False
        self.enqueued: list[tuple[str, list[str]]] = []

    async def connect(self):
        self.connected = True
        return None

    async def close(self):
        return None

    async def enqueue_urls(self, startup_slug: str, urls, default_change_rate: float = 0.0):
        captured = list(urls)
        self.enqueued.append((startup_slug, captured))
        return len(captured)


class StubSeeder(FrontierSeeder):
    def __init__(self, startups: list[StartupSeed]):
        self.database_url = "postgres://example.invalid/db"
        self.frontier = FakeFrontier()
        self._startups = startups

    async def _fetch_startups(self, limit: int = 5000, offset: int = 0):
        return self._startups[offset:offset + limit]


def test_build_seed_urls_returns_canonical_paths():
    urls = build_seed_urls("www.Acme.com")
    assert len(urls) == len(COMMON_PATHS)
    assert urls[0] == "https://acme.com/"
    assert "https://acme.com/pricing" in urls
    assert "https://acme.com/changelog" in urls


def test_build_seed_urls_returns_empty_for_invalid_input():
    assert build_seed_urls("") == []


def test_prioritize_seed_urls_promotes_high_value_paths():
    ordered = prioritize_seed_urls(
        [
            "https://acme.com/blog/post-1",
            "https://acme.com/pricing",
            "https://acme.com/docs/getting-started",
            "https://acme.com/company",
        ]
    )
    assert ordered.index("https://acme.com/pricing") < ordered.index("https://acme.com/company")
    assert ordered.index("https://acme.com/docs/getting-started") < ordered.index("https://acme.com/company")


def test_seeder_reads_startups_and_enqueues_urls():
    frontier = FakeFrontier()
    seeder = FrontierSeeder(database_url="postgres://example", frontier=frontier)
    old_discovery = settings.crawler.feed_discovery_enabled
    settings.crawler.feed_discovery_enabled = False
    try:
        async def fake_fetch_startups(limit: int = 5000, offset: int = 0):
            assert limit == 100
            assert offset == 0
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
        assert summary["exhausted"] is True
        assert frontier.enqueued[0][0] == "acme"
        assert frontier.enqueued[1][0] == "zen"
    finally:
        settings.crawler.feed_discovery_enabled = old_discovery


def test_parse_cursor_defaults_and_valid_values():
    assert parse_cursor(None) == 0
    assert parse_cursor("") == 0
    assert parse_cursor("0") == 0
    assert parse_cursor("42") == 42


def test_parse_cursor_rejects_invalid_values():
    with pytest.raises(ValueError):
        parse_cursor("-1")
    with pytest.raises(ValueError):
        parse_cursor("abc")


def test_seed_cursor_advances_when_chunked():
    startups = [
        StartupSeed(slug="s1", website="https://one.example"),
        StartupSeed(slug="s2", website="https://two.example"),
        StartupSeed(slug="s3", website="https://three.example"),
    ]
    seeder = StubSeeder(startups)

    result = asyncio.run(
        seeder.seed(limit=3, cursor="0", max_startups=2, max_seconds=0)
    )

    assert result["cursor"] == "0"
    assert result["next_cursor"] == "2"
    assert result["exhausted"] is False
    assert result["startups_considered"] == 2
    assert len(seeder.frontier.enqueued) == 2


def test_seed_reports_exhausted_when_end_reached():
    startups = [
        StartupSeed(slug="s1", website="https://one.example"),
        StartupSeed(slug="s2", website="https://two.example"),
        StartupSeed(slug="s3", website="https://three.example"),
    ]
    seeder = StubSeeder(startups)

    result = asyncio.run(
        seeder.seed(limit=2, cursor="2", max_startups=0, max_seconds=0)
    )

    assert result["cursor"] == "2"
    assert result["next_cursor"] is None
    assert result["exhausted"] is True
    assert result["startups_considered"] == 1
    assert len(seeder.frontier.enqueued) == 1
