"""Regression tests for daily news ingestion runtime."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from src.automation.news_ingest import (
    DEFAULT_SOURCES,
    TR_ENDEMIC_SOURCES,
    DailyNewsIngestor,
    NormalizedNewsItem,
    SourceDefinition,
    StoryCluster,
    _TURKEY_VC_BLOG_URLS,
    _build_turkey_cluster,
    _has_turkey_nexus,
    _is_relevant_turkey_news_item,
    _is_relevant_turkey_news_item_strict,
    _parse_amazon_new_releases_html,
    _stable_external_id,
    _utc_midnight,
    build_paid_headline_search_query,
    compute_cluster_scores,
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


def test_build_paid_headline_search_query_prefers_anchor_entity():
    query = build_paid_headline_search_query("Top-funded AI database startup Pinecone considers sale")
    assert '"Pinecone"' in query
    assert "sale" in query


def test_compute_cluster_scores_ignores_lead_only_members():
    now = datetime.now(timezone.utc)
    real = NormalizedNewsItem(
        source_key="gnews",
        source_name="GNews",
        source_type="api",
        title="Pinecone considers sale",
        url="https://example.com/story",
        canonical_url="https://example.com/story",
        summary="",
        published_at=now,
        language="en",
        payload={},
        engagement={"points": 1},
        source_weight=0.50,
    ).with_external_id()

    lead = NormalizedNewsItem(
        source_key="theinformation",
        source_name="The Information",
        source_type="community",
        title="Top-funded AI database startup Pinecone considers sale",
        url="https://theinformation.com/articles/x",
        canonical_url="https://theinformation.com/articles/x",
        summary="",
        published_at=now,
        language="en",
        payload={"lead_only": True, "paywalled": True},
        engagement={"points": 999},
        source_weight=0.99,
    ).with_external_id()

    tags = ["ai"]
    score_real = compute_cluster_scores(published_at=now, topic_tags=tags, members=[real], now=now)
    score_with_lead = compute_cluster_scores(published_at=now, topic_tags=tags, members=[real, lead], now=now)

    assert score_real == score_with_lead


def test_semianalysis_source_in_default_sources():
    source_map = {s.source_key: s for s in DEFAULT_SOURCES}
    assert "semianalysis" in source_map
    src = source_map["semianalysis"]
    assert src.region == "global"
    assert src.fetch_mode == "rss"
    assert src.source_type == "rss"
    assert src.base_url == "https://semianalysis.com/feed/"
    assert src.language == "en"
    assert src.lookback_hours_override == 168


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


# --- Turkey news quality tests ---


def test_turkey_broad_heuristic_accepts_non_ai_fintech_funding():
    """Non-AI Turkish fintech funding should pass the broad heuristic."""
    item = NormalizedNewsItem(
        source_key="webrazzi",
        source_name="Webrazzi",
        source_type="rss",
        title="Türk fintech girişimi Papara 50 milyon dolar yatırım aldı",
        url="https://webrazzi.com/papara-funding",
        canonical_url="https://webrazzi.com/papara-funding",
        summary="Papara seed turunda 50 milyon dolar yatırım aldı. Yatırımcılar arasında Sequoia var.",
        published_at=datetime.now(timezone.utc),
        language="tr",
        payload={},
        source_weight=0.74,
    ).with_external_id()

    assert _is_relevant_turkey_news_item(item) is True


def test_turkey_broad_heuristic_rejects_generic_ai_article():
    """Generic AI article without a named company should fail the broad heuristic."""
    item = NormalizedNewsItem(
        source_key="gnews_turkey",
        source_name="GNews Turkey",
        source_type="api",
        title="How Students Are Using AI to Raise GPA Faster Than Ever",
        url="https://turinq.com/ai-students-gpa",
        canonical_url="https://turinq.com/ai-students-gpa",
        summary="Students across Turkey are leveraging AI tools to study more efficiently and boost academic performance.",
        published_at=datetime.now(timezone.utc),
        language="en",
        payload={},
        source_weight=0.60,
    ).with_external_id()

    assert _is_relevant_turkey_news_item(item) is False


def test_turkey_strict_heuristic_rejects_non_ai_content():
    """The strict (AI-required) filter should reject non-AI startup content."""
    item = NormalizedNewsItem(
        source_key="webrazzi",
        source_name="Webrazzi",
        source_type="rss",
        title="Türk fintech girişimi Papara 50 milyon dolar yatırım aldı",
        url="https://webrazzi.com/papara-funding",
        canonical_url="https://webrazzi.com/papara-funding",
        summary="Papara seed turunda 50 milyon dolar yatırım aldı.",
        published_at=datetime.now(timezone.utc),
        language="tr",
        payload={},
        source_weight=0.74,
    ).with_external_id()

    assert _is_relevant_turkey_news_item_strict(item) is False


def test_turkey_startup_owned_feeds_still_requires_ai():
    """startup_owned_feeds should still require AI keywords (strict filter)."""
    item = NormalizedNewsItem(
        source_key="startup_owned_feeds",
        source_name="Startup-Owned Sources",
        source_type="crawler",
        title="Papara launches new payment feature",
        url="https://papara.com/blog/new-payment",
        canonical_url="https://papara.com/blog/new-payment",
        summary="A new payment solution for Turkish merchants.",
        published_at=datetime.now(timezone.utc),
        language="en",
        payload={"startup_country": "Turkey"},
        source_weight=0.79,
    ).with_external_id()

    # Broad heuristic delegates to strict for startup_owned_feeds
    assert _is_relevant_turkey_news_item(item) is False


def test_build_turkey_cluster_keeps_llm_classified_non_ai_item():
    """Items with turkey_priority >= 1 from LLM should survive _build_turkey_cluster()
    even if they lack AI keywords (e.g. a fintech funding round)."""
    now = datetime.now(timezone.utc)
    member = NormalizedNewsItem(
        source_key="webrazzi",
        source_name="Webrazzi",
        source_type="rss",
        title="Fintech girişimi Papara 50 milyon dolar yatırım aldı",
        url="https://webrazzi.com/papara",
        canonical_url="https://webrazzi.com/papara",
        summary="Papara seed turunda yatırım aldı.",
        published_at=now,
        language="tr",
        payload={"turkey_priority": 1, "turkey_classified_by": "llm"},
        source_weight=0.74,
    ).with_external_id()

    cluster = StoryCluster(
        cluster_key="test-cluster-1",
        primary_source_key="webrazzi",
        primary_external_id=member.external_id,
        canonical_url=member.canonical_url,
        title=member.title,
        summary=member.summary,
        published_at=now,
        topic_tags=["funding"],
        entities=["Papara"],
        story_type="funding",
        rank_score=0.5,
        rank_reason="test",
        trust_score=0.7,
        builder_takeaway=None,
        llm_summary=None,
        llm_model=None,
        llm_signal_score=None,
        llm_confidence_score=None,
        llm_topic_tags=[],
        llm_story_type=None,
        members=[member],
    )

    turkey_source_keys = {"webrazzi", "egirisim", "gnews_turkey", "newsapi_turkey"}
    result = _build_turkey_cluster(cluster, turkey_source_keys)
    assert result is not None
    assert len(result.members) == 1
    assert result.members[0].title == member.title


# --- Turkey VC & ecosystem source tests ---


def test_new_turkey_rss_sources_in_default_sources():
    """All 4 new Turkey RSS sources must be in DEFAULT_SOURCES with region='turkey'."""
    source_map = {s.source_key: s for s in DEFAULT_SOURCES}
    for key in ("vc_212", "finberg", "endeavor_turkey", "startupcentrum_tr"):
        assert key in source_map, f"{key} missing from DEFAULT_SOURCES"
        assert source_map[key].region == "turkey", f"{key} should have region='turkey'"
        assert source_map[key].fetch_mode == "rss", f"{key} should be RSS"


def test_vc_turkey_blogs_source_in_default_sources():
    """vc_turkey_blogs must exist as a crawler source with region='turkey'."""
    source_map = {s.source_key: s for s in DEFAULT_SOURCES}
    assert "vc_turkey_blogs" in source_map
    src = source_map["vc_turkey_blogs"]
    assert src.region == "turkey"
    assert src.fetch_mode == "crawler"
    assert src.source_type == "crawler"


def test_vc_sources_have_lookback_override():
    """Low-frequency VC sources must have lookback_hours_override=168 (7 days)."""
    source_map = {s.source_key: s for s in DEFAULT_SOURCES}
    for key in ("vc_212", "finberg", "endeavor_turkey", "startupcentrum_tr", "vc_turkey_blogs"):
        assert key in source_map, f"{key} missing from DEFAULT_SOURCES"
        assert source_map[key].lookback_hours_override == 168, (
            f"{key} should have lookback_hours_override=168, got {source_map[key].lookback_hours_override}"
        )


def test_turkey_vc_blog_urls_non_empty_and_valid():
    """_TURKEY_VC_BLOG_URLS should contain (name, url) tuples."""
    assert len(_TURKEY_VC_BLOG_URLS) >= 30
    for entry in _TURKEY_VC_BLOG_URLS:
        assert isinstance(entry, tuple) and len(entry) == 2
        name, url = entry
        assert isinstance(name, str) and len(name) > 0
        assert isinstance(url, str) and url.startswith("https://")


def test_total_turkey_sources_count():
    """Total Turkey sources should match DEFAULT_SOURCES (incl. X recent search)."""
    turkey = [s for s in DEFAULT_SOURCES if s.region == "turkey"]
    assert len(turkey) == 15


# --- Turkey nexus filter tests ---


def _make_turkey_item(source_key: str, title: str, summary: str = "", **kwargs) -> NormalizedNewsItem:
    """Helper to build a NormalizedNewsItem for Turkey nexus tests."""
    return NormalizedNewsItem(
        source_key=source_key,
        source_name=kwargs.get("source_name", "Test"),
        source_type=kwargs.get("source_type", "rss"),
        title=title,
        url=kwargs.get("url", "https://example.com/test"),
        canonical_url=kwargs.get("canonical_url", "https://example.com/test"),
        summary=summary,
        published_at=datetime.now(timezone.utc),
        language=kwargs.get("language", "tr"),
        payload=kwargs.get("payload", {}),
        source_weight=kwargs.get("source_weight", 0.70),
    ).with_external_id()


def test_nexus_rejects_french_startup_naboo():
    """Naboo is French — no Turkey nexus signals, should be rejected."""
    item = _make_turkey_item(
        "webrazzi",
        "Lightspeed, Naboo'nun etkinlik odaklı yapay zekasına 70 milyon dolar yatırdı",
        "Naboo yapay zeka destekli etkinlik platformu için yatırım aldı.",
    )
    assert _has_turkey_nexus(item) is False


def test_nexus_rejects_us_pharma_eli_lilly():
    """Eli Lilly / Orna Therapeutics is a US deal — should be rejected."""
    item = _make_turkey_item(
        "egirisim",
        "İlaç şirketi Eli Lilly, Orna Therapeutics'i 2,4 milyar dolara satın alıyor",
    )
    assert _has_turkey_nexus(item) is False


def test_nexus_rejects_vega_security():
    """Vega Security is not Turkish — should be rejected."""
    item = _make_turkey_item(
        "webrazzi",
        "Vega Security, 120 Milyon Dolarlık Seri B Yatırımı Aldı",
    )
    assert _has_turkey_nexus(item) is False


def test_nexus_rejects_stripe_turkish_translation():
    """Stripe article translated to Turkish — no nexus."""
    item = _make_turkey_item(
        "gnews_turkey",
        "Stripe, yapay zeka destekli ödeme altyapısını güncelledi",
        "Stripe yeni AI özelliklerini yayınladı.",
    )
    assert _has_turkey_nexus(item) is False


def test_nexus_rejects_mistral_turkish_translation():
    """Mistral AI is French — translated to Turkish, no nexus."""
    item = _make_turkey_item(
        "newsapi_turkey",
        "Mistral AI, 600 milyon dolar yatırım aldı",
    )
    assert _has_turkey_nexus(item) is False


def test_nexus_accepts_city_istanbul():
    """Article mentioning Istanbul should pass nexus check."""
    item = _make_turkey_item(
        "webrazzi",
        "Istanbul merkezli yapay zeka girişimi X, Seri A turunu kapattı",
    )
    assert _has_turkey_nexus(item) is True


def test_nexus_accepts_city_ankara():
    """Article mentioning Ankara should pass nexus check."""
    item = _make_turkey_item(
        "egirisim",
        "Ankara Teknopark'ta kurulan startup yeni ürününü tanıttı",
    )
    assert _has_turkey_nexus(item) is True


def test_nexus_accepts_known_entity_getir():
    """Getir is in TR_KNOWN_ENTITIES — should pass nexus."""
    item = _make_turkey_item(
        "webrazzi",
        "Getir, 500 milyon dolar topladı",
    )
    assert _has_turkey_nexus(item) is True


def test_nexus_accepts_known_entity_papara():
    """Papara is in TR_KNOWN_ENTITIES — should pass nexus."""
    item = _make_turkey_item(
        "egirisim",
        "Papara, 100 milyon euro yatırım aldı",
    )
    assert _has_turkey_nexus(item) is True


def test_nexus_accepts_known_entity_insider():
    """Insider is in TR_KNOWN_ENTITIES — should pass nexus."""
    item = _make_turkey_item(
        "webrazzi",
        "Insider, yapay zeka pazarlama platformu için Seri D turunu kapattı",
    )
    assert _has_turkey_nexus(item) is True


def test_nexus_accepts_corporate_suffix_as():
    """Articles with A.Ş. corporate suffix should pass nexus."""
    item = _make_turkey_item(
        "gnews_turkey",
        "Acme Teknoloji A.Ş. yeni yazılımını duyurdu",
        "Startup ekosistemi için yazılım çözümü.",
    )
    assert _has_turkey_nexus(item) is True


def test_nexus_accepts_institution_tubitak():
    """Articles mentioning TUBITAK (ASCII form) should pass nexus."""
    item = _make_turkey_item(
        "webrazzi",
        "TUBITAK destekli yapay zeka projesi başlatıldı",
    )
    assert _has_turkey_nexus(item) is True


def test_nexus_accepts_institution_teknopark():
    """Articles mentioning teknopark should pass nexus."""
    item = _make_turkey_item(
        "egirisim",
        "Teknopark İstanbul'da yeni girişim destekleniyor",
    )
    assert _has_turkey_nexus(item) is True


def test_nexus_accepts_country_keyword_turkiye():
    """Articles mentioning Türkiye should pass nexus."""
    item = _make_turkey_item(
        "egirisim",
        "Türkiye'de startup ekosistemi büyümeye devam ediyor",
    )
    assert _has_turkey_nexus(item) is True


def test_nexus_endemic_source_exemption():
    """Endemic sources (e.g. startups_watch) are exempt from nexus check
    and should pass through _is_relevant_turkey_news_item even without nexus signals,
    provided they have ecosystem keywords."""
    item = _make_turkey_item(
        "startups_watch",
        "Yeni girişim yatırım aldı",
        "Startup ekosisteminde yeni gelişme.",
        source_name="Startups.watch",
    )
    # No Turkey nexus signals in the text, but endemic source is exempt
    assert _has_turkey_nexus(item) is False  # No nexus signal in text
    assert "startups_watch" in TR_ENDEMIC_SOURCES  # Exempt from nexus check
    assert _is_relevant_turkey_news_item(item) is True  # Still passes


def test_nexus_non_endemic_source_rejects_without_nexus():
    """Non-endemic source (webrazzi) with ecosystem keywords but no nexus signals
    should be rejected by _is_relevant_turkey_news_item."""
    item = _make_turkey_item(
        "webrazzi",
        "Yeni girişim Seri A yatırım aldı",
        "Startup seed turunda yatırım aldı.",
    )
    # Has ecosystem keywords (girişim, yatırım) but no Turkey nexus
    assert _has_turkey_nexus(item) is False
    assert _is_relevant_turkey_news_item(item) is False


def test_nexus_build_turkey_cluster_rejects_foreign_startup():
    """_build_turkey_cluster should reject foreign startup items from non-endemic sources."""
    now = datetime.now(timezone.utc)
    member = NormalizedNewsItem(
        source_key="webrazzi",
        source_name="Webrazzi",
        source_type="rss",
        title="Lightspeed, Naboo'nun yapay zekasına 70 milyon dolar yatırdı",
        url="https://webrazzi.com/naboo",
        canonical_url="https://webrazzi.com/naboo",
        summary="Naboo etkinlik yapay zeka platformu için yatırım.",
        published_at=now,
        language="tr",
        payload={"turkey_priority": 1, "turkey_classified_by": "llm"},
        source_weight=0.74,
    ).with_external_id()

    cluster = StoryCluster(
        cluster_key="test-cluster-foreign",
        primary_source_key="webrazzi",
        primary_external_id=member.external_id,
        canonical_url=member.canonical_url,
        title=member.title,
        summary=member.summary,
        published_at=now,
        topic_tags=["funding"],
        entities=["Naboo"],
        story_type="funding",
        rank_score=0.5,
        rank_reason="test",
        trust_score=0.7,
        builder_takeaway=None,
        llm_summary=None,
        llm_model=None,
        llm_signal_score=None,
        llm_confidence_score=None,
        llm_topic_tags=[],
        llm_story_type=None,
        members=[member],
    )

    turkey_source_keys = {"webrazzi", "egirisim", "gnews_turkey", "newsapi_turkey"}
    result = _build_turkey_cluster(cluster, turkey_source_keys)
    # Naboo has no Turkey nexus → should be filtered out → cluster is None
    assert result is None
