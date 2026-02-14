"""Tests for onboarding alert dispatch robustness (type-shape tolerance)."""

from __future__ import annotations

import asyncio

from src.automation import onboarding_alerts


class _FakeDb:
    last: "_FakeDb | None" = None

    def __init__(self):
        type(self).last = self
        self.marked: list[str] = []

    async def connect(self):
        return None

    async def close(self):
        return None

    async def get_pending_onboarding_trace_notifications(self, limit: int = 50):
        # Include a malformed row to ensure the dispatcher doesn't crash.
        return [
            "not-a-dict",
            {"id": "11111111-1111-1111-1111-111111111111"},
        ]

    async def mark_onboarding_trace_events_notified(self, event_ids: list[str]) -> int:
        self.marked.extend(event_ids)
        return len(event_ids)


def test_dispatcher_skips_malformed_events_and_continues(monkeypatch):
    monkeypatch.setattr(onboarding_alerts, "DatabaseConnection", _FakeDb)

    def _fake_send(event, *, base_url: str) -> bool:
        assert isinstance(event, dict)
        assert base_url
        return True

    monkeypatch.setattr(onboarding_alerts, "_send_slack_notification", _fake_send)

    stats = asyncio.run(onboarding_alerts.run_onboarding_alert_dispatcher(batch_size=25))
    assert stats["fetched"] == 2
    assert stats["sent"] == 1
    assert stats["failed"] == 1
    assert stats["marked_notified"] == 1

    assert _FakeDb.last is not None
    assert _FakeDb.last.marked == ["11111111-1111-1111-1111-111111111111"]

