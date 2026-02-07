from __future__ import annotations

from src.crawl_runtime.unblock_provider import BrowserlessUnblockProvider, is_probably_blocked


def test_block_detection_status_and_markers():
    assert is_probably_blocked(403, "") is True
    assert is_probably_blocked(200, "<html>Cloudflare challenge</html>") is True
    assert is_probably_blocked(200, "<html>normal page</html>") is False


def test_browserless_endpoint_normalization_accepts_ws():
    provider = BrowserlessUnblockProvider(endpoint="wss://example.browserless.io", token="t")
    assert provider.is_configured is True
    assert provider.endpoint.startswith("https://")
    assert provider.endpoint.endswith("/content")
