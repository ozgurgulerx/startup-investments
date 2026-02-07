from __future__ import annotations

import asyncio
from datetime import date

from src.automation.news_digest import DailyNewsDigestSender


class FakeConn:
    def __init__(self, edition_date):
        self._edition_date = edition_date

    async def fetchrow(self, _query: str):
        return {"edition_date": self._edition_date}


def test_resolve_edition_date_parses_explicit_string_to_date():
    sender = DailyNewsDigestSender(database_url="postgres://example")

    resolved = asyncio.run(sender._resolve_edition_date(FakeConn(date(2026, 2, 7)), "2026-02-07"))
    assert isinstance(resolved, date)
    assert resolved.isoformat() == "2026-02-07"


def test_resolve_edition_date_accepts_db_date_type():
    sender = DailyNewsDigestSender(database_url="postgres://example")

    resolved = asyncio.run(sender._resolve_edition_date(FakeConn(date(2026, 2, 7)), None))
    assert resolved == date(2026, 2, 7)


def test_resolve_edition_date_accepts_db_string_type():
    sender = DailyNewsDigestSender(database_url="postgres://example")

    resolved = asyncio.run(sender._resolve_edition_date(FakeConn("2026-02-07"), None))
    assert resolved == date(2026, 2, 7)
