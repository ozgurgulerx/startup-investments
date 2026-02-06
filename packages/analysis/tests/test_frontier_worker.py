"""Tests for frontier worker loop behavior."""

from __future__ import annotations

import asyncio

from src.crawl_runtime import worker as worker_module


class FakeRuntime:
    def __init__(self):
        self.calls = 0

    async def crawl_frontier_batch(self, worker_id: str, limit: int):
        self.calls += 1
        if self.calls == 1:
            return {
                "worker_id": worker_id,
                "leased": 3,
                "processed": 3,
                "failed": 0,
                "recovered_leases": 1,
                "errors": [],
                "results": [{"url": "https://acme.com"}],
            }
        return {
            "worker_id": worker_id,
            "leased": 0,
            "processed": 0,
            "failed": 0,
            "recovered_leases": 0,
            "errors": [],
            "results": [],
        }

    async def close(self):
        return None


def test_worker_aggregates_metrics_across_loops(monkeypatch):
    monkeypatch.setattr(worker_module, "ScrapyPlaywrightRuntime", FakeRuntime)

    result = asyncio.run(
        worker_module.run_frontier_worker(
            worker_id="worker-test",
            batch_size=5,
            idle_sleep_seconds=0.01,
            max_loops=2,
        )
    )

    assert result["worker_id"] == "worker-test"
    assert result["loops"] == 2
    assert result["leased"] == 3
    assert result["processed"] == 3
    assert result["failed"] == 0
    assert result["recovered_leases"] == 1
