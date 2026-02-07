"""Provider fallback tests for scrapy runtime."""

from __future__ import annotations

import asyncio

from src.crawl_runtime.frontier import DomainPolicy
from src.config import settings
from src.crawl_runtime.scrapy_runtime import ScrapyPlaywrightRuntime


class FakeFrontier:
    @property
    def enabled(self) -> bool:
        return False

    async def connect(self):
        return None

    async def close(self):
        return None


class FakeProvider:
    async def fetch(self, _request):
        class R:
            status_code = 200
            provider = "browserless"
            html = "<html><head><title>Acme</title></head><body><main>Pricing table and docs content.</main></body></html>"

        return R()


def test_runtime_applies_provider_on_blocked_docs():
    runtime = ScrapyPlaywrightRuntime(frontier=FakeFrontier())
    runtime.unblock_provider = FakeProvider()

    old_mode = settings.crawler.unblock_mode
    settings.crawler.unblock_mode = "auto"

    docs = [
        {
            "url": "https://acme.com/pricing",
            "canonical_url": "https://acme.com/pricing",
            "page_type": "pricing",
            "status_code": 403,
            "blocked_detected": True,
            "clean_text": "",
            "fetch_method": "http",
            "content_type": "html",
        }
    ]

    policy = DomainPolicy(domain="acme.com")
    updated = asyncio.run(runtime._maybe_apply_provider(docs, policy=policy))

    assert updated[0]["fetch_method"] == "provider_browserless"
    assert updated[0]["blocked_detected"] is False
    assert updated[0]["quality_score"] >= 0.1
    settings.crawler.unblock_mode = old_mode
