"""Tests for the ecosystem-memory external ingestion module (PR #4.4–4.6)."""

from __future__ import annotations

import asyncio
import json
from datetime import date
from typing import List
from unittest.mock import MagicMock

import pytest

# ---------------------------------------------------------------------------
# VTT parser
# ---------------------------------------------------------------------------


def test_parse_webvtt_strips_cues():
    from src.intelligence.ecosystem_ingest import _parse_webvtt

    vtt = """WEBVTT
Kind: captions
Language: tr

00:00:00.000 --> 00:00:03.500
Merhaba arkadaşlar, bugün konumuz

00:00:03.500 --> 00:00:06.000
Türk girişim ekosistemi.

00:00:06.000 --> 00:00:09.500 align:start position:0%
<00:00:06.500><c>Unicorn sayımız</c> yedi oldu.
"""
    result = _parse_webvtt(vtt)
    assert "Merhaba arkadaşlar" in result
    assert "Türk girişim" in result
    assert "Unicorn sayımız" in result
    assert "yedi oldu" in result
    assert "WEBVTT" not in result
    assert "-->" not in result
    assert "<c>" not in result
    assert "00:00:" not in result


# ---------------------------------------------------------------------------
# LLM distiller — contract + resilience
# ---------------------------------------------------------------------------


@pytest.fixture
def azure_stub():
    """Stub Azure OpenAI client returning a scripted JSON response."""
    client = MagicMock()
    completions = MagicMock()
    chat = MagicMock()
    chat.completions = completions
    client.chat = chat

    client._script: List[str] = []

    async def fake_create(**kwargs):
        payload = client._script.pop(0) if client._script else "[]"
        msg = MagicMock()
        msg.content = payload
        choice = MagicMock()
        choice.message = msg
        resp = MagicMock()
        resp.choices = [choice]
        return resp

    completions.create = fake_create
    return client


def test_distill_produces_candidate_facts(azure_stub, monkeypatch):
    from src.intelligence.ecosystem_ingest import SourceMeta, distill_document_to_facts

    azure_stub._script.append(
        json.dumps(
            [
                {
                    "region": "turkey",
                    "sector": "fintech",
                    "fact_key": "active_startup_count",
                    "fact_value": {"value": 90, "unit": "count"},
                    "narrative": "Turkey has 90+ active fintech startups as of Q3 2025.",
                    "confidence": 0.85,
                    "as_of_date": "2025-09-30",
                },
                {
                    "region": "turkey",
                    "sector": None,
                    "fact_key": "funding_total_usd_q3_2025",
                    "fact_value": {"value": 120000000, "unit": "USD"},
                    "narrative": "TR VC totals 2025 Q3: $120M.",
                    "confidence": 0.9,
                    "as_of_date": "2025-09-30",
                },
                # Bad entry: missing narrative — must be dropped
                {
                    "region": "turkey",
                    "fact_key": "noise",
                    "fact_value": {"value": 1},
                    "confidence": 0.5,
                },
            ]
        )
    )

    meta = SourceMeta(
        source_key="test_kpmg",
        source_type="pdf",
        title="KPMG Q3 2025",
        publisher="KPMG Turkey",
        period_covered="2025 Q3",
        region="turkey",
    )
    facts = asyncio.run(
        distill_document_to_facts(
            azure_stub,
            "gpt-5-nano",
            doc_text="fake long doc text",
            source=meta,
        )
    )
    assert len(facts) == 2  # bad entry dropped
    assert facts[0].region == "turkey"
    assert facts[0].sector == "fintech"
    assert 0 <= facts[0].confidence <= 1
    assert facts[0].as_of_date == date(2025, 9, 30)


def test_distill_tolerates_wrapped_object(azure_stub):
    """LLM sometimes wraps arrays in {'facts': [...]}. Loader must unwrap."""
    from src.intelligence.ecosystem_ingest import SourceMeta, distill_document_to_facts

    azure_stub._script.append(
        json.dumps(
            {
                "facts": [
                    {
                        "region": "global",
                        "sector": "ai",
                        "fact_key": "share_of_funding",
                        "fact_value": {"value": 0.52},
                        "narrative": "AI captured 52% of global VC in 2025.",
                        "confidence": 0.8,
                        "as_of_date": "2025-12-31",
                    }
                ]
            }
        )
    )
    facts = asyncio.run(
        distill_document_to_facts(
            azure_stub,
            "gpt-5-nano",
            doc_text="x",
            source=SourceMeta(source_key="k", source_type="pdf", title="t", region="global"),
        )
    )
    assert len(facts) == 1
    assert facts[0].region == "global"


def test_distill_returns_empty_on_bad_json(azure_stub):
    from src.intelligence.ecosystem_ingest import SourceMeta, distill_document_to_facts

    azure_stub._script.append("not valid json at all")
    facts = asyncio.run(
        distill_document_to_facts(
            azure_stub,
            "gpt-5-nano",
            doc_text="x",
            source=SourceMeta(source_key="k", source_type="pdf", title="t"),
        )
    )
    assert facts == []


def test_distill_drops_invalid_region(azure_stub):
    from src.intelligence.ecosystem_ingest import SourceMeta, distill_document_to_facts

    azure_stub._script.append(
        json.dumps(
            [
                {
                    "region": "mars",
                    "fact_key": "x",
                    "fact_value": {"value": 1},
                    "narrative": "bogus",
                    "confidence": 0.9,
                    "as_of_date": "2025-01-01",
                }
            ]
        )
    )
    facts = asyncio.run(
        distill_document_to_facts(
            azure_stub,
            "gpt-5-nano",
            doc_text="x",
            source=SourceMeta(source_key="k", source_type="pdf", title="t"),
        )
    )
    assert facts == []


# ---------------------------------------------------------------------------
# Module API surface
# ---------------------------------------------------------------------------


def test_module_api_surface():
    from src.intelligence import ecosystem_ingest

    for name in (
        "fetch_pdf",
        "fetch_html",
        "fetch_youtube_transcript",
        "distill_document_to_facts",
        "ingest_external_source",
        "ingest_kpmg_reports",
        "ingest_startups_watch_blog",
        "ingest_youtube_channel",
        "SourceMeta",
        "CandidateFact",
        "KPMG_REPORTS",
        "STARTUPS_WATCH_POSTS",
    ):
        assert hasattr(ecosystem_ingest, name), f"missing public attr: {name}"


def test_kpmg_catalog_has_real_urls():
    from src.intelligence.ecosystem_ingest import KPMG_REPORTS

    assert len(KPMG_REPORTS) >= 1
    for entry in KPMG_REPORTS:
        assert entry["url"].startswith("https://")
        assert "kpmg" in entry["url"].lower()


def test_startups_watch_catalog_has_real_urls():
    from src.intelligence.ecosystem_ingest import STARTUPS_WATCH_POSTS

    assert len(STARTUPS_WATCH_POSTS) >= 2
    for entry in STARTUPS_WATCH_POSTS:
        assert entry["url"].startswith("https://")
        assert "startups.watch" in entry["url"]


# ---------------------------------------------------------------------------
# LLM relevance gate (PR #4.7)
# ---------------------------------------------------------------------------


def test_llm_gate_disabled_by_default(monkeypatch):
    monkeypatch.delenv("TR_LLM_RELEVANCE_GATE", raising=False)
    from src.automation.tr_relevance_llm import is_llm_gate_enabled

    assert is_llm_gate_enabled() is False


def test_llm_gate_enabled_on_env(monkeypatch):
    from src.automation.tr_relevance_llm import is_llm_gate_enabled

    for val in ("true", "1", "yes", "on", "TRUE"):
        monkeypatch.setenv("TR_LLM_RELEVANCE_GATE", val)
        assert is_llm_gate_enabled() is True


def test_classify_items_keeps_startup_news(monkeypatch, azure_stub):
    from src.automation import tr_relevance_llm

    azure_stub._script.append(
        json.dumps({"labels": ["STARTUP_NEWS", "CORPORATE_NEWS", "OTHER", "POLICY_NEWS"]})
    )
    items = [
        {"title": "Startup raises $5M", "summary": "Istanbul AI startup seed round"},
        {"title": "A101 opens new stores", "summary": "Retail chain expands"},
        {"title": "Football match result", "summary": "Fenerbahce wins"},
        {"title": "KOSGEB launches new grant", "summary": "Public program for SMEs"},
    ]
    monkeypatch.setenv("TR_LLM_RELEVANCE_GATE", "true")
    kept, stats = asyncio.run(tr_relevance_llm.filter_items(azure_stub, "gpt-5-nano", items))
    # Keep STARTUP_NEWS + POLICY_NEWS
    assert len(kept) == 2
    assert kept[0]["title"].startswith("Startup")
    assert kept[1]["title"].startswith("KOSGEB")
    assert stats["STARTUP_NEWS"] == 1
    assert stats["POLICY_NEWS"] == 1
    assert stats["CORPORATE_NEWS"] == 1
    assert stats["OTHER"] == 1


def test_classify_items_fails_open(monkeypatch):
    """Classifier error must not silently drop items."""
    from src.automation import tr_relevance_llm

    # Bad azure client: completions.create raises
    bad_client = MagicMock()
    bad_client.chat = MagicMock()

    async def boom(**kwargs):
        raise RuntimeError("API down")

    bad_client.chat.completions = MagicMock()
    bad_client.chat.completions.create = boom

    monkeypatch.setenv("TR_LLM_RELEVANCE_GATE", "true")
    items = [{"title": "Anything", "summary": "anything"}]
    kept, stats = asyncio.run(tr_relevance_llm.filter_items(bad_client, "gpt-5-nano", items))
    assert kept == items  # nothing dropped
    assert stats.get("STARTUP_NEWS", 0) == 1


def test_classify_items_gate_off_returns_everything(monkeypatch):
    from src.automation import tr_relevance_llm

    monkeypatch.delenv("TR_LLM_RELEVANCE_GATE", raising=False)
    items = [{"title": "x", "summary": "y"}, {"title": "a", "summary": "b"}]
    kept, stats = asyncio.run(tr_relevance_llm.filter_items(None, "gpt-5-nano", items))
    assert kept == items
    assert stats == {"gate_disabled": 2}
