#!/usr/bin/env python3
"""
Validate that vertical taxonomy fields are present and usable for all startups
in analysis_store base_analyses.

This is a guardrail: if vertical_taxonomy is missing/empty/incomplete, Dealbook
filters and dossier vertical display will degrade.

Usage:
  python scripts/check-vertical-taxonomy.py --period 2026-02 --region global
  python scripts/check-vertical-taxonomy.py --period 2026-02 --region tr
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, Tuple


def _analysis_dir(period: str, region: str) -> Path:
    r = region.strip().lower()
    if r in ("tr", "turkey"):
        return Path("apps/web/data/tr") / period / "output" / "analysis_store" / "base_analyses"
    if r in ("global", ""):
        return Path("apps/web/data") / period / "output" / "analysis_store" / "base_analyses"
    raise SystemExit(f"Unsupported region: {region} (expected global|tr)")


def _is_taxonomy_complete(vt: Any) -> Tuple[bool, str]:
    if vt is None:
        return False, "missing"
    if not isinstance(vt, dict) or not vt:
        return False, "empty"
    primary = vt.get("primary")
    if not isinstance(primary, dict) or not primary:
        return False, "no_primary"
    # Minimum required for filtering + display.
    if not primary.get("vertical_id") or not primary.get("vertical_label"):
        return False, "missing_vertical_id_or_label"
    return True, "ok"


def main() -> int:
    parser = argparse.ArgumentParser(description="Check vertical_taxonomy completeness in analysis_store base_analyses")
    parser.add_argument("--period", required=True, help="Period like 2026-01 or 2026-02")
    parser.add_argument("--region", default="global", help="Dataset region: global|tr (default: global)")
    parser.add_argument("--limit", type=int, default=0, help="Inspect only N files (0 = all)")
    parser.add_argument("--show-examples", type=int, default=10, help="Print up to N failing filenames")
    args = parser.parse_args()

    base_dir = _analysis_dir(args.period, args.region)
    if not base_dir.exists():
        print(f"SKIP: analysis directory not found: {base_dir}")
        return 0

    files = sorted(base_dir.glob("*.json"))
    if args.limit and args.limit > 0:
        files = files[: args.limit]

    total = len(files)
    failures: Dict[str, int] = {}
    examples = []

    for fp in files:
        try:
            obj = json.loads(fp.read_text(encoding="utf-8"))
        except Exception:
            failures["unreadable_json"] = failures.get("unreadable_json", 0) + 1
            if len(examples) < args.show_examples:
                examples.append((fp.name, "unreadable_json"))
            continue

        ok, reason = _is_taxonomy_complete(obj.get("vertical_taxonomy"))
        if not ok:
            failures[reason] = failures.get(reason, 0) + 1
            if len(examples) < args.show_examples:
                examples.append((fp.name, reason))

    ok_count = total - sum(failures.values())
    print(f"[vertical_taxonomy] region={args.region} period={args.period} total={total} ok={ok_count} failures={sum(failures.values())}")
    if failures:
        for k in sorted(failures.keys()):
            print(f"  - {k}: {failures[k]}")
        if examples:
            print("  examples:")
            for name, reason in examples:
                print(f"    - {name}: {reason}")
        return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

