"""Tests for the PR #2 YouTube fetch_mode handler in news_ingest.py."""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta, timezone
from types import ModuleType
from unittest.mock import MagicMock

import pytest


@pytest.fixture
def fake_yt_dlp(monkeypatch):
    """Install a fake `yt_dlp` module so the handler never touches the network."""
    fake_module = ModuleType("yt_dlp")

    class _FakeYDL:
        def __init__(self, opts):
            self.opts = opts
            self._mock = MagicMock()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def extract_info(self, url, download=False):
            return fake_module._extract_info_return or {}

    fake_module.YoutubeDL = _FakeYDL
    fake_module._extract_info_return = {}
    monkeypatch.setitem(sys.modules, "yt_dlp", fake_module)
    return fake_module


def _build_ingestor(monkeypatch):
    """Build a DailyNewsIngestor with the minimal env needed for construction."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://fake/fake")
    monkeypatch.setenv("NEWS_LLM_DAILY_BRIEF", "false")
    from src.automation.news_ingest import DailyNewsIngestor

    ing = DailyNewsIngestor()
    ing.max_per_source = 5
    return ing


def test_youtube_channel_url_forces_videos_tab(monkeypatch, fake_yt_dlp):
    """Handler must append /videos when given a channel root URL."""
    from src.automation.news_ingest import DEFAULT_SOURCES

    captured_url = {}
    original_yt_class = fake_yt_dlp.YoutubeDL

    class _CapturingYDL(original_yt_class):
        def extract_info(self, url, download=False):
            captured_url["url"] = url
            return {"entries": []}

    fake_yt_dlp.YoutubeDL = _CapturingYDL

    ing = _build_ingestor(monkeypatch)
    source = next(s for s in DEFAULT_SOURCES if s.source_key == "itu_cekirdek_yt")
    asyncio.run(ing._fetch_youtube_channel(source, lookback_hours=168))
    assert captured_url["url"].endswith(
        "/videos"
    ), f"Expected /videos tab, got {captured_url['url']!r}"


def test_youtube_preserves_videos_suffix(monkeypatch, fake_yt_dlp):
    """If the URL already ends with /videos|/streams|/shorts, don't double-append."""
    from src.automation.news_ingest import DailyNewsIngestor, SourceDefinition

    captured_url = {}

    class _CapturingYDL(fake_yt_dlp.YoutubeDL):
        def extract_info(self, url, download=False):
            captured_url["url"] = url
            return {"entries": []}

    fake_yt_dlp.YoutubeDL = _CapturingYDL

    monkeypatch.setenv("DATABASE_URL", "postgresql://fake/fake")
    ing = DailyNewsIngestor()
    ing.max_per_source = 5
    source = SourceDefinition(
        "custom_yt",
        "Custom (YouTube)",
        "api",
        "https://www.youtube.com/@example/streams",
        region="turkey",
        fetch_mode="youtube_channel",
    )
    asyncio.run(ing._fetch_youtube_channel(source, lookback_hours=168))
    assert captured_url["url"] == "https://www.youtube.com/@example/streams"


def test_youtube_entries_converted_to_items(monkeypatch, fake_yt_dlp):
    """Flat entries should become NormalizedNewsItems with video_id in payload."""
    from src.automation.news_ingest import DEFAULT_SOURCES

    today = datetime.now(timezone.utc)
    fake_yt_dlp._extract_info_return = {
        "entries": [
            {
                "id": "abc123",
                "title": "Demo Day — İTÜ Çekirdek",
                "description": "Startup pitches.",
                "upload_date": today.strftime("%Y%m%d"),
                "thumbnail": "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
            },
            {
                "id": "def456",
                "title": "BİGG Girişim — X Şirketi",
                "description": "Interview.",
                "upload_date": (today - timedelta(days=2)).strftime("%Y%m%d"),
            },
            {
                "id": "",  # invalid — should be skipped
                "title": "No ID",
            },
        ]
    }

    ing = _build_ingestor(monkeypatch)
    source = next(s for s in DEFAULT_SOURCES if s.source_key == "itu_cekirdek_yt")
    items = asyncio.run(ing._fetch_youtube_channel(source, lookback_hours=168))

    assert len(items) == 2
    assert items[0].payload["video_id"] == "abc123"
    assert items[0].url == "https://www.youtube.com/watch?v=abc123"
    assert items[0].language == "tr"
    assert items[0].payload["origin"] == "youtube"
    assert items[1].payload["video_id"] == "def456"


def test_youtube_lookback_filters_old_entries(monkeypatch, fake_yt_dlp):
    """Videos older than the lookback window must be dropped."""
    from src.automation.news_ingest import DEFAULT_SOURCES

    ten_days_ago = (datetime.now(timezone.utc) - timedelta(days=10)).strftime("%Y%m%d")
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    fake_yt_dlp._extract_info_return = {
        "entries": [
            {"id": "old", "title": "Old video", "upload_date": ten_days_ago},
            {"id": "new", "title": "Fresh video", "upload_date": today},
        ]
    }

    ing = _build_ingestor(monkeypatch)
    source = next(s for s in DEFAULT_SOURCES if s.source_key == "itu_cekirdek_yt")
    items = asyncio.run(ing._fetch_youtube_channel(source, lookback_hours=24 * 3))

    kept_ids = {it.payload["video_id"] for it in items}
    assert kept_ids == {"new"}


def test_youtube_missing_yt_dlp_returns_empty(monkeypatch):
    """If yt-dlp is not importable, handler logs and returns []."""
    # Ensure no yt_dlp in sys.modules.
    monkeypatch.setitem(sys.modules, "yt_dlp", None)
    from src.automation.news_ingest import DEFAULT_SOURCES

    ing = _build_ingestor(monkeypatch)
    source = next(s for s in DEFAULT_SOURCES if s.source_key == "itu_cekirdek_yt")
    items = asyncio.run(ing._fetch_youtube_channel(source, lookback_hours=168))
    assert items == []


def test_turkey_source_registry_has_ecosystem_and_gov(monkeypatch):
    """PR #2 source registry smoke test — new source_keys are present."""
    from src.automation.news_ingest import DEFAULT_SOURCES, TR_ENDEMIC_SOURCES

    turkey_keys = {s.source_key for s in DEFAULT_SOURCES if s.region == "turkey"}
    must_have = {
        # Ecosystem RSS
        "itu_cekirdek",
        "bilisim_vadisi",
        # Gov crawlers
        "tubitak",
        "kosgeb",
        "sanayi_teknoloji_bakanlik",
        "istka",
        "ibb_tech_istanbul",
        "tim_teb",
        # YouTube channels
        "trai_yt",
        "itu_cekirdek_yt",
        "startups_watch_yt",
        "bilisim_vadisi_yt",
        "techstars_istanbul_yt",
    }
    missing = must_have - turkey_keys
    assert not missing, f"Missing Turkey sources: {missing}"

    # Ecosystem orgs + gov bodies are endemic (exempt from nexus check).
    for k in ("itu_cekirdek", "bilisim_vadisi", "tubitak", "kosgeb", "istka"):
        assert k in TR_ENDEMIC_SOURCES, f"{k} should be TR_ENDEMIC"


def test_linkedin_bridges_env_gated(monkeypatch):
    """LinkedIn bridge entries must be disabled unless their env var is set."""
    # No env var set — entries should be disabled.
    monkeypatch.delenv("LINKEDIN_BRIDGE_ITUCEKIRDEK_URL", raising=False)
    # Must re-import to re-evaluate module-level code that builds the list.
    import importlib

    import src.automation.news_ingest as ni  # noqa: PLC0415

    importlib.reload(ni)
    sources = {s.source_key: s for s in ni.DEFAULT_SOURCES}
    assert "linkedin_itucekirdek" in sources
    assert sources["linkedin_itucekirdek"].enabled is False

    # Now set the env var and reload — entry should flip to enabled.
    monkeypatch.setenv("LINKEDIN_BRIDGE_ITUCEKIRDEK_URL", "https://rss.app/feed/abc123.xml")
    importlib.reload(ni)
    sources = {s.source_key: s for s in ni.DEFAULT_SOURCES}
    assert sources["linkedin_itucekirdek"].enabled is True
    assert sources["linkedin_itucekirdek"].base_url == "https://rss.app/feed/abc123.xml"


def test_turkey_x_query_pack_includes_ecosystem_handles(monkeypatch):
    """The Turkey X query pack must target the 14 ecosystem+gov handles."""
    from src.automation.x_trends import load_query_pack

    pack = load_query_pack()
    turkey_queries = pack.get("turkey") or []
    joined = " ".join(turkey_queries).lower()
    for handle in [
        "turkiyeai",
        "212vc",
        "endeavor_turkey",
        "itucekirdek",
        "ariteknokent",
        "aitrorgtr",
        "bilisimvadisitr",
        "tubitak",
        "kosgeb",
        "tcsanayi",
        "teblegirisim",
        "istkaorgtr",
    ]:
        assert f"from:{handle}".lower() in joined, f"Missing handle in X query pack: {handle}"
