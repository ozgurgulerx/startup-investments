"""Regression tests for daily news ingestion runtime."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from src.automation.news_ingest import (
    DailyNewsIngestor,
    NormalizedNewsItem,
    SourceDefinition,
    _is_relevant_turkey_news_item,
    _parse_amazon_new_releases_html,
    _stable_external_id,
    _utc_midnight,
    ensure_json_object,
    is_likely_content_url,
)


def test_ensure_json_object_handles_dict_and_json_string():
    assert ensure_json_object({"points": 12}) == {"points": 12}
    assert ensure_json_object('{"votes": 7, "comments": 2}') == {"votes": 7, "comments": 2}


def test_ensure_json_object_returns_empty_for_invalid_shapes():
    assert ensure_json_object(None) == {}
    assert ensure_json_object("not json") == {}
    assert ensure_json_object("[1,2,3]") == {}
    assert ensure_json_object(123) == {}


def test_is_likely_content_url_filters_listing_paths():
    assert is_likely_content_url("https://acme.com/blog") is False
    assert is_likely_content_url("https://acme.com/news/") is False
    assert is_likely_content_url("https://acme.com/changelog") is False
    assert is_likely_content_url("https://acme.com/blog/launch-post") is True
    assert is_likely_content_url("https://acme.com/updates/product-v2") is True


def test_turkey_relevance_excludes_domain_purchase_false_ai_positive():
    # Example: "ai.com domain bought" is not AI startup intelligence.
    item = NormalizedNewsItem(
        source_key="newsapi_turkey",
        source_name="NewsAPI Turkey",
        source_type="api",
        title="Milyonlarca dolara satın alındı: Tarihin en pahalı alan adı artık o",
        url="https://example.com/domain-buy",
        canonical_url="https://example.com/domain-buy",
        summary="ai.com alan adı milyonlarca dolara satın alındı",
        published_at=datetime.now(timezone.utc),
        language="tr",
        payload={},
        source_weight=0.67,
    ).with_external_id()

    assert _is_relevant_turkey_news_item(item) is False


def test_turkey_relevance_excludes_startup_owned_listing_pages():
    item = NormalizedNewsItem(
        source_key="startup_owned_feeds",
        source_name="Startup-Owned Sources",
        source_type="crawler",
        title="Blog | Acme AI",
        url="https://acme.ai/blog",
        canonical_url="https://acme.ai/blog",
        summary="Yapay zeka platformu uzerine blog",
        published_at=datetime.now(timezone.utc),
        language="tr",
        payload={"startup_country": "Turkey"},
        source_weight=0.79,
    ).with_external_id()

    assert _is_relevant_turkey_news_item(item) is False


def test_turkey_relevance_allows_ai_funding_signal():
    item = NormalizedNewsItem(
        source_key="webrazzi",
        source_name="Webrazzi",
        source_type="rss",
        title="Istanbul merkezli yapay zeka girisimi X 2 milyon dolar yatirim aldi",
        url="https://webrazzi.com/example",
        canonical_url="https://webrazzi.com/example",
        summary="VC fonu liderliginde seed turu.",
        published_at=datetime.now(timezone.utc),
        language="tr",
        payload={},
        source_weight=0.74,
    ).with_external_id()

    assert _is_relevant_turkey_news_item(item) is True


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


class _FakeGitHubResponse:
    def __init__(self, payload, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload


class _FakeGitHubClient:
    def __init__(self, payload):
        self._payload = payload

    async def get(self, url: str, params=None, headers=None):
        assert "api.github.com/search/repositories" in url
        assert params is not None
        assert headers is not None
        return _FakeGitHubResponse(self._payload)


def test_fetch_github_trending_ai_emits_snapshot_and_delta(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://local/test")
    monkeypatch.setenv("GITHUB_TRENDING_TOPICS", "llm")
    monkeypatch.setenv("GITHUB_TRENDING_LIMIT", "2")
    monkeypatch.setenv("GITHUB_TRENDING_MIN_STAR_DELTA", "50")

    ingestor = DailyNewsIngestor()

    today = datetime.now(timezone.utc).date()
    yesterday = (today - timedelta(days=1)).isoformat()

    async def _fake_count_snapshot_rows(conn, *, source_key: str, snapshot_date: str, category_url: str = ""):
        assert source_key == "github_trending_ai"
        assert snapshot_date == today.isoformat()
        assert category_url == ""
        return 0

    async def _fake_load_snapshot_rows(conn, *, source_key: str, snapshot_date: str):
        assert source_key == "github_trending_ai"
        assert snapshot_date == yesterday
        return [
            ("https://github.com/acme/mover", {"stars": 10}),
        ]

    ingestor._count_snapshot_rows = _fake_count_snapshot_rows  # type: ignore[method-assign]
    ingestor._load_snapshot_payload_rows = _fake_load_snapshot_rows  # type: ignore[method-assign]

    source = SourceDefinition(
        source_key="github_trending_ai",
        display_name="GitHub Trending AI (Search)",
        source_type="api",
        base_url="github://search/repositories",
        fetch_mode="api",
        credibility_weight=0.70,
    )

    fake_payload = {
        "items": [
            {
                "full_name": "acme/new",
                "html_url": "https://github.com/acme/new",
                "description": "A new LLM tool for builders",
                "stargazers_count": 200,
                "forks_count": 10,
                "language": "Python",
                "created_at": "2026-02-01T00:00:00Z",
                "pushed_at": "2026-02-08T00:00:00Z",
            },
            {
                "full_name": "acme/mover",
                "html_url": "https://github.com/acme/mover",
                "description": "An agent framework",
                "stargazers_count": 120,
                "forks_count": 5,
                "language": "TypeScript",
                "created_at": "2026-02-01T00:00:00Z",
                "pushed_at": "2026-02-08T00:00:00Z",
            },
        ]
    }

    items1 = asyncio.run(
        ingestor._fetch_github_trending_ai(None, _FakeGitHubClient(fake_payload), source, lookback_hours=48)  # type: ignore[arg-type]
    )
    items2 = asyncio.run(
        ingestor._fetch_github_trending_ai(None, _FakeGitHubClient(fake_payload), source, lookback_hours=48)  # type: ignore[arg-type]
    )

    # Expect: 2 snapshots + 2 deltas (1 added + 1 mover)
    assert len(items1) == 4
    assert [i.external_id for i in items1] == [i.external_id for i in items2]

    snapshot = [i for i in items1 if (i.payload or {}).get("kind") == "snapshot"]
    delta = [i for i in items1 if (i.payload or {}).get("kind") == "delta"]
    assert len(snapshot) == 2
    assert len(delta) == 2

    # Delta items should be pinned to today's UTC midnight.
    for d in delta:
        assert d.published_at == _utc_midnight(today)

    mover = [d for d in delta if (d.payload or {}).get("delta_type") == "mover"]
    assert len(mover) == 1
    assert mover[0].payload["stars_delta"] == 110


def test_stable_external_id_is_deterministic():
    assert _stable_external_id("a", "b", 1) == _stable_external_id("a", "b", 1)
    assert _stable_external_id("a", "b", 1) != _stable_external_id("a", "b", 2)


def test_parse_amazon_new_releases_html_extracts_asin_and_rank():
    html = """
    <html><body>
      <ol class="a-ordered-list">
        <li class="zg-no-numbers">
          <div data-asin="B000000001">
            <span class="zg-bdg-text">#1</span>
            <a href="/dp/B000000001"><img alt="AI Book One"/></a>
            <a class="a-link-child" href="/author/jane">Jane Doe</a>
          </div>
        </li>
        <li class="zg-no-numbers">
          <div data-asin="B000000002">
            <span class="zg-bdg-text">#2</span>
            <a href="/gp/product/B000000002"><img alt="AI Book Two"/></a>
          </div>
        </li>
      </ol>
    </body></html>
    """
    items = _parse_amazon_new_releases_html(
        html,
        category_url="https://www.amazon.com/gp/new-releases/books/3887",
        max_items=10,
    )
    assert len(items) == 2
    assert items[0]["asin"] == "B000000001"
    assert items[0]["rank"] == 1
    assert items[0]["canonical_url"].endswith("/dp/B000000001")
    assert items[1]["asin"] == "B000000002"
    assert items[1]["rank"] == 2


def test_parse_amazon_new_releases_html_ignores_bot_pages():
    bot_html = "<html><head><title>Robot Check</title></head><body>Robot Check</body></html>"
    items = _parse_amazon_new_releases_html(
        bot_html,
        category_url="https://www.amazon.com/gp/new-releases/books/3887",
        max_items=10,
    )
    assert items == []
