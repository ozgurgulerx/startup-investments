"""Tests for Scrapy runtime orchestration and frontier interactions."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from src.crawl_runtime.frontier import FrontierUrl
from src.crawl_runtime.scrapy_runtime import ScrapyPlaywrightRuntime
from src.data.models import StartupInput


class FakeFrontier:
    def __init__(self, enabled: bool = True):
        self._enabled = enabled
        self.marked = []
        self.requeued = []
        self.enqueued = []
        self._leased = []

    @property
    def enabled(self) -> bool:
        return self._enabled

    async def connect(self):
        return None

    async def close(self):
        return None

    async def recover_stale_leases(self, _minutes: int) -> int:
        return 1

    async def lease_urls(self, _limit: int, _worker_id: str):
        return list(self._leased)

    async def enqueue_urls(self, startup_slug: str, urls, default_change_rate: float = 0.0):
        self.enqueued.append((startup_slug, list(urls), default_change_rate))
        return len(list(urls))

    async def mark_crawled(self, **kwargs):
        self.marked.append(kwargs)

    async def requeue_failed(self, canonical_url: str, backoff_seconds: int = 300):
        self.requeued.append((canonical_url, backoff_seconds))


def test_runtime_frontier_disabled_returns_clear_error():
    runtime = ScrapyPlaywrightRuntime(frontier=FakeFrontier(enabled=False))
    summary = asyncio.run(runtime.crawl_frontier_batch(worker_id="w1", limit=5))
    assert summary["leased"] == 0
    assert summary["errors"]


def test_runtime_change_detection_handles_304_and_hash_matches():
    assert ScrapyPlaywrightRuntime._changed("abc", 304, "xyz") is False
    assert ScrapyPlaywrightRuntime._changed("abc", 200, "abc") is False
    assert ScrapyPlaywrightRuntime._changed("abc", 200, "xyz") is True


def test_runtime_marks_crawled_and_requeues_missing_urls():
    frontier = FakeFrontier(enabled=True)
    now = datetime.now(timezone.utc)
    frontier._leased = [
        FrontierUrl(
            startup_slug="acme",
            url="https://acme.com/pricing",
            canonical_url="https://acme.com/pricing",
            domain="acme.com",
            page_type="pricing",
            priority_score=100,
            next_crawl_at=now,
            content_hash="oldhash",
            etag='"etag-1"',
            last_modified="Mon, 01 Jan 2024 00:00:00 GMT",
        ),
        FrontierUrl(
            startup_slug="acme",
            url="https://acme.com/blog",
            canonical_url="https://acme.com/blog",
            domain="acme.com",
            page_type="blog",
            priority_score=60,
            next_crawl_at=now,
            content_hash="bloghash",
            etag=None,
            last_modified=None,
        ),
    ]

    runtime = ScrapyPlaywrightRuntime(frontier=frontier)

    async def fake_run_spider(**_kwargs):
        # Emit only one leased URL and one newly discovered URL.
        return [
            {
                "url": "https://acme.com/pricing",
                "canonical_url": "https://acme.com/pricing",
                "page_type": "pricing",
                "status_code": 200,
                "content_hash": "newhash",
                "etag": '"etag-2"',
                "last_modified": "Tue, 02 Jan 2024 00:00:00 GMT",
                "response_time_ms": 120,
                "clean_text": "updated pricing",
                "fetch_method": "http",
            },
            {
                "url": "https://acme.com/docs",
                "canonical_url": "https://acme.com/docs",
                "page_type": "docs",
                "status_code": 200,
                "content_hash": "docshash",
                "etag": None,
                "last_modified": None,
                "response_time_ms": 90,
                "clean_text": "docs body",
                "fetch_method": "http",
            },
        ], None

    runtime._run_spider = fake_run_spider  # type: ignore[method-assign]

    summary = asyncio.run(runtime.crawl_frontier_batch(worker_id="w1", limit=10))

    assert summary["leased"] == 2
    assert summary["failed"] == 0
    assert summary["processed"] == 2
    assert len(frontier.marked) == 1
    assert frontier.marked[0]["canonical_url"] == "https://acme.com/pricing"
    assert frontier.requeued == [("https://acme.com/blog", 300)]
    assert frontier.enqueued  # discovered docs should be (re)enqueued


def test_runtime_crawl_startup_returns_failure_result_on_spider_error():
    runtime = ScrapyPlaywrightRuntime(frontier=FakeFrontier(enabled=False))

    async def fake_run_spider(**_kwargs):
        return [], "subprocess failed"

    runtime._run_spider = fake_run_spider  # type: ignore[method-assign]

    startup = StartupInput(name="Acme", website="https://acme.com")
    results = asyncio.run(runtime.crawl_startup(startup, ["https://acme.com"]))

    assert len(results) == 1
    assert results[0]["success"] is False
    assert "subprocess failed" in results[0]["error"]
