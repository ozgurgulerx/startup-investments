"""Tests for PR #4.3 — ecosystem facts injection into the daily brief prompt."""

from __future__ import annotations

import asyncio
from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Prompt copy — the commentary guidance for the LLM
# ---------------------------------------------------------------------------


def _load_news_ingest_source() -> str:
    from src.automation import news_ingest

    return __import__("pathlib").Path(news_ingest.__file__).read_text(encoding="utf-8")


def test_prompt_mentions_ecosystem_context():
    src = _load_news_ingest_source()
    assert "ECOSYSTEM CONTEXT" in src, "daily-brief prompt must declare ECOSYSTEM CONTEXT section"
    assert (
        "ecosystem_facts" in src
    ), "prompt must reference the editorial_memory.ecosystem_facts key"


def test_prompt_mentions_global_vs_turkey_contrast():
    src = _load_news_ingest_source()
    assert "GLOBAL VS TURKEY CONTRAST" in src
    assert (
        "agentic" in src.lower() or "weighted" in src.lower()
    ), "prompt should include a concrete TR-vs-global contrast example"


def test_prompt_discourages_listing():
    """We don't want the LLM to just list all ecosystem facts — weave naturally."""
    src = _load_news_ingest_source()
    # Grep the ECOSYSTEM CONTEXT paragraph for 'do NOT list'
    idx = src.find("ECOSYSTEM CONTEXT")
    assert idx >= 0
    snippet = src[idx : idx + 1200]
    assert "Do NOT list" in snippet or "Do not list" in snippet.lower()
    assert "naturally" in snippet


# ---------------------------------------------------------------------------
# _fetch_editorial_memory — ecosystem_facts block
# ---------------------------------------------------------------------------


class _FakeIngestor:
    """Minimal stub exposing the _fetch_editorial_memory method from news_ingest.

    We can't easily instantiate DailyNewsIngestor without DATABASE_URL env,
    so we borrow the unbound method.
    """

    pass


def _make_conn_with_rows(
    brief_rows,
    entity_rows=None,
):
    conn = MagicMock()

    async def fake_fetch(query, *args, **kwargs):
        q_lower = query.lower()
        if "news_daily_editions" in q_lower:
            return brief_rows
        if "news_entity_facts" in q_lower:
            return entity_rows or []
        return []

    conn.fetch = fake_fetch
    return conn


def test_editorial_memory_includes_ecosystem_facts(monkeypatch):
    """When ecosystem_memory returns rows, they land under memory['ecosystem_facts']."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://fake/fake")
    monkeypatch.setenv("NEWS_LLM_DAILY_BRIEF", "false")

    from src.automation.news_ingest import DailyNewsIngestor

    # Stub out ecosystem reader
    fake_eco_rows = [
        {
            "region": "turkey",
            "sector": None,
            "fact_key": "unicorn_count",
            "narrative": "Türkiye'de 7 unicorn bulunuyor.",
            "as_of_date": "2026-04-01",
            "confidence": 0.9,
        },
        {
            "region": "turkey",
            "sector": "mobile_gaming",
            "fact_key": "sector_strength",
            "narrative": "Türkiye mobil oyunda Avrupa lideri.",
            "as_of_date": "2026-04-01",
            "confidence": 0.95,
        },
        {
            "region": "global",
            "sector": "ai",
            "fact_key": "share_of_funding",
            "narrative": "2025'te global VC'nin %52'si AI startuplarına aktı.",
            "as_of_date": "2026-02-15",
            "confidence": 0.8,
        },
    ]

    async def fake_load(conn, *, region, limit=12, freshness_months=18):
        return fake_eco_rows

    with patch(
        "src.intelligence.ecosystem_memory.load_ecosystem_facts_for_brief",
        new=fake_load,
    ):
        ing = DailyNewsIngestor()
        conn = _make_conn_with_rows(brief_rows=[], entity_rows=[])
        memory = asyncio.run(
            ing._fetch_editorial_memory(
                conn,
                edition_date=date(2026, 4, 19),
                region="turkey",
                entity_names=[],
            )
        )

    assert "ecosystem_facts" in memory
    block = memory["ecosystem_facts"]
    assert "turkey" in block
    assert "global" in block
    assert any("unicorn" in n.lower() for n in block["turkey"])
    assert any("mobil" in n.lower() for n in block["turkey"])
    assert any("global vc" in n.lower() or "ai" in n.lower() for n in block["global"])


def test_global_brief_receives_global_facts_only(monkeypatch):
    """Global region must NOT receive turkey-specific facts."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://fake/fake")
    monkeypatch.setenv("NEWS_LLM_DAILY_BRIEF", "false")

    from src.automation.news_ingest import DailyNewsIngestor

    # The reader itself is region-aware; verify our caller passes region=global.
    captured: dict = {}

    async def fake_load(conn, *, region, limit=12, freshness_months=18):
        captured["region"] = region
        # Real reader would query WHERE region = ANY(['global']) only;
        # mimic that by returning only global facts.
        return [
            {
                "region": "global",
                "sector": None,
                "fact_key": "total_funding_usd_2025",
                "narrative": "Global VC 2025 ~$290B.",
                "as_of_date": "2026-02-15",
                "confidence": 0.85,
            }
        ]

    with patch(
        "src.intelligence.ecosystem_memory.load_ecosystem_facts_for_brief",
        new=fake_load,
    ):
        ing = DailyNewsIngestor()
        conn = _make_conn_with_rows(brief_rows=[], entity_rows=[])
        memory = asyncio.run(
            ing._fetch_editorial_memory(
                conn,
                edition_date=date(2026, 4, 19),
                region="global",
                entity_names=[],
            )
        )

    assert captured["region"] == "global"
    assert "ecosystem_facts" in memory
    assert "turkey" not in memory["ecosystem_facts"]
    assert "global" in memory["ecosystem_facts"]


def test_missing_ecosystem_module_is_tolerated(monkeypatch):
    """If the ecosystem_memory import fails, the daily brief still runs."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://fake/fake")
    monkeypatch.setenv("NEWS_LLM_DAILY_BRIEF", "false")

    from src.automation.news_ingest import DailyNewsIngestor

    async def bad_load(*a, **k):
        raise RuntimeError("pre-migration-084: table missing")

    with patch(
        "src.intelligence.ecosystem_memory.load_ecosystem_facts_for_brief",
        new=bad_load,
    ):
        ing = DailyNewsIngestor()
        conn = _make_conn_with_rows(brief_rows=[], entity_rows=[])
        memory = asyncio.run(
            ing._fetch_editorial_memory(
                conn,
                edition_date=date(2026, 4, 19),
                region="turkey",
                entity_names=[],
            )
        )

    # Should NOT raise; ecosystem_facts simply not present.
    assert "ecosystem_facts" not in memory
