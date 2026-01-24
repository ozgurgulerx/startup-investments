#!/usr/bin/env python3
"""
Migrate existing data to monthly folder structure.

This script reorganizes the data directory from:
    data/
    ├── input/startups_jan_2026.csv
    ├── output/...
    └── crawl_cache/...

To:
    data/
    ├── 2026-01/
    │   ├── input/startups.csv
    │   └── output/...
    └── crawl_cache/  (shared across months)
"""

import shutil
from pathlib import Path
from datetime import datetime


def migrate(period: str = "2026-01", dry_run: bool = False):
    """Migrate existing data to monthly folder structure.

    Args:
        period: The period to migrate to (default: 2026-01)
        dry_run: If True, only print what would be done without making changes
    """
    data_dir = Path("data")
    new_dir = data_dir / period

    print(f"{'[DRY RUN] ' if dry_run else ''}Migrating data to {new_dir}")
    print("=" * 50)

    # Track what we'll do
    actions = []

    # Create new structure
    new_input = new_dir / "input"
    new_output = new_dir / "output"

    if not dry_run:
        new_input.mkdir(parents=True, exist_ok=True)
        new_output.mkdir(parents=True, exist_ok=True)
    actions.append(f"Created directories: {new_input}, {new_output}")

    # Move input CSV
    old_input_dir = data_dir / "input"
    if old_input_dir.exists():
        for csv_file in old_input_dir.glob("*.csv"):
            # Rename to standardized name
            new_csv_path = new_input / "startups.csv"
            actions.append(f"Move: {csv_file} -> {new_csv_path}")
            if not dry_run:
                shutil.move(str(csv_file), str(new_csv_path))

    # Move output contents
    old_output = data_dir / "output"
    if old_output.exists():
        for item in old_output.iterdir():
            dest = new_output / item.name
            actions.append(f"Move: {item} -> {dest}")
            if not dry_run:
                if item.is_dir():
                    shutil.move(str(item), str(dest))
                else:
                    shutil.move(str(item), str(dest))

    # Clean up old directories (but keep crawl_cache)
    if not dry_run:
        if old_input_dir.exists() and not any(old_input_dir.iterdir()):
            old_input_dir.rmdir()
            actions.append(f"Removed empty directory: {old_input_dir}")

        if old_output.exists() and not any(old_output.iterdir()):
            old_output.rmdir()
            actions.append(f"Removed empty directory: {old_output}")

    # Print summary
    print("\nActions taken:")
    for action in actions:
        print(f"  - {action}")

    print(f"\n{'[DRY RUN] ' if dry_run else ''}Migration complete!")
    print(f"\nNew structure:")
    print(f"  {new_dir}/")
    print(f"  ├── input/")
    print(f"  │   └── startups.csv")
    print(f"  └── output/")
    print(f"      ├── analysis_store/")
    print(f"      ├── raw_content/")
    print(f"      ├── briefs/")
    print(f"      └── *.csv, *.md, *.json")
    print(f"\n  {data_dir}/crawl_cache/ (unchanged - shared across months)")

    return new_dir


if __name__ == "__main__":
    import sys

    # Check for --dry-run flag
    dry_run = "--dry-run" in sys.argv

    # Get period from args or use default
    period = "2026-01"
    for arg in sys.argv[1:]:
        if not arg.startswith("--") and "-" in arg:
            period = arg
            break

    migrate(period=period, dry_run=dry_run)
