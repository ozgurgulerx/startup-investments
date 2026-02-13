"""Tests for intel-first enrichment validation guardrails.

These tests are intentionally in the pytest suite (packages/analysis/tests),
not under src/, so `pytest` collection works and import paths stay consistent.
"""

from __future__ import annotations

from typing import List, Optional

from src.automation.news_ingest import LLMEnrichmentResult, _validate_intel_fields


def _make_result(
    ba_title: Optional[str] = None,
    ba_bullets: Optional[List[str]] = None,
    why_it_matters: Optional[str] = None,
) -> LLMEnrichmentResult:
    return LLMEnrichmentResult(
        llm_summary=None,
        builder_takeaway=None,
        llm_model=None,
        llm_signal_score=None,
        llm_confidence_score=None,
        llm_topic_tags=None,
        llm_story_type=None,
        ba_title=ba_title,
        ba_bullets=ba_bullets,
        why_it_matters=why_it_matters,
    )


class TestBaTitleValidation:
    """ba_title hard cap at 90 chars."""

    def test_short_title_unchanged(self) -> None:
        r = _make_result(ba_title="Short title")
        _validate_intel_fields(r)
        assert r.ba_title == "Short title"

    def test_title_at_limit_unchanged(self) -> None:
        title = "A" * 90
        r = _make_result(ba_title=title)
        _validate_intel_fields(r)
        assert r.ba_title == title
        assert len(r.ba_title) == 90

    def test_title_over_limit_truncated(self) -> None:
        title = "A" * 150
        r = _make_result(ba_title=title)
        _validate_intel_fields(r)
        assert r.ba_title is not None
        assert len(r.ba_title) == 90
        assert r.ba_title.endswith("\u2026")

    def test_none_title_unchanged(self) -> None:
        r = _make_result(ba_title=None)
        _validate_intel_fields(r)
        assert r.ba_title is None


class TestWhyItMattersValidation:
    """why_it_matters hard cap at 160 chars."""

    def test_short_text_unchanged(self) -> None:
        r = _make_result(why_it_matters="Brief reason.")
        _validate_intel_fields(r)
        assert r.why_it_matters == "Brief reason."

    def test_at_limit_unchanged(self) -> None:
        text = "B" * 160
        r = _make_result(why_it_matters=text)
        _validate_intel_fields(r)
        assert r.why_it_matters == text

    def test_over_limit_truncated(self) -> None:
        text = "B" * 200
        r = _make_result(why_it_matters=text)
        _validate_intel_fields(r)
        assert r.why_it_matters is not None
        assert len(r.why_it_matters) == 160
        assert r.why_it_matters.endswith("\u2026")

    def test_none_unchanged(self) -> None:
        r = _make_result(why_it_matters=None)
        _validate_intel_fields(r)
        assert r.why_it_matters is None


class TestBaBulletsValidation:
    """ba_bullets capped at 4 items, each <=180 chars."""

    def test_normal_bullets_unchanged(self) -> None:
        bullets = ["Point one", "Point two", "Point three"]
        r = _make_result(ba_bullets=bullets)
        _validate_intel_fields(r)
        assert r.ba_bullets is not None
        assert len(r.ba_bullets) == 3

    def test_five_bullets_trimmed_to_four(self) -> None:
        bullets = [f"Bullet {i}" for i in range(5)]
        r = _make_result(ba_bullets=bullets)
        _validate_intel_fields(r)
        assert r.ba_bullets is not None
        assert len(r.ba_bullets) == 4

    def test_long_bullet_truncated(self) -> None:
        bullets = ["C" * 200]
        r = _make_result(ba_bullets=bullets)
        _validate_intel_fields(r)
        assert r.ba_bullets is not None
        assert len(r.ba_bullets[0]) == 180
        assert r.ba_bullets[0].endswith("\u2026")

    def test_bullet_at_limit_unchanged(self) -> None:
        bullet = "D" * 180
        r = _make_result(ba_bullets=[bullet])
        _validate_intel_fields(r)
        assert r.ba_bullets == [bullet]

    def test_empty_bullets_unchanged(self) -> None:
        r = _make_result(ba_bullets=[])
        _validate_intel_fields(r)
        assert r.ba_bullets == []

    def test_none_bullets_unchanged(self) -> None:
        r = _make_result(ba_bullets=None)
        _validate_intel_fields(r)
        assert r.ba_bullets is None


class TestAntiCopyHeuristic:
    """Bullets with >40 char overlap with cluster title/summary get truncated."""

    def test_overlapping_bullet_flagged(self) -> None:
        cluster_title = "A" * 100  # long enough for 40-char match
        bullets = ["A" * 100, "Something unique"]
        r = _make_result(ba_bullets=bullets)
        _validate_intel_fields(r, cluster_title=cluster_title)
        assert r.ba_bullets is not None
        # First bullet should be truncated to 80 + "..." (flagged), second unchanged
        assert len(r.ba_bullets[0]) == 83
        assert r.ba_bullets[0].endswith("...")
        assert r.ba_bullets[1] == "Something unique"

    def test_no_overlap_unchanged(self) -> None:
        cluster_title = "Completely different text here"
        bullets = ["Unique bullet text"]
        r = _make_result(ba_bullets=bullets)
        _validate_intel_fields(r, cluster_title=cluster_title)
        assert r.ba_bullets == bullets

