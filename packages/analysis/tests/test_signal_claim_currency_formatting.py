"""Tests for signal claim currency formatting guardrails."""

from src.automation.signal_engine import SignalEngine


def test_build_claim_formats_billion_amount_with_single_dollar():
    claim = SignalEngine._build_claim(
        event_type="cap_funding_raised",
        discriminator="AI",
        n_events=1,
        n_companies=1,
        company_names=[],
        funding_amounts=[4_740_100_000],
        lookback_days=30,
    )
    assert claim == "AI funding: $4.7B across 1 deals in 30 days"


def test_sanitize_claim_text_collapses_duplicate_dollar_symbols():
    claim = SignalEngine._sanitize_claim_text("Funding activity: $$4740.1B and $ 10M")
    assert claim == "Funding activity: $4740.1B and $10M"
