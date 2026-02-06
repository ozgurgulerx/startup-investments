"""Regression tests for daily news ingestion runtime."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from src.automation.news_ingest import DailyNewsIngestor, SourceDefinition, ensure_json_object


def test_ensure_json_object_handles_dict_and_json_string():
    assert ensure_json_object({"points": 12}) == {"points": 12}
    assert ensure_json_object('{"votes": 7, "comments": 2}') == {"votes": 7, "comments": 2}


def test_ensure_json_object_returns_empty_for_invalid_shapes():
    assert ensure_json_object(None) == {}
    assert ensure_json_object("not json") == {}
    assert ensure_json_object("[1,2,3]") == {}
    assert ensure_json_object(123) == {}


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeHttpClient:
    async def get(self, url: str):
        if url.endswith("/newstories.json"):
            return _FakeResponse([101, 102])
        if url.endswith("/item/101.json"):
            now_ts = int(datetime.now(timezone.utc).timestamp())
            return _FakeResponse(
                {
                    "id": 101,
                    "type": "story",
                    "title": "Acme raises seed round",
                    "url": "https://example.com/acme-seed",
                    "time": now_ts,
                    "score": 120,
                    "descendants": 22,
                }
            )
        if url.endswith("/item/102.json"):
            # Non-story should be filtered out.
            return _FakeResponse({"id": 102, "type": "comment"})
        raise AssertionError(f"Unexpected URL in test: {url}")


def test_fetch_hackernews_api_returns_story_items(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://local/test")
    ingestor = DailyNewsIngestor()
    ingestor.max_per_source = 5

    source = SourceDefinition(
        source_key="hackernews_api",
        display_name="Hacker News API",
        source_type="api",
        base_url="https://hacker-news.firebaseio.com/v0",
        fetch_mode="api",
        credibility_weight=0.88,
    )

    items = asyncio.run(ingestor._fetch_hackernews_api(_FakeHttpClient(), source, lookback_hours=48))

    assert len(items) == 1
    assert items[0].source_key == "hackernews_api"
    assert items[0].title == "Acme raises seed round"
    assert items[0].engagement["points"] == 120
    assert items[0].engagement["comments"] == 22

