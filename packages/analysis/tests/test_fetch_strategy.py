"""Tests for hybrid fetch escalation and browser reuse."""

from __future__ import annotations

import asyncio

import pytest

from src.config import settings
from src.crawler import fetch_strategy as fetch_module
from src.crawler.fetch_strategy import FetchResult, HybridFetcher


def test_hybrid_fetcher_escalates_http_to_provider(monkeypatch):
    attempts: list[str] = []

    async def fake_fetch_with_http(url: str, **kwargs):
        proxy_tier = kwargs.get("proxy_tier", "none")
        attempts.append(proxy_tier)
        return FetchResult(
            success=False,
            url=url,
            method="http",
            status_code=403,
            blocked_detected=True,
            proxy_tier=proxy_tier,
            error="blocked",
        )

    class FakeProvider:
        async def fetch(self, _request):
            class Result:
                status_code = 200
                final_url = "https://acme.com"
                provider = "browserless"
                html = "<html><head><title>Acme</title></head><body><main>Pricing and docs content.</main></body></html>"
                blocked_detected = False

            return Result()

    async def fail_browser(self, _url: str):
        raise AssertionError("browser fallback should not run when provider succeeds")

    old_mode = settings.crawler.unblock_mode
    settings.crawler.unblock_mode = "auto"
    monkeypatch.setattr(fetch_module, "fetch_with_http", fake_fetch_with_http)
    monkeypatch.setattr(HybridFetcher, "_fetch_with_browser", fail_browser)

    fetcher = HybridFetcher(
        http_timeout=1.0,
        browser_timeout=1.0,
        datacenter_proxy_url="http://dc-proxy",
        residential_proxy_url="http://res-proxy",
    )
    fetcher.unblock_provider = FakeProvider()

    async def run_case():
        try:
            return await fetcher.fetch("https://acme.com")
        finally:
            await fetcher.close()

    try:
        result = asyncio.run(run_case())
    finally:
        settings.crawler.unblock_mode = old_mode

    assert attempts == ["datacenter", "residential"]
    assert result.success is True
    assert result.method == "provider_browserless"
    assert result.provider == "browserless"


def test_hybrid_fetcher_reuses_browser_session(monkeypatch):
    state = {"entered": 0, "exited": 0, "runs": 0}

    class FakeBrowserConfig:
        def __init__(self, **_kwargs):
            return None

    class FakeRunConfig:
        def __init__(self, **_kwargs):
            return None

    class FakeCacheMode:
        BYPASS = "bypass"

    class FakeCrawler:
        def __init__(self, config=None):
            self.config = config

        async def __aenter__(self):
            state["entered"] += 1
            return self

        async def __aexit__(self, exc_type, exc, tb):
            state["exited"] += 1
            return False

        async def arun(self, url: str, config=None):
            state["runs"] += 1

            class Result:
                html = f"<html><head><title>{url}</title></head><body><main>Body for {url}</main></body></html>"
                markdown = ""
                title = url

            return Result()

    monkeypatch.setattr(fetch_module, "AsyncWebCrawler", FakeCrawler)
    monkeypatch.setattr(fetch_module, "BrowserConfig", FakeBrowserConfig)
    monkeypatch.setattr(fetch_module, "CrawlerRunConfig", FakeRunConfig)
    monkeypatch.setattr(fetch_module, "CacheMode", FakeCacheMode)

    fetcher = HybridFetcher(http_timeout=1.0, browser_timeout=1.0)

    async def run_case():
        try:
            first_result = await fetcher._fetch_with_browser("https://acme.com")
            second_result = await fetcher._fetch_with_browser("https://acme.com/docs")
            return first_result, second_result
        finally:
            await fetcher.close()

    first, second = asyncio.run(run_case())

    assert first.success is True
    assert second.success is True
    assert state == {"entered": 1, "exited": 1, "runs": 2}


@pytest.mark.parametrize(
    ("status_code", "blocked_detected", "error", "expected"),
    [
        (403, True, None, True),
        (429, False, None, True),
        (0, False, "timeout", True),
        (200, False, None, False),
    ],
)
def test_http_ladder_retry_policy(status_code, blocked_detected, error, expected):
    result = FetchResult(
        success=False,
        url="https://acme.com",
        status_code=status_code,
        blocked_detected=blocked_detected,
        error=error,
    )
    assert HybridFetcher._should_try_next_http_tier(result) is expected
