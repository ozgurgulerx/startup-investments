#!/usr/bin/env python3
"""Publish a period dataset tree from local disk to Blob Storage."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "packages" / "analysis"))

from src.storage.period_artifacts import PeriodArtifactStore, normalize_region  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish period data to Azure Blob Storage")
    parser.add_argument("--period", required=True, help="Period like 2026-02")
    parser.add_argument("--region", default="global", help="global|turkey|tr")
    parser.add_argument("--source-root", required=True, help="Local period root containing input/ and output/")
    parser.add_argument(
        "--include-prefix",
        action="append",
        default=[],
        help="Tree prefixes to publish under the period root (default: input and output)",
    )
    args = parser.parse_args()

    store = PeriodArtifactStore()
    if not store.is_available():
        print("ERROR: Blob period artifacts are not configured or not reachable", file=sys.stderr)
        return 1

    source_root = Path(args.source_root).resolve()
    prefixes = tuple(args.include_prefix) if args.include_prefix else ("input", "output")
    uploaded = store.upload_tree(
        args.period,
        source_root,
        region=normalize_region(args.region),
        include_prefixes=prefixes,
    )
    print(f"region={normalize_region(args.region)} period={args.period} uploaded={uploaded} source={source_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
