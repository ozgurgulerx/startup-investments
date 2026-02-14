"""Unit tests for funding claim extraction heuristics in memory_gate."""

from __future__ import annotations

from src.automation.memory_gate import FactExtractor


def _get_claim(claims, fact_key: str):
    for c in claims:
        if getattr(c, "fact_key", None) == fact_key:
            return c
    return None


def test_funding_extracts_lead_investor_led_by():
    fx = FactExtractor()
    claims = fx.extract(
        story_type="funding",
        title="Acme raises $10M in Seed round led by Sequoia Capital",
        summary="The round was led by Sequoia Capital with participation from Accel.",
        entities=["Acme"],
        region="global",
    )
    c = _get_claim(claims, "lead_investor")
    assert c is not None
    assert c.fact_value == "Sequoia Capital"
    assert c.confidence >= 0.75


def test_funding_extracts_lead_investor_backed_by_fallback():
    fx = FactExtractor()
    claims = fx.extract(
        story_type="funding",
        title="Acme raises $10M",
        summary="The startup is backed by Index Ventures and Accel.",
        entities=["Acme"],
        region="global",
    )
    c = _get_claim(claims, "lead_investor")
    assert c is not None
    assert "Index Ventures" in c.fact_value
    assert c.confidence >= 0.65


def test_funding_extracts_lead_investor_investors_include_fallback():
    fx = FactExtractor()
    claims = fx.extract(
        story_type="funding",
        title="Acme closes $10M Seed",
        summary="Investors include General Catalyst, Lightspeed, and others.",
        entities=["Acme"],
        region="global",
    )
    c = _get_claim(claims, "lead_investor")
    assert c is not None
    assert "General Catalyst" in c.fact_value
    assert c.confidence >= 0.6

