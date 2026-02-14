"""Unit tests for structured event extraction helpers."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from src.automation.event_extractor import _normalize_event_date_for_db


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

