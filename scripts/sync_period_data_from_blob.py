#!/usr/bin/env python3
"""Download canonical period datasets from Blob Storage to a local tree."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "packages" / "analysis"))

from src.storage.period_artifacts import PeriodArtifactStore, normalize_region  # noqa: E402


def _target_period_root(target_root: Path, period: str, region: str) -> Path:
    normalized_region = normalize_region(region)
    if normalized_region == "turkey":
        return target_root / "tr" / period
    return target_root / period


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync period data from Azure Blob Storage")
    parser.add_argument("--target", required=True, help="Target apps/web/data-style root")
    parser.add_argument("--period", action="append", default=[], help="Specific period(s) to sync")
    parser.add_argument("--region", default="global", help="global|turkey|tr|all")
    parser.add_argument("--all-periods", action="store_true", help="Sync every discovered period")
    parser.add_argument(
        "--include-prefix",
        action="append",
        default=[],
        help="Tree prefixes to sync under each period root (default: input and output)",
    )
    args = parser.parse_args()

    store = PeriodArtifactStore()
    if not store.is_available():
        print("ERROR: Blob period artifacts are not configured or not reachable", file=sys.stderr)
        return 1

    target_root = Path(args.target).resolve()
    prefixes = tuple(args.include_prefix) if args.include_prefix else ("input", "output")
    requested_regions = ["global", "turkey"] if str(args.region).strip().lower() == "all" else [normalize_region(args.region)]

    total_downloaded = 0
    for region in requested_regions:
        periods = list(dict.fromkeys(args.period))
        if args.all_periods:
            periods = store.list_periods(region=region)
        if not periods:
            latest = store.latest_period(region=region)
            periods = [latest] if latest else []
        for period in periods:
            if not period:
                continue
            period_root = _target_period_root(target_root, period, region)
            downloaded = store.download_tree(period, period_root, region=region, include_prefixes=prefixes)
            print(f"region={region} period={period} downloaded={downloaded} target={period_root}")
            total_downloaded += downloaded

    return 0 if total_downloaded >= 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
