"""Retention cleanup for raw capture metadata and blobs."""

from __future__ import annotations

import argparse
import asyncio
import os
from typing import Any, Dict

import asyncpg

from src.config import settings
from src.storage.blob_client import BlobStorageClient, ContainerName


async def cleanup_raw_captures(retention_days: int) -> Dict[str, Any]:
    database_url = os.getenv("DATABASE_URL", "")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required")

    retention_days = max(1, int(retention_days))
    blob = BlobStorageClient()

    conn = await asyncpg.connect(database_url)
    try:
        rows = await conn.fetch(
            """
            SELECT id, body_blob_path
            FROM crawl_raw_captures
            WHERE captured_at < NOW() - make_interval(days => $1)
            ORDER BY captured_at ASC
            LIMIT 2000
            """,
            retention_days,
        )

        deleted_rows = 0
        deleted_blobs = 0
        for row in rows:
            blob_path = str(row.get("body_blob_path") or "")
            if blob_path and blob.delete_blob(ContainerName.CRAWL_SNAPSHOTS, blob_path):
                deleted_blobs += 1

            await conn.execute("DELETE FROM crawl_raw_captures WHERE id = $1", row["id"])
            deleted_rows += 1

        return {
            "retention_days": retention_days,
            "deleted_rows": deleted_rows,
            "deleted_blobs": deleted_blobs,
        }
    finally:
        await conn.close()


async def run_raw_capture_retention() -> Dict[str, Any]:
    return await cleanup_raw_captures(settings.crawler.raw_capture_retention_days)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Cleanup old raw captures")
    parser.add_argument("--retention-days", type=int, default=0)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    retention_days = args.retention_days if args.retention_days > 0 else settings.crawler.raw_capture_retention_days
    result = asyncio.run(cleanup_raw_captures(retention_days))
    print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
