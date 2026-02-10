from __future__ import annotations

from src.crawl_runtime.unblock_provider import (
    BrowserlessUnblockProvider,
    StealthPlaywrightUnblockProvider,
    build_unblock_provider,
    is_probably_blocked,
)


def test_block_detection_status_and_markers():
    assert is_probably_blocked(403, "") is True
    assert is_probably_blocked(200, "<html>Cloudflare challenge</html>") is True
    assert is_probably_blocked(200, "<html>normal page</html>") is False


def test_browserless_endpoint_normalization_accepts_ws():
    provider = BrowserlessUnblockProvider(endpoint="wss://example.browserless.io", token="t")
    assert provider.is_configured is True
    assert provider.endpoint.startswith("https://")
    assert provider.endpoint.endswith("/content")


def test_stealth_provider_is_configured():
    provider = StealthPlaywrightUnblockProvider()
    # True when playwright is installed, False otherwise
    assert isinstance(provider.is_configured, bool)


def test_stealth_provider_in_factory():
    provider = build_unblock_provider("stealth")
    if provider is not None:
        assert isinstance(provider, StealthPlaywrightUnblockProvider)


def test_browserless_still_works_via_factory():
    provider = build_unblock_provider("browserless", endpoint="https://example.com", token="t")
    assert isinstance(provider, BrowserlessUnblockProvider)
    assert provider.is_configured


def test_factory_returns_none_for_unknown():
    assert build_unblock_provider("unknown") is None
    assert build_unblock_provider("") is None
