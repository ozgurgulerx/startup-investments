#!/usr/bin/env python3
"""Validate analysis output quality for a given period.

Checks content depth, brief completeness, vertical classification,
and crawl diagnostics distribution.

Usage:
    python scripts/validate_analysis_output.py --period 2026-02
    python scripts/validate_analysis_output.py --period 2026-02 --min-content-pct 90 --min-content-chars 10000
"""

import argparse
import json
import sys
from pathlib import Path
from collections import Counter

REPO_ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description="Validate analysis output quality")
    parser.add_argument("--period", required=True, help="Period (e.g., 2026-02)")
    parser.add_argument("--output-dir", default="", help="Override output directory")
    parser.add_argument("--min-content-pct", type=float, default=90.0,
                        help="Min %% of startups above content threshold (default: 90)")
    parser.add_argument("--min-content-chars", type=int, default=10000,
                        help="Min content chars per startup (default: 10000)")
    args = parser.parse_args()

    output_dir = Path(args.output_dir) if args.output_dir else (
        REPO_ROOT / "apps" / "web" / "data" / args.period / "output"
    )

    if not output_dir.exists():
        print(f"ERROR: Output directory not found: {output_dir}")
        sys.exit(1)

    # Load all analysis JSONs
    json_files = sorted(output_dir.glob("*.json"))
    # Exclude summary/stats files
    json_files = [f for f in json_files if f.name not in (
        "analysis_summary.json", "monthly_stats.json", "metadata.json",
    ) and not f.name.startswith("analysis_store")]

    if not json_files:
        print(f"ERROR: No analysis JSON files found in {output_dir}")
        sys.exit(1)

    analyses = []
    for f in json_files:
        try:
            with open(f) as fh:
                data = json.load(fh)
                if "company_name" in data:
                    analyses.append(data)
        except Exception:
            pass

    total = len(analyses)
    print(f"{'='*60}")
    print(f"Analysis Validation: {args.period}")
    print(f"{'='*60}")
    print(f"Total analyses found: {total}")
    print()

    # Check 1: Content depth
    above_threshold = sum(
        1 for a in analyses
        if a.get("raw_content_analyzed", 0) >= args.min_content_chars
    )
    content_pct = (above_threshold / total * 100) if total else 0
    content_pass = content_pct >= args.min_content_pct

    print(f"[{'PASS' if content_pass else 'FAIL'}] Content depth: "
          f"{above_threshold}/{total} ({content_pct:.1f}%) >= {args.min_content_chars:,} chars "
          f"(threshold: {args.min_content_pct}%)")

    # Show distribution
    content_buckets = Counter()
    for a in analyses:
        chars = a.get("raw_content_analyzed", 0)
        if chars == 0:
            content_buckets["0 (no content)"] += 1
        elif chars < 1000:
            content_buckets["1-999"] += 1
        elif chars < 5000:
            content_buckets["1K-5K"] += 1
        elif chars < 10000:
            content_buckets["5K-10K"] += 1
        elif chars < 50000:
            content_buckets["10K-50K"] += 1
        elif chars < 100000:
            content_buckets["50K-100K"] += 1
        else:
            content_buckets["100K+"] += 1

    print("  Content distribution:")
    for bucket in ["0 (no content)", "1-999", "1K-5K", "5K-10K", "10K-50K", "50K-100K", "100K+"]:
        count = content_buckets.get(bucket, 0)
        if count:
            print(f"    {bucket}: {count}")

    # Check 2: Brief completeness
    briefs_dir = output_dir / "briefs"
    briefs_found = 0
    analysis_slugs = {a.get("company_slug", "") for a in analyses}
    brief_slugs: set[str] = set()
    if briefs_dir.exists():
        brief_slugs = {f.name.replace("_brief.md", "") for f in briefs_dir.glob("*_brief.md")}
        briefs_found = len(brief_slugs & analysis_slugs)
    briefs_pct = (briefs_found / total * 100) if total else 0
    briefs_pass = briefs_pct >= 80

    print(f"\n[{'PASS' if briefs_pass else 'FAIL'}] Brief completeness: "
          f"{briefs_found}/{total} ({briefs_pct:.1f}%) have briefs")

    missing_briefs = analysis_slugs - brief_slugs
    if missing_briefs and len(missing_briefs) <= 10:
        print(f"  Missing briefs: {', '.join(sorted(missing_briefs))}")

    # Check 3: Vertical classification
    verticals = Counter(a.get("vertical", "other") for a in analyses)
    other_count = verticals.get("other", 0)
    other_pct = (other_count / total * 100) if total else 0
    vertical_pass = other_pct < 50  # Less than 50% should be "other"

    print(f"\n[{'PASS' if vertical_pass else 'FAIL'}] Vertical classification: "
          f"{total - other_count}/{total} classified (\"other\": {other_count}, {other_pct:.1f}%)")
    print("  Verticals:")
    for v, count in verticals.most_common():
        print(f"    {v}: {count}")

    # Check 4: Crawl diagnostics
    has_diagnostics = sum(1 for a in analyses if a.get("crawl_diagnostics"))
    if has_diagnostics > 0:
        failure_reasons = Counter()
        deep_crawls = 0
        for a in analyses:
            diag = a.get("crawl_diagnostics", {})
            if not diag:
                continue
            if diag.get("deep_crawl_triggered"):
                deep_crawls += 1
            reason = diag.get("failure_reason")
            if reason:
                failure_reasons[reason] += 1

        print(f"\nCrawl diagnostics ({has_diagnostics} entries):")
        print(f"  Deep crawls triggered: {deep_crawls}")
        if failure_reasons:
            print("  Failure reasons:")
            for reason, count in failure_reasons.most_common():
                print(f"    {reason}: {count}")
    else:
        print("\nCrawl diagnostics: not present (older analysis format)")

    # Check 5: GenAI detection
    genai_count = sum(1 for a in analyses if a.get("uses_genai"))
    print(f"\nGenAI detection: {genai_count}/{total} ({genai_count/total*100:.1f}%) use GenAI")

    # Bottom 5 by content
    print(f"\nBottom 5 by content:")
    sorted_by_content = sorted(analyses, key=lambda a: a.get("raw_content_analyzed", 0))
    for a in sorted_by_content[:5]:
        print(f"  {a.get('company_slug', '?')}: {a.get('raw_content_analyzed', 0):,} chars "
              f"(vertical: {a.get('vertical', '?')})")

    # Overall verdict
    print(f"\n{'='*60}")
    all_pass = content_pass and briefs_pass and vertical_pass
    print(f"Overall: {'PASS' if all_pass else 'FAIL'}")
    print(f"{'='*60}")

    if not all_pass:
        sys.exit(1)


if __name__ == "__main__":
    main()
