"""Tests for digest_signals module — signal context for daily email digest."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock

import pytest

from src.automation.digest_signals import (
    DigestSignal,
    DigestSignalContext,
    _extract_lifecycle_transition,
    _row_to_digest_signal,
    _fetch_top_signals,
    _fetch_cluster_signal_map,
    fetch_cluster_ids_for_edition,
    load_digest_signal_context,
)
from src.automation.news_digest import DailyNewsDigestSender


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_signal_row(
    *,
    id: str = "aaaa-bbbb",
    domain: str = "architecture",
    cluster_name: str = "RAG adoption",
    claim: str = "RAG adoption is accelerating",
    status: str = "emerging",
    conviction: float = 0.72,
    momentum: float = 0.85,
    impact: float = 0.60,
    evidence_count: int = 12,
    unique_company_count: int = 5,
    metadata_json: Any = None,
    first_seen_at: Any = None,
) -> Dict[str, Any]:
    return {
        "id": id,
        "domain": domain,
        "cluster_name": cluster_name,
        "claim": claim,
        "status": status,
        "conviction": conviction,
        "momentum": momentum,
        "impact": impact,
        "evidence_count": evidence_count,
        "unique_company_count": unique_company_count,
        "metadata_json": metadata_json or {},
        "first_seen_at": first_seen_at or datetime.now(timezone.utc),
    }


class FakeConn:
    """Lightweight mock for asyncpg connection with configurable query results."""

    def __init__(self, *, fetch_results: Optional[List[List[Dict]]] = None, fetchrow_result: Optional[Dict] = None):
        self._fetch_results = fetch_results or []
        self._fetch_call_idx = 0
        self._fetchrow_result = fetchrow_result

    async def fetch(self, query: str, *args: Any) -> List[Dict]:
        if self._fetch_call_idx < len(self._fetch_results):
            result = self._fetch_results[self._fetch_call_idx]
            self._fetch_call_idx += 1
            return result
        return []

    async def fetchrow(self, query: str, *args: Any) -> Optional[Dict]:
        return self._fetchrow_result


# ---------------------------------------------------------------------------
# DigestSignal construction tests
# ---------------------------------------------------------------------------

class TestDigestSignalConstruction:
    def test_basic_construction(self):
        sig = DigestSignal(
            id="123",
            domain="architecture",
            cluster_name="RAG",
            claim="RAG is growing",
            status="emerging",
            conviction=0.72,
            momentum=0.85,
            impact=0.6,
            evidence_count=10,
            unique_company_count=5,
        )
        assert sig.id == "123"
        assert sig.status == "emerging"
        assert sig.lifecycle_transition is None
        assert sig.transition_recency is None

    def test_construction_with_transition(self):
        sig = DigestSignal(
            id="456",
            domain="gtm",
            cluster_name=None,
            claim="Open-source GTM is emerging",
            status="accelerating",
            conviction=0.80,
            momentum=0.90,
            impact=0.70,
            evidence_count=20,
            unique_company_count=8,
            lifecycle_transition="emerging → accelerating",
            transition_recency="1d ago",
        )
        assert sig.lifecycle_transition == "emerging → accelerating"
        assert sig.transition_recency == "1d ago"


# ---------------------------------------------------------------------------
# Lifecycle transition extraction
# ---------------------------------------------------------------------------

class TestLifecycleTransition:
    def test_no_metadata(self):
        t, r = _extract_lifecycle_transition(None, cutoff=datetime.now(timezone.utc) - timedelta(hours=48))
        assert t is None
        assert r is None

    def test_empty_transitions(self):
        t, r = _extract_lifecycle_transition({"lifecycle_transitions": []}, cutoff=datetime.now(timezone.utc) - timedelta(hours=48))
        assert t is None

    def test_recent_transition(self):
        now = datetime.now(timezone.utc)
        meta = {
            "lifecycle_transitions": [
                {"from": "candidate", "to": "emerging", "at": (now - timedelta(hours=72)).isoformat()},
                {"from": "emerging", "to": "accelerating", "at": (now - timedelta(hours=12)).isoformat()},
            ]
        }
        cutoff = now - timedelta(hours=48)
        t, r = _extract_lifecycle_transition(meta, cutoff=cutoff)
        assert t == "emerging → accelerating"
        assert r is not None
        assert "h ago" in r

    def test_old_transition_ignored(self):
        now = datetime.now(timezone.utc)
        meta = {
            "lifecycle_transitions": [
                {"from": "candidate", "to": "emerging", "at": (now - timedelta(days=5)).isoformat()},
            ]
        }
        cutoff = now - timedelta(hours=48)
        t, r = _extract_lifecycle_transition(meta, cutoff=cutoff)
        assert t is None

    def test_json_string_metadata(self):
        now = datetime.now(timezone.utc)
        meta_str = json.dumps({
            "lifecycle_transitions": [
                {"from": "emerging", "to": "accelerating", "at": (now - timedelta(hours=6)).isoformat()},
            ]
        })
        cutoff = now - timedelta(hours=48)
        t, r = _extract_lifecycle_transition(meta_str, cutoff=cutoff)
        assert t == "emerging → accelerating"


# ---------------------------------------------------------------------------
# Row to DigestSignal conversion
# ---------------------------------------------------------------------------

class TestRowToDigestSignal:
    def test_basic_row(self):
        row = _make_signal_row()
        cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
        sig = _row_to_digest_signal(row, cutoff=cutoff)
        assert sig.id == "aaaa-bbbb"
        assert sig.domain == "architecture"
        assert sig.claim == "RAG adoption is accelerating"
        assert sig.momentum == 0.85
        assert sig.lifecycle_transition is None

    def test_row_with_transition(self):
        now = datetime.now(timezone.utc)
        row = _make_signal_row(
            metadata_json={
                "lifecycle_transitions": [
                    {"from": "emerging", "to": "accelerating", "at": (now - timedelta(hours=6)).isoformat()},
                ]
            }
        )
        cutoff = now - timedelta(hours=48)
        sig = _row_to_digest_signal(row, cutoff=cutoff)
        assert sig.lifecycle_transition == "emerging → accelerating"

    def test_row_claim_sanitizes_duplicate_currency_symbols(self):
        row = _make_signal_row(claim="AI funding: $$4740.1B across 412 deals in 30 days")
        cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
        sig = _row_to_digest_signal(row, cutoff=cutoff)
        assert sig.claim == "AI funding: $4740.1B across 412 deals in 30 days"


# ---------------------------------------------------------------------------
# DB query tests with mocked connections
# ---------------------------------------------------------------------------

class TestFetchTopSignals:
    def test_returns_signals(self):
        rows = [_make_signal_row(id="s1"), _make_signal_row(id="s2", momentum=0.90)]
        conn = FakeConn(fetch_results=[rows])
        result = asyncio.run(_fetch_top_signals(conn, region="global", limit=5))
        assert len(result) == 2
        assert result[0].id == "s1"
        assert result[1].id == "s2"

    def test_returns_empty(self):
        conn = FakeConn(fetch_results=[[]])
        result = asyncio.run(_fetch_top_signals(conn, region="global"))
        assert result == []


class TestFetchClusterSignalMap:
    def test_maps_clusters(self):
        rows = [
            {**_make_signal_row(id="s1"), "cluster_id": "c1"},
            {**_make_signal_row(id="s2"), "cluster_id": "c1"},
            {**_make_signal_row(id="s3"), "cluster_id": "c2"},
        ]
        conn = FakeConn(fetch_results=[rows])
        result = asyncio.run(_fetch_cluster_signal_map(conn, cluster_ids=["c1", "c2"], region="global"))
        assert "c1" in result
        assert len(result["c1"]) == 2
        assert "c2" in result
        assert len(result["c2"]) == 1

    def test_empty_cluster_ids(self):
        conn = FakeConn()
        result = asyncio.run(_fetch_cluster_signal_map(conn, cluster_ids=[], region="global"))
        assert result == {}


class TestFetchClusterIdsForEdition:
    def test_returns_ids(self):
        conn = FakeConn(fetchrow_result={"top_cluster_ids": ["uuid1", "uuid2", "uuid3"]})
        result = asyncio.run(fetch_cluster_ids_for_edition(conn, "2026-02-12", region="global", limit=10))
        assert result == ["uuid1", "uuid2", "uuid3"]

    def test_no_edition(self):
        conn = FakeConn(fetchrow_result=None)
        result = asyncio.run(fetch_cluster_ids_for_edition(conn, "2026-02-12", region="global"))
        assert result == []

    def test_empty_ids(self):
        conn = FakeConn(fetchrow_result={"top_cluster_ids": []})
        result = asyncio.run(fetch_cluster_ids_for_edition(conn, "2026-02-12", region="global"))
        assert result == []


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

class TestLoadDigestSignalContext:
    def test_returns_none_when_no_signals(self):
        conn = FakeConn(fetch_results=[[]])
        result = asyncio.run(
            load_digest_signal_context(conn, region="global", cluster_ids=["c1"])
        )
        assert result is None

    def test_returns_context(self):
        top_rows = [_make_signal_row(id="s1")]
        cluster_rows = [{**_make_signal_row(id="s1"), "cluster_id": "c1"}]
        conn = FakeConn(fetch_results=[top_rows, cluster_rows])
        result = asyncio.run(
            load_digest_signal_context(conn, region="global", cluster_ids=["c1"])
        )
        assert result is not None
        assert len(result.top_signals) == 1
        assert "c1" in result.cluster_signal_map
        assert result.narrative is None  # No azure client


# ---------------------------------------------------------------------------
# HTML rendering
# ---------------------------------------------------------------------------

class TestSignalRadarHTML:
    def test_empty_context_returns_empty(self):
        html = DailyNewsDigestSender._build_signal_radar_html(None)
        assert html == ""

    def test_empty_signals_returns_empty(self):
        ctx = DigestSignalContext(top_signals=[])
        html = DailyNewsDigestSender._build_signal_radar_html(ctx)
        assert html == ""

    def test_renders_signals(self):
        sig = DigestSignal(
            id="s1", domain="architecture", cluster_name="RAG",
            claim="RAG adoption accelerating", status="emerging",
            conviction=0.72, momentum=0.85, impact=0.60,
            evidence_count=12, unique_company_count=5,
        )
        ctx = DigestSignalContext(top_signals=[sig])
        html = DailyNewsDigestSender._build_signal_radar_html(ctx)
        assert "SIGNAL RADAR" in html
        assert "emerging" in html.lower()  # CSS text-transform:uppercase handles display
        assert "RAG adoption accelerating" in html
        assert "0.85" in html  # momentum
        assert "5 companies" in html

    def test_renders_narrative(self):
        sig = DigestSignal(
            id="s1", domain="architecture", cluster_name="RAG",
            claim="RAG adoption accelerating", status="accelerating",
            conviction=0.80, momentum=0.90, impact=0.70,
            evidence_count=15, unique_company_count=8,
        )
        ctx = DigestSignalContext(
            top_signals=[sig],
            narrative="Today's stories point to continued RAG momentum.",
        )
        html = DailyNewsDigestSender._build_signal_radar_html(ctx)
        assert "Today's stories point to continued RAG momentum." in html

    def test_renders_transition(self):
        sig = DigestSignal(
            id="s1", domain="gtm", cluster_name=None,
            claim="Open-source GTM emerging", status="accelerating",
            conviction=0.75, momentum=0.88, impact=0.65,
            evidence_count=10, unique_company_count=6,
            lifecycle_transition="emerging → accelerating",
            transition_recency="1d ago",
        )
        ctx = DigestSignalContext(top_signals=[sig])
        html = DailyNewsDigestSender._build_signal_radar_html(ctx)
        assert "Newly accelerating" in html
        assert "1d ago" in html


# ---------------------------------------------------------------------------
# Plain-text rendering
# ---------------------------------------------------------------------------

class TestSignalRadarText:
    def test_empty_context_returns_empty(self):
        lines = DailyNewsDigestSender._build_signal_radar_text(None)
        assert lines == []

    def test_renders_signals(self):
        sig = DigestSignal(
            id="s1", domain="architecture", cluster_name="RAG",
            claim="RAG adoption accelerating", status="emerging",
            conviction=0.72, momentum=0.85, impact=0.60,
            evidence_count=12, unique_company_count=5,
        )
        ctx = DigestSignalContext(top_signals=[sig])
        lines = DailyNewsDigestSender._build_signal_radar_text(ctx)
        text = "\n".join(lines)
        assert "SIGNAL RADAR" in text
        assert "[EMERGING]" in text
        assert "RAG adoption accelerating" in text
        assert "5 companies" in text


# ---------------------------------------------------------------------------
# Story signal tags in HTML
# ---------------------------------------------------------------------------

class TestStorySignalTags:
    def test_signal_tags_appear_in_html(self):
        from src.automation.news_digest import DigestStory
        story = DigestStory(
            title="Test story",
            summary="Summary",
            builder_takeaway="Takeaway",
            url="https://example.com",
            source="TechCrunch",
            signal_tags=["RAG adoption", "Agent tooling"],
        )
        sender = DailyNewsDigestSender(database_url="postgres://example")
        html = sender._build_story_rows_html([story], "2026-02-12")
        assert "Signals: RAG adoption, Agent tooling" in html

    def test_no_signal_tags_no_div(self):
        from src.automation.news_digest import DigestStory
        story = DigestStory(
            title="Test story",
            summary="Summary",
            builder_takeaway="Takeaway",
            url="https://example.com",
            source="TechCrunch",
        )
        sender = DailyNewsDigestSender(database_url="postgres://example")
        html = sender._build_story_rows_html([story], "2026-02-12")
        assert "Signals:" not in html

    def test_signal_tags_in_text(self):
        from src.automation.news_digest import DigestStory
        story = DigestStory(
            title="Test story",
            summary="Summary",
            builder_takeaway="Takeaway",
            url="https://example.com",
            source="TechCrunch",
            signal_tags=["RAG adoption"],
        )
        lines = DailyNewsDigestSender._build_stories_text(
            [story], "https://buildatlas.net", "2026-02-12"
        )
        text = "\n".join(lines)
        assert "Signals: RAG adoption" in text


# ---------------------------------------------------------------------------
# Attach signal tags helper
# ---------------------------------------------------------------------------

class TestAttachSignalTags:
    def test_attaches_tags(self):
        from src.automation.news_digest import DigestStory
        stories = [
            DigestStory(title="S1", summary="", builder_takeaway="", url="", source="", cluster_id="c1"),
            DigestStory(title="S2", summary="", builder_takeaway="", url="", source="", cluster_id="c2"),
            DigestStory(title="S3", summary="", builder_takeaway="", url="", source=""),
        ]
        cluster_signal_map = {
            "c1": [
                DigestSignal(id="s1", domain="arch", cluster_name="RAG", claim="RAG claim",
                             status="emerging", conviction=0.7, momentum=0.8, impact=0.5,
                             evidence_count=5, unique_company_count=3),
            ],
            "c2": [
                DigestSignal(id="s2", domain="gtm", cluster_name=None, claim="Open-source GTM is hot",
                             status="accelerating", conviction=0.6, momentum=0.9, impact=0.4,
                             evidence_count=3, unique_company_count=2),
            ],
        }
        DailyNewsDigestSender._attach_signal_tags(stories, cluster_signal_map)
        assert stories[0].signal_tags == ["RAG"]
        assert stories[1].signal_tags == ["Open-source GTM is hot"]  # falls back to claim[:40]
        assert stories[2].signal_tags == []  # no cluster_id


# ---------------------------------------------------------------------------
# Feature flag off
# ---------------------------------------------------------------------------

class TestFeatureFlag:
    def test_signals_disabled(self, monkeypatch):
        monkeypatch.setenv("NEWS_DIGEST_SIGNALS_ENABLED", "false")
        sender = DailyNewsDigestSender(database_url="postgres://example")
        assert sender.signals_enabled is False

    def test_signals_enabled_default(self, monkeypatch):
        monkeypatch.delenv("NEWS_DIGEST_SIGNALS_ENABLED", raising=False)
        sender = DailyNewsDigestSender(database_url="postgres://example")
        assert sender.signals_enabled is True


# ---------------------------------------------------------------------------
# Full email HTML includes signal section
# ---------------------------------------------------------------------------

class TestFullEmailWithSignals:
    def test_email_html_includes_signal_radar(self):
        sig = DigestSignal(
            id="s1", domain="architecture", cluster_name="RAG",
            claim="RAG adoption accelerating", status="emerging",
            conviction=0.72, momentum=0.85, impact=0.60,
            evidence_count=12, unique_company_count=5,
        )
        ctx = DigestSignalContext(top_signals=[sig])
        sender = DailyNewsDigestSender(database_url="postgres://example")
        from src.automation.news_digest import DigestStory
        stories = [
            DigestStory(title="Story 1", summary="Sum", builder_takeaway="BT",
                        url="https://example.com", source="TC")
        ]
        html = sender._build_email_html(
            edition_date="2026-02-12",
            stories=stories,
            unsubscribe_url="https://example.com/unsub",
            signal_context=ctx,
        )
        assert "SIGNAL RADAR" in html
        assert "RAG adoption accelerating" in html

    def test_email_html_without_signals(self):
        sender = DailyNewsDigestSender(database_url="postgres://example")
        from src.automation.news_digest import DigestStory
        stories = [
            DigestStory(title="Story 1", summary="Sum", builder_takeaway="BT",
                        url="https://example.com", source="TC")
        ]
        html = sender._build_email_html(
            edition_date="2026-02-12",
            stories=stories,
            unsubscribe_url="https://example.com/unsub",
        )
        assert "SIGNAL RADAR" not in html

    def test_email_text_includes_signal_radar(self):
        sig = DigestSignal(
            id="s1", domain="architecture", cluster_name="RAG",
            claim="RAG adoption accelerating", status="emerging",
            conviction=0.72, momentum=0.85, impact=0.60,
            evidence_count=12, unique_company_count=5,
        )
        ctx = DigestSignalContext(top_signals=[sig])
        sender = DailyNewsDigestSender(database_url="postgres://example")
        from src.automation.news_digest import DigestStory
        stories = [
            DigestStory(title="Story 1", summary="Sum", builder_takeaway="BT",
                        url="https://example.com", source="TC")
        ]
        text = sender._build_email_text(
            edition_date="2026-02-12",
            stories=stories,
            unsubscribe_url="https://example.com/unsub",
            signal_context=ctx,
        )
        assert "SIGNAL RADAR" in text
        assert "RAG adoption accelerating" in text
