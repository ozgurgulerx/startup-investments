"""Unit tests for structured event extraction helpers."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from src.automation.event_extractor import (
    ExtractedEvent,
    _normalize_event_date_for_db,
    _normalize_funding_amount_token,
    _normalize_lead_investor_token,
    compute_funding_event_fingerprint,
    dedupe_funding_events,
)


def test_normalize_event_date_accepts_date():
    dt, eff = _normalize_event_date_for_db(date(2026, 2, 14))
    assert dt is not None
    assert dt.tzinfo == timezone.utc
    assert dt.hour == 0 and dt.minute == 0
    assert eff == date(2026, 2, 14)


def test_normalize_event_date_accepts_naive_datetime():
    dt, eff = _normalize_event_date_for_db(datetime(2026, 2, 14, 10, 30))
    assert dt is not None
    assert dt.tzinfo == timezone.utc
    assert dt.hour == 10 and dt.minute == 30
    assert eff == date(2026, 2, 14)


def test_normalize_event_date_converts_aware_datetime_to_utc_and_derives_effective_date():
    tr_tz = timezone(timedelta(hours=3))
    raw = datetime(2026, 2, 14, 0, 30, tzinfo=tr_tz)
    dt, eff = _normalize_event_date_for_db(raw)
    assert dt == datetime(2026, 2, 13, 21, 30, tzinfo=timezone.utc)
    assert eff == date(2026, 2, 13)


def test_normalize_event_date_none_returns_none_pair():
    dt, eff = _normalize_event_date_for_db(None)
    assert dt is None
    assert eff is None


def test_normalize_funding_amount_token_removes_spaces_commas_and_case():
    assert _normalize_funding_amount_token(" $ 10,000,000 ") == "$10000000"
    assert _normalize_funding_amount_token("$10 000 000") == "$10000000"


def test_normalize_lead_investor_token_collapses_whitespace():
    assert _normalize_lead_investor_token("  Sequoia   Capital  ") == "sequoia capital"


def test_compute_funding_event_fingerprint_normalizes_equivalent_values():
    e1 = ExtractedEvent(
        event_type="cap_funding_raised",
        confidence=0.9,
        startup_id="11111111-1111-1111-1111-111111111111",
        event_key="Series A",
        region="global",
        event_date=datetime(2026, 3, 1, 9, 0, tzinfo=timezone.utc),
        metadata={"funding_amount": "$ 10,000,000", "lead_investor": "Sequoia   Capital"},
    )
    e2 = ExtractedEvent(
        event_type="cap_funding_raised",
        confidence=0.7,
        startup_id="11111111-1111-1111-1111-111111111111",
        event_key=" series a ",
        region="GLOBAL",
        event_date=datetime(2026, 3, 1, 12, 0, tzinfo=timezone.utc),
        metadata={"mentioned_amount": "$10000000", "lead_investor": "sequoia capital"},
    )
    assert compute_funding_event_fingerprint(e1) == compute_funding_event_fingerprint(e2)


def test_dedupe_funding_events_drops_exact_duplicates_only():
    funding_a = ExtractedEvent(
        event_type="cap_funding_raised",
        confidence=0.9,
        startup_id="11111111-1111-1111-1111-111111111111",
        event_key="Series A",
        region="global",
        event_date=datetime(2026, 3, 1, 9, 0, tzinfo=timezone.utc),
        metadata={"funding_amount": "$10,000,000", "lead_investor": "Sequoia Capital"},
    )
    funding_dup = ExtractedEvent(
        event_type="cap_funding_raised",
        confidence=0.8,
        startup_id="11111111-1111-1111-1111-111111111111",
        event_key="series a",
        region="global",
        event_date=datetime(2026, 3, 1, 12, 0, tzinfo=timezone.utc),
        metadata={"mentioned_amount": "$ 10 000 000", "lead_investor": "sequoia   capital"},
    )
    non_funding = ExtractedEvent(
        event_type="prod_launched",
        confidence=0.8,
        startup_id="11111111-1111-1111-1111-111111111111",
        event_key="",
        region="global",
        event_date=datetime(2026, 3, 1, 12, 0, tzinfo=timezone.utc),
        metadata={"product_launched": "Studio v2"},
    )

    deduped = dedupe_funding_events([funding_a, funding_dup, non_funding])
    assert [e.event_type for e in deduped] == ["cap_funding_raised", "prod_launched"]
