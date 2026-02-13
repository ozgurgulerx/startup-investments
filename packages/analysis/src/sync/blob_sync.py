"""Sync script to pull latest data from Azure Blob Storage to local filesystem.

This script is the bridge between blob storage (source of truth) and the
Next.js app which bundles data from the local filesystem.

Usage:
    python -m src.sync.blob_sync --target ./apps/web/data
    python -m src.sync.blob_sync --period 2026-01 --target ./data/2026-01/output
"""

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Any

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from src.storage import BlobStorageClient, ContainerName


class BlobSyncManager:
    """Manages synchronization from blob storage to local filesystem."""

    def __init__(
        self,
        storage_client: Optional[BlobStorageClient] = None,
        target_dir: Optional[Path] = None,
    ):
        """Initialize sync manager.

        Args:
            storage_client: BlobStorageClient instance
            target_dir: Target directory for synced data
        """
        self.storage_client = storage_client or BlobStorageClient()
        self.target_dir = target_dir or Path("./data/synced")

    def sync_all_latest(self) -> Dict[str, int]:
        """Sync all latest data from blob storage.

        Returns:
            Dict with counts of synced items by type
        """
        results = {
            "analyses": 0,
            "briefs": 0,
            "periods": 0,
            "errors": 0,
        }

        # Sync latest analyses
        print("\n[Sync] Syncing latest analyses...")
        analyses_count = self._sync_latest_analyses()
        results["analyses"] = analyses_count
        print(f"  Synced {analyses_count} analyses")

        # Sync latest briefs
        print("\n[Sync] Syncing latest briefs...")
        briefs_count = self._sync_latest_briefs()
        results["briefs"] = briefs_count
        print(f"  Synced {briefs_count} briefs")

        # Sync period data
        print("\n[Sync] Syncing period data...")
        periods_count = self._sync_periods()
        results["periods"] = periods_count
        print(f"  Synced {periods_count} period files")

        return results

    def _sync_latest_analyses(self) -> int:
        """Sync latest analysis snapshots to local filesystem.

        Returns:
            Number of analyses synced
        """
        analyses_dir = self.target_dir / "analyses"
        analyses_dir.mkdir(parents=True, exist_ok=True)

        # List all blobs with "latest.json" suffix
        blobs = self.storage_client.list_blobs(
            ContainerName.ANALYSIS_SNAPSHOTS,
            prefix="",
        )

        synced = 0
        for blob in blobs:
            if blob["name"].endswith("/latest.json"):
                slug = blob["name"].split("/")[0]
                content = self.storage_client.download_json(
                    ContainerName.ANALYSIS_SNAPSHOTS,
                    blob["name"],
                )
                if content:
                    output_path = analyses_dir / f"{slug}.json"
                    with open(output_path, "w") as f:
                        json.dump(content, f, indent=2, default=str)
                    synced += 1

        return synced

    def _sync_latest_briefs(self) -> int:
        """Sync latest briefs to local filesystem.

        Returns:
            Number of briefs synced
        """
        briefs_dir = self.target_dir / "briefs"
        briefs_dir.mkdir(parents=True, exist_ok=True)

        # List all blobs with "latest.md" suffix
        blobs = self.storage_client.list_blobs(
            ContainerName.BRIEFS,
            prefix="",
        )

        synced = 0
        for blob in blobs:
            if blob["name"].endswith("/latest.md"):
                slug = blob["name"].split("/")[0]
                content = self.storage_client.download_blob(
                    ContainerName.BRIEFS,
                    blob["name"],
                    as_text=True,
                )
                if content:
                    output_path = briefs_dir / f"{slug}_brief.md"
                    with open(output_path, "w") as f:
                        f.write(content)
                    synced += 1

        return synced

    def _sync_periods(self) -> int:
        """Sync period data (monthly stats, indexes) to local filesystem.

        Returns:
            Number of period files synced
        """
        periods_dir = self.target_dir / "periods"
        periods_dir.mkdir(parents=True, exist_ok=True)

        # List all period blobs
        blobs = self.storage_client.list_blobs(
            ContainerName.PERIODS,
            prefix="",
        )

        synced = 0
        for blob in blobs:
            parts = blob["name"].split("/")
            if len(parts) >= 2:
                period = parts[0]
                filename = parts[1]

                # Create period directory
                period_dir = periods_dir / period
                period_dir.mkdir(parents=True, exist_ok=True)

                # Download and save
                if filename.endswith(".json"):
                    content = self.storage_client.download_json(
                        ContainerName.PERIODS,
                        blob["name"],
                    )
                    if content:
                        output_path = period_dir / filename
                        with open(output_path, "w") as f:
                            json.dump(content, f, indent=2, default=str)
                        synced += 1
                elif filename.endswith(".md"):
                    content = self.storage_client.download_blob(
                        ContainerName.PERIODS,
                        blob["name"],
                        as_text=True,
                    )
                    if content:
                        output_path = period_dir / filename
                        with open(output_path, "w") as f:
                            f.write(content)
                        synced += 1

        return synced

    def sync_specific_period(self, period: str) -> Dict[str, int]:
        """Sync all data for a specific period.

        Args:
            period: Period string (YYYY-MM)

        Returns:
            Dict with counts of synced items
        """
        results = {
            "analyses": 0,
            "briefs": 0,
            "period_data": 0,
        }

        # Get startup index for the period
        index = self.storage_client.get_period_data(period, "index", is_json=True)

        if index and "startups" in index:
            slugs = [s.get("slug") for s in index["startups"] if s.get("slug")]

            # Sync analyses for these startups
            for slug in slugs:
                analysis = self.storage_client.get_analysis_snapshot(slug)
                if analysis:
                    output_path = self.target_dir / "analyses" / f"{slug}.json"
                    output_path.parent.mkdir(parents=True, exist_ok=True)
                    with open(output_path, "w") as f:
                        json.dump(analysis, f, indent=2, default=str)
                    results["analyses"] += 1

            # Sync briefs for these startups
            for slug in slugs:
                brief = self.storage_client.get_brief(slug)
                if brief:
                    output_path = self.target_dir / "briefs" / f"{slug}_brief.md"
                    output_path.parent.mkdir(parents=True, exist_ok=True)
                    with open(output_path, "w") as f:
                        f.write(brief)
                    results["briefs"] += 1

        # Sync period-specific data
        period_data_types = ["monthly_stats", "index", "newsletter"]
        for data_type in period_data_types:
            is_json = data_type != "newsletter"
            content = self.storage_client.get_period_data(period, data_type, is_json=is_json)
            if content:
                ext = "json" if is_json else "md"
                output_path = self.target_dir / "periods" / period / f"{data_type}.{ext}"
                output_path.parent.mkdir(parents=True, exist_ok=True)
                with open(output_path, "w") as f:
                    if is_json:
                        json.dump(content, f, indent=2, default=str)
                    else:
                        f.write(content)
                results["period_data"] += 1

        return results

    def create_sync_manifest(self) -> Dict[str, Any]:
        """Create a manifest of synced data.

        Returns:
            Manifest dict with sync metadata
        """
        analyses_dir = self.target_dir / "analyses"
        briefs_dir = self.target_dir / "briefs"

        manifest = {
            "synced_at": datetime.now(timezone.utc).isoformat(),
            "target_dir": str(self.target_dir),
            "analyses": [],
            "briefs": [],
            "periods": [],
        }

        # List synced analyses
        if analyses_dir.exists():
            for f in analyses_dir.glob("*.json"):
                manifest["analyses"].append({
                    "slug": f.stem,
                    "path": str(f.relative_to(self.target_dir)),
                    "size": f.stat().st_size,
                })

        # List synced briefs
        if briefs_dir.exists():
            for f in briefs_dir.glob("*_brief.md"):
                slug = f.stem.replace("_brief", "")
                manifest["briefs"].append({
                    "slug": slug,
                    "path": str(f.relative_to(self.target_dir)),
                    "size": f.stat().st_size,
                })

        # List synced periods
        periods_dir = self.target_dir / "periods"
        if periods_dir.exists():
            for period_dir in periods_dir.iterdir():
                if period_dir.is_dir():
                    manifest["periods"].append({
                        "period": period_dir.name,
                        "files": [f.name for f in period_dir.iterdir() if f.is_file()],
                    })

        # Save manifest
        manifest_path = self.target_dir / "sync_manifest.json"
        with open(manifest_path, "w") as f:
            json.dump(manifest, f, indent=2)

        return manifest

    def check_for_changes(self) -> Dict[str, List[str]]:
        """Check for changes between blob storage and local filesystem.

        Returns:
            Dict with lists of added, modified, and removed items
        """
        changes = {
            "added": [],
            "modified": [],
            "removed": [],
        }

        # Load existing manifest
        manifest_path = self.target_dir / "sync_manifest.json"
        existing_manifest: Dict[str, Any] = {}
        if manifest_path.exists():
            with open(manifest_path) as f:
                existing_manifest = json.load(f)

        existing_slugs = {a["slug"] for a in existing_manifest.get("analyses", [])}

        # List current blobs
        blobs = self.storage_client.list_blobs(
            ContainerName.ANALYSIS_SNAPSHOTS,
            prefix="",
        )

        current_slugs = set()
        for blob in blobs:
            if blob["name"].endswith("/latest.json"):
                slug = blob["name"].split("/")[0]
                current_slugs.add(slug)

        # Find changes
        changes["added"] = list(current_slugs - existing_slugs)
        changes["removed"] = list(existing_slugs - current_slugs)

        # Check for modifications (simplified - check last_modified)
        for slug in current_slugs & existing_slugs:
            local_path = self.target_dir / "analyses" / f"{slug}.json"
            if local_path.exists():
                # Get blob metadata
                blob_info = self.storage_client.list_blobs(
                    ContainerName.ANALYSIS_SNAPSHOTS,
                    prefix=f"{slug}/latest.json",
                )
                if blob_info and blob_info[0]["last_modified"]:
                    blob_modified = blob_info[0]["last_modified"]
                    local_modified = datetime.fromtimestamp(
                        local_path.stat().st_mtime,
                        tz=timezone.utc,
                    )
                    if blob_modified > local_modified:
                        changes["modified"].append(slug)

        return changes


def main():
    """Run sync from command line."""
    parser = argparse.ArgumentParser(
        description="Sync data from Azure Blob Storage to local filesystem"
    )
    parser.add_argument(
        "--target",
        type=str,
        default="./data/synced",
        help="Target directory for synced data",
    )
    parser.add_argument(
        "--period",
        type=str,
        help="Sync specific period (YYYY-MM)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check for changes without syncing",
    )
    parser.add_argument(
        "--manifest",
        action="store_true",
        help="Create manifest after sync",
    )

    args = parser.parse_args()

    # Initialize
    sync_manager = BlobSyncManager(target_dir=Path(args.target))

    if not sync_manager.storage_client.is_configured:
        print("Error: Azure Storage connection string not configured")
        print("Set AZURE_STORAGE_CONNECTION_STRING environment variable")
        sys.exit(1)

    # Verify blob storage is actually reachable (not just configured).
    # blob_service returns None when all auth methods fail.
    if sync_manager.storage_client.blob_service is None:
        print("Error: Could not authenticate to Azure Blob Storage")
        print("Check managed identity RBAC or AZURE_STORAGE_CONNECTION_STRING")
        # Exit code 2 = auth/connectivity failure (distinguishable from general errors)
        sys.exit(2)

    if args.check:
        print("\n[Sync] Checking for changes...")
        changes = sync_manager.check_for_changes()
        print(f"\n  Added: {len(changes['added'])}")
        print(f"  Modified: {len(changes['modified'])}")
        print(f"  Removed: {len(changes['removed'])}")

        if changes["added"]:
            print(f"\n  New startups: {', '.join(changes['added'][:10])}")
            if len(changes["added"]) > 10:
                print(f"    ... and {len(changes['added']) - 10} more")
    elif args.period:
        print(f"\n[Sync] Syncing period {args.period}...")
        results = sync_manager.sync_specific_period(args.period)
        print(f"\nSync complete:")
        print(f"  Analyses: {results['analyses']}")
        print(f"  Briefs: {results['briefs']}")
        print(f"  Period data: {results['period_data']}")
    else:
        print("\n[Sync] Syncing all latest data...")
        results = sync_manager.sync_all_latest()
        print(f"\nSync complete:")
        print(f"  Analyses: {results['analyses']}")
        print(f"  Briefs: {results['briefs']}")
        print(f"  Periods: {results['periods']}")

    if args.manifest or not args.check:
        print("\n[Sync] Creating manifest...")
        manifest = sync_manager.create_sync_manifest()
        print(f"  Manifest saved with {len(manifest['analyses'])} analyses")


if __name__ == "__main__":
    main()
