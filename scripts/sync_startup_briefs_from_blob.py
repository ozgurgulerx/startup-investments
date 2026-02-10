#!/usr/bin/env python3
"""Sync startup analysis results from Azure Blob Storage to local repo.

Downloads analysis JSONs and briefs from blob, regenerates CSV summaries.

Usage:
    python scripts/sync_startup_briefs_from_blob.py --period 2026-02 --out apps/web/data/2026-02/output
"""

import argparse
import json
import sys
from pathlib import Path

# Add packages/analysis to sys.path so we can import blob_client
REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "packages" / "analysis"))


def main():
    parser = argparse.ArgumentParser(description="Sync analysis results from blob to local repo")
    parser.add_argument("--period", required=True, help="Period (e.g., 2026-02)")
    parser.add_argument("--out", required=True, help="Output directory (e.g., apps/web/data/2026-02/output)")
    parser.add_argument("--blob-prefix", default="", help="Blob path prefix override (default: periods/{period}/)")
    args = parser.parse_args()

    output_path = Path(args.out)
    output_path.mkdir(parents=True, exist_ok=True)
    briefs_dir = output_path / "briefs"
    briefs_dir.mkdir(parents=True, exist_ok=True)

    blob_prefix = args.blob_prefix or f"periods/{args.period}/"

    try:
        from src.storage.blob_client import BlobStorageClient, ContainerName
    except ImportError:
        print("ERROR: Could not import BlobStorageClient. Run from repo root with packages/analysis on PYTHONPATH.")
        sys.exit(1)

    client = BlobStorageClient()

    # 1. Download manifest
    print(f"Downloading manifest from {blob_prefix}manifest.json ...")
    try:
        manifest_bytes = client.download_blob(ContainerName.PERIODS, f"{blob_prefix}manifest.json")
        manifest = json.loads(manifest_bytes)
        print(f"  Found {len(manifest)} entries in manifest")
    except Exception as e:
        print(f"ERROR: Could not download manifest: {e}")
        print("  Falling back to listing blobs...")
        manifest = {}
        # List analysis blobs to discover slugs
        blobs = client.list_blobs(ContainerName.ANALYSIS_SNAPSHOTS, prefix=blob_prefix)
        for blob_name in blobs:
            if blob_name.endswith("/latest.json"):
                slug = blob_name.replace(blob_prefix, "").replace("/latest.json", "")
                manifest[slug] = {}

    if not manifest:
        print("No analysis results found in blob storage.")
        sys.exit(0)

    # 2. Download analysis JSONs
    print(f"\nDownloading {len(manifest)} analysis JSONs...")
    downloaded = 0
    analyses = []
    for slug in sorted(manifest.keys()):
        blob_path = f"{blob_prefix}{slug}/latest.json"
        try:
            data = client.download_blob(ContainerName.ANALYSIS_SNAPSHOTS, blob_path)
            analysis = json.loads(data)
            analyses.append(analysis)

            local_path = output_path / f"{slug}.json"
            local_path.write_bytes(data)
            downloaded += 1
        except Exception as e:
            print(f"  WARN: Failed to download {blob_path}: {e}")

    print(f"  Downloaded {downloaded}/{len(manifest)} JSONs")

    # 3. Download briefs
    print(f"\nDownloading briefs...")
    briefs_downloaded = 0
    for slug in sorted(manifest.keys()):
        blob_path = f"{blob_prefix}{slug}/latest.md"
        try:
            data = client.download_blob(ContainerName.BRIEFS, blob_path)
            local_path = briefs_dir / f"{slug}_brief.md"
            local_path.write_bytes(data)
            briefs_downloaded += 1
        except Exception:
            pass  # Brief may not exist for every startup

    print(f"  Downloaded {briefs_downloaded} briefs")

    # 4. Regenerate analysis_results.csv
    print(f"\nRegenerating analysis_results.csv...")
    csv_path = output_path / "analysis_results.csv"
    import csv
    with open(csv_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "company_name", "company_slug", "website", "uses_genai",
            "genai_intensity", "vertical", "raw_content_analyzed",
            "confidence_score", "newsletter_potential", "analyzed_at",
        ])
        for a in sorted(analyses, key=lambda x: x.get("company_name", "")):
            writer.writerow([
                a.get("company_name", ""),
                a.get("company_slug", ""),
                a.get("website", ""),
                a.get("uses_genai", False),
                a.get("genai_intensity", "unclear"),
                a.get("vertical", "other"),
                a.get("raw_content_analyzed", 0),
                a.get("confidence_score", 0),
                a.get("newsletter_potential", "unknown"),
                a.get("analyzed_at", ""),
            ])
    print(f"  Wrote {len(analyses)} rows to {csv_path.name}")

    # 5. Regenerate analysis_summary.json
    print(f"Regenerating analysis_summary.json...")
    summary = {
        "total_analyzed": len(analyses),
        "uses_genai_count": sum(1 for a in analyses if a.get("uses_genai")),
        "pattern_distribution": {},
        "newsletter_potential": {
            "high": sum(1 for a in analyses if a.get("newsletter_potential") == "high"),
            "medium": sum(1 for a in analyses if a.get("newsletter_potential") == "medium"),
            "low": sum(1 for a in analyses if a.get("newsletter_potential") == "low"),
        },
        "startups": [
            {
                "name": a.get("company_name"),
                "uses_genai": a.get("uses_genai"),
                "genai_intensity": a.get("genai_intensity", "unclear"),
                "patterns": [p.get("name", "") for p in a.get("build_patterns", [])],
                "unique_findings": a.get("unique_findings", []),
                "newsletter_potential": a.get("newsletter_potential", "unknown"),
            }
            for a in analyses
        ],
    }
    for a in analyses:
        for p in a.get("build_patterns", []):
            name = p.get("name", "")
            if name:
                summary["pattern_distribution"][name] = summary["pattern_distribution"].get(name, 0) + 1

    summary_path = output_path / "analysis_summary.json"
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"  Wrote {summary_path.name}")

    # 6. Summary
    print(f"\n{'='*50}")
    print(f"Sync complete!")
    print(f"  JSONs: {downloaded}")
    print(f"  Briefs: {briefs_downloaded}")
    print(f"  Output: {output_path}")
    genai_count = sum(1 for a in analyses if a.get("uses_genai"))
    print(f"  GenAI usage: {genai_count}/{len(analyses)}")
    avg_content = sum(a.get("raw_content_analyzed", 0) for a in analyses) / max(1, len(analyses))
    print(f"  Avg content: {avg_content:,.0f} chars")


if __name__ == "__main__":
    main()
