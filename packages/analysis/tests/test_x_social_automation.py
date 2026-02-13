from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

from src.automation.x_client import XClient, append_utm
from src.automation.x_posting import build_post_text
from src.automation.x_trends import fetch_recent_search_items, load_query_pack


@dataclass
class DummySource:
    source_key: str = "x_recent_search_global"
    display_name: str = "X Recent Search (Global)"
    source_type: str = "api"
    region: str = "global"
    credibility_weight: float = 0.64


def test_append_utm_preserves_existing_params():
    url = "https://buildatlas.net/news/some-story?foo=bar"
    tagged = append_utm(url, source="x", medium="social", campaign="auto_global")
    assert "foo=bar" in tagged
    assert "utm_source=x" in tagged
    assert "utm_medium=social" in tagged
    assert "utm_campaign=auto_global" in tagged


def test_build_post_text_is_capped():
    text = build_post_text(
        title="A" * 300,
        insight="B" * 300,
        url="https://buildatlas.net/news/abc",
        region="global",
        max_chars=280,
    )
    assert len(text) <= 280
    assert "#AIStartups" in text


def test_load_query_pack_from_env_json(monkeypatch):
    monkeypatch.setenv("X_TRENDS_QUERY_PACK", '{"global":["foo -is:retweet"],"turkey":["bar -is:retweet"]}')
    pack = load_query_pack()
    assert pack["global"] == ["foo -is:retweet"]
    assert pack["turkey"] == ["bar -is:retweet"]


def test_load_query_pack_invalid_falls_back(monkeypatch):
    monkeypatch.setenv("X_TRENDS_QUERY_PACK", "not-json")
    pack = load_query_pack()
    assert "global" in pack
    assert "turkey" in pack
    assert len(pack["global"]) > 0


def test_oauth1_header_generation(monkeypatch):
    monkeypatch.setenv("X_API_KEY", "ck")
    monkeypatch.setenv("X_API_SECRET", "cs")
    monkeypatch.setenv("X_ACCESS_TOKEN", "at")
    monkeypatch.setenv("X_ACCESS_TOKEN_SECRET", "ats")
    client = XClient()
    header = client._oauth1_header(method="POST", url="https://api.x.com/2/tweets")
    assert header.startswith("OAuth ")
    assert "oauth_consumer_key" in header
    assert "oauth_signature" in header


def test_fetch_recent_search_items_normalizes(monkeypatch):
    sample_payload = {
        "data": [
            {
                "id": "1900000000000000001",
                "text": "AI startup raises seed round in SF",
                "author_id": "42",
                "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "lang": "en",
                "public_metrics": {
                    "like_count": 12,
                    "reply_count": 2,
                    "retweet_count": 3,
                    "quote_count": 1,
                },
            }
        ],
        "includes": {
            "users": [{"id": "42", "username": "builder", "name": "Builder", "verified": True}]
        },
        "meta": {"result_count": 1},
    }

    async def _fake_search_recent(self, *, client, query, start_time, max_results=25, next_token=""):
        return sample_payload

    monkeypatch.setenv("X_TRENDS_ENABLED", "true")
    monkeypatch.setenv("X_API_BEARER_TOKEN", "bearer")
    # Patch the method on the class directly (avoids lazy __getattr__ exports on src.automation).
    monkeypatch.setattr(XClient, "search_recent", _fake_search_recent)

    async def _run():
        async with httpx.AsyncClient() as client:
            items, stats = await fetch_recent_search_items(
                client=client,
                source=DummySource(),
                lookback_hours=24,
                max_items=10,
            )
        return items, stats

    items, stats = asyncio.run(_run())
    assert len(items) == 1
    assert items[0].external_id == "1900000000000000001"
    assert items[0].author == "@builder"
    assert stats.tweets_kept == 1
