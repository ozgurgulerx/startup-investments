"""Frontier worker loop for leasing and processing crawl URLs."""

from __future__ import annotations

import argparse
import asyncio
import json
import socket
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from src.config import settings
from src.crawl_runtime.scrapy_runtime import ScrapyPlaywrightRuntime


class FrontierWorker:
    """Lease-based frontier worker with periodic polling."""

    def __init__(
        self,
        worker_id: Optional[str] = None,
        batch_size: Optional[int] = None,
        idle_sleep_seconds: float = 5.0,
    ):
        self.worker_id = worker_id or f"worker-{socket.gethostname()}-{uuid.uuid4().hex[:8]}"
        self.batch_size = int(batch_size or settings.crawler.frontier_batch_size)
        self.idle_sleep_seconds = max(1.0, float(idle_sleep_seconds))
        self.runtime = ScrapyPlaywrightRuntime()

    async def run_once(self) -> Dict[str, Any]:
        return await self.runtime.crawl_frontier_batch(
            worker_id=self.worker_id,
            limit=self.batch_size,
        )

    async def run_forever(self, max_loops: Optional[int] = None) -> Dict[str, Any]:
        loops = 0
        aggregated = {
            "worker_id": self.worker_id,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "loops": 0,
            "leased": 0,
            "processed": 0,
            "failed": 0,
            "recovered_leases": 0,
            "errors": [],
        }

        try:
            while True:
                summary = await self.run_once()
                loops += 1
                aggregated["loops"] = loops
                aggregated["leased"] += int(summary.get("leased", 0))
                aggregated["processed"] += int(summary.get("processed", 0))
                aggregated["failed"] += int(summary.get("failed", 0))
                aggregated["recovered_leases"] += int(summary.get("recovered_leases", 0))
                aggregated["errors"].extend(summary.get("errors", []))

                if max_loops is not None and loops >= max_loops:
                    break

                if int(summary.get("leased", 0)) == 0:
                    await asyncio.sleep(self.idle_sleep_seconds)
        finally:
            await self.runtime.close()

        aggregated["completed_at"] = datetime.now(timezone.utc).isoformat()
        return aggregated


async def run_frontier_worker(
    worker_id: Optional[str] = None,
    batch_size: Optional[int] = None,
    idle_sleep_seconds: float = 5.0,
    max_loops: Optional[int] = None,
) -> Dict[str, Any]:
    worker = FrontierWorker(
        worker_id=worker_id,
        batch_size=batch_size,
        idle_sleep_seconds=idle_sleep_seconds,
    )
    return await worker.run_forever(max_loops=max_loops)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run frontier crawl worker")
    parser.add_argument("--worker-id", default="")
    parser.add_argument("--batch-size", type=int, default=0)
    parser.add_argument("--idle-sleep-seconds", type=float, default=5.0)
    parser.add_argument("--max-loops", type=int, default=0)
    parser.add_argument("--once", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()

    async def _run() -> Dict[str, Any]:
        worker = FrontierWorker(
            worker_id=args.worker_id or None,
            batch_size=args.batch_size or None,
            idle_sleep_seconds=args.idle_sleep_seconds,
        )
        try:
            if args.once:
                return await worker.run_once()
            loops = args.max_loops if args.max_loops > 0 else None
            return await worker.run_forever(max_loops=loops)
        finally:
            await worker.runtime.close()

    result = asyncio.run(_run())
    print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
