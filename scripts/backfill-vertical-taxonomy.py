#!/usr/bin/env python3
"""
Backfill vertical taxonomy classification for existing analysis_store JSON files.

This upgrades existing base analyses by adding:
- vertical_taxonomy (versioned ontology path + IDs + labels)
- sub_vertical/sub_sub_vertical (derived from taxonomy if missing)

It is intentionally lightweight: uses the existing analysis JSON (description/website/etc)
and does NOT crawl websites.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional, Tuple


def _analysis_dir(period: str, region: str) -> Path:
    region = region.strip().lower()
    if region in ("tr", "turkey"):
        return Path("apps/web/data/tr") / period / "output" / "analysis_store" / "base_analyses"
    if region in ("global", ""):
        return Path("apps/web/data") / period / "output" / "analysis_store" / "base_analyses"
    raise SystemExit(f"Unsupported region: {region} (expected global|tr)")


def _derive_legacy_fields_from_taxonomy(tax: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    primary = tax.get("primary") if isinstance(tax.get("primary"), dict) else {}
    sub_label = primary.get("sub_vertical_label")
    leaf_label = primary.get("leaf_label")
    if isinstance(sub_label, str) and sub_label.strip():
        sub_vertical = sub_label.strip()
    else:
        sub_vertical = None

    sub_sub_vertical: Optional[str] = None
    if isinstance(leaf_label, str) and leaf_label.strip():
        leaf = leaf_label.strip()
        if sub_vertical and leaf != sub_vertical:
            sub_sub_vertical = leaf
        elif not sub_vertical:
            # If we only got a single level, don't set sub-sub.
            sub_sub_vertical = None
    return sub_vertical, sub_sub_vertical


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill vertical taxonomy for analysis_store base_analyses JSONs")
    parser.add_argument("--period", required=True, help="Period like 2026-01 or 2026-02")
    parser.add_argument("--region", default="global", help="Dataset region: global|tr (default: global)")
    parser.add_argument("--limit", type=int, default=0, help="Process only N files (0 = all)")
    parser.add_argument("--only-missing", action="store_true", help="Only process files missing vertical_taxonomy")
    parser.add_argument("--dry-run", action="store_true", help="Compute but do not write files")
    args = parser.parse_args()

    base_dir = _analysis_dir(args.period, args.region)
    if not base_dir.exists():
        raise SystemExit(f"Analysis directory not found: {base_dir}")

    # Import analyzer lazily to avoid importing heavy deps when just inspecting.
    sys.path.insert(0, str(Path("packages/analysis")))
    from src.analysis.genai_detector import GenAIAnalyzer  # type: ignore

    analyzer = GenAIAnalyzer()

    files = sorted(base_dir.glob("*.json"))
    if args.limit and args.limit > 0:
        files = files[: args.limit]

    import asyncio

    async def process_all() -> Tuple[int, int, int]:
        processed = 0
        updated = 0
        skipped = 0

        for fp in files:
            processed += 1
            obj: Dict[str, Any] = json.loads(fp.read_text(encoding="utf-8"))

            has_tax = isinstance(obj.get("vertical_taxonomy"), dict) and bool(obj.get("vertical_taxonomy"))
            if args.only_missing and has_tax:
                skipped += 1
                continue

            company_name = str(obj.get("company_name") or fp.stem)
            description = str(obj.get("description") or "")
            website = str(obj.get("website") or "")
            industries = obj.get("industries")
            industries_str = ", ".join([str(x) for x in industries]) if isinstance(industries, list) else ""
            current_vertical = str(obj.get("vertical") or "")

            content = "\n".join([
                f"WEBSITE: {website}".strip(),
                f"CURRENT_VERTICAL: {current_vertical}".strip(),
                description.strip(),
            ]).strip()

            tax = await analyzer._classify_vertical_taxonomy(company_name, content, description, industries_str)

            if not isinstance(tax, dict) or not tax:
                # Don't write anything if taxonomy is empty (likely connectivity/config issue).
                raise SystemExit(f"Taxonomy classification returned empty for {fp.name}. Aborting to avoid corrupt backfill.")

            obj["vertical_taxonomy"] = tax

            # Populate legacy fields when missing (Turkey dataset often lacks these)
            derived_sub, derived_sub_sub = _derive_legacy_fields_from_taxonomy(tax)
            if not obj.get("sub_vertical") and derived_sub:
                obj["sub_vertical"] = derived_sub
            if not obj.get("sub_sub_vertical") and derived_sub_sub:
                obj["sub_sub_vertical"] = derived_sub_sub

            updated += 1
            if not args.dry_run:
                fp.write_text(json.dumps(obj, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8")

            if processed % 25 == 0:
                print(f"Processed {processed}/{len(files)} (updated={updated}, skipped={skipped})")

        return processed, updated, skipped

    processed, updated, skipped = asyncio.run(process_all())
    print(f"Done. processed={processed} updated={updated} skipped={skipped} dry_run={args.dry_run}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
