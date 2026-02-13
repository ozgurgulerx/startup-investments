#!/usr/bin/env python3
"""
Populate analysis_data JSONB column from analysis store JSON files.

This script reads individual startup analysis JSON files and populates
the analysis_data column in the startups table for database-driven queries.

Usage: python scripts/populate-analysis-data.py [--period 2026-01] [--region global|turkey]

Requires DATABASE_URL environment variable to be set.
"""

import os
import json
import argparse
import psycopg2
from psycopg2.extras import Json
from pathlib import Path

# Try to load dotenv if available
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv not required if DATABASE_URL is already set

# Database connection
DATABASE_URL = os.environ.get('DATABASE_URL')
if not DATABASE_URL:
    print("ERROR: DATABASE_URL environment variable not set")
    print("Please set DATABASE_URL in your .env file or environment")
    exit(1)

# Data paths
BASE_DIR = Path(__file__).parent.parent
WEB_DATA_ROOT = BASE_DIR / 'apps' / 'web' / 'data'


def normalize_region(value: str) -> str:
    raw = (value or "").strip().lower()
    if raw in {"tr", "turkey"}:
        return "turkey"
    return "global"


def data_dir_for_region(region: str) -> Path:
    """Resolve disk dataset folder for a region."""
    # Turkey data lives under apps/web/data/tr for historical reasons.
    return WEB_DATA_ROOT / ("tr" if region == "turkey" else "")

def slugify(name: str) -> str:
    """Convert name to slug format."""
    import re
    slug = name.lower()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    slug = slug.strip('-')
    return slug


def load_analysis_files(period: str, *, region: str) -> dict:
    """Load all analysis JSON files for a period."""
    base_dir = data_dir_for_region(region)
    analysis_dir = base_dir / period / 'output' / 'analysis_store' / 'base_analyses'

    if not analysis_dir.exists():
        print(f"Analysis directory not found: {analysis_dir}")
        return {}

    analyses = {}
    for json_file in analysis_dir.glob('*.json'):
        try:
            with open(json_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                slug = json_file.stem
                analyses[slug] = data
        except Exception as e:
            print(f"  Warning: Failed to load {json_file.name}: {e}")

    return analyses


def populate_analysis_data(conn, period: str, analyses: dict, *, region: str):
    """Populate analysis_data column for startups."""
    cur = conn.cursor()

    updated = 0
    not_found = 0
    errors = 0

    for slug, analysis in analyses.items():
        try:
            # Extract denormalized fields for efficient querying
            funding_amount = analysis.get('funding_amount')
            funding_stage = analysis.get('funding_stage')
            uses_genai = analysis.get('uses_genai', False)

            # Get startup by slug
            cur.execute("""
                UPDATE startups
                SET
                    analysis_data = %s,
                    period = %s,
                    money_raised_usd = %s,
                    funding_stage = %s,
                    uses_genai = %s,
                    onboarding_status = CASE
                        WHEN COALESCE(onboarding_status, 'verified') = 'stub' THEN 'verified'
                        ELSE onboarding_status
                    END,
                    updated_at = NOW()
                WHERE dataset_region = %s AND slug = %s
                RETURNING id
            """, (
                Json(analysis),
                period,
                funding_amount,
                funding_stage,
                uses_genai,
                region,
                slug
            ))

            result = cur.fetchone()
            if result:
                updated += 1
            else:
                # Try to find by name
                company_name = analysis.get('company_name', '')
                cur.execute("""
                    UPDATE startups
                    SET
                        analysis_data = %s,
                        period = %s,
                        money_raised_usd = %s,
                        funding_stage = %s,
                        uses_genai = %s,
                        onboarding_status = CASE
                            WHEN COALESCE(onboarding_status, 'verified') = 'stub' THEN 'verified'
                            ELSE onboarding_status
                        END,
                        updated_at = NOW()
                    WHERE dataset_region = %s AND LOWER(name) = LOWER(%s)
                    RETURNING id
                """, (
                    Json(analysis),
                    period,
                    funding_amount,
                    funding_stage,
                    uses_genai,
                    region,
                    company_name
                ))

                result = cur.fetchone()
                if result:
                    updated += 1
                else:
                    not_found += 1
                    if not_found <= 10:
                        print(f"    Not found in DB: {slug} ({company_name})")

            conn.commit()

        except Exception as e:
            conn.rollback()
            errors += 1
            print(f"    Error updating {slug}: {e}")

    return updated, not_found, errors


def populate_from_csv(conn, period: str, *, region: str):
    """
    Alternative: Populate directly from enriched CSV if JSON files not available.
    Creates analysis_data from CSV columns.
    """
    import csv

    base_dir = data_dir_for_region(region)
    csv_path = base_dir / period / 'output' / 'startups_enriched_with_analysis.csv'
    if not csv_path.exists():
        print(f"Enriched CSV not found: {csv_path}")
        return 0, 0, 0

    cur = conn.cursor()
    updated = 0
    not_found = 0
    errors = 0

    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)

        for row in reader:
            try:
                # Extract company name
                transaction_name = row.get('Transaction Name', '')
                if ' - ' in transaction_name:
                    name = transaction_name.split(' - ', 1)[1].strip()
                else:
                    name = transaction_name.strip()

                if not name:
                    continue

                slug = slugify(name)

                # Build analysis data from CSV columns
                analysis = {
                    'company_name': name,
                    'company_slug': slug,
                    'description': row.get('Organization Description'),
                    'website': row.get('Organization Website'),
                    'location': row.get('Organization Location'),
                    'uses_genai': row.get('analysis_uses_genai', '').lower() == 'true',
                    'genai_intensity': row.get('analysis_genai_intensity'),
                    'market_type': row.get('analysis_market_type'),
                    'sub_vertical': row.get('analysis_sub_vertical'),
                    'target_market': row.get('analysis_target_market'),
                    'newsletter_potential': row.get('analysis_newsletter_potential'),
                    'technical_depth': row.get('analysis_technical_depth'),
                    'unique_findings': row.get('analysis_unique_findings'),
                }

                # Parse build patterns
                patterns_str = row.get('analysis_build_patterns', '')
                if patterns_str:
                    patterns = [p.strip() for p in patterns_str.split(',') if p.strip()]
                    analysis['build_patterns'] = [{'name': p, 'confidence': 0.8} for p in patterns]

                # Parse confidence score
                conf_score = row.get('analysis_confidence_score')
                if conf_score:
                    try:
                        analysis['confidence_score'] = float(conf_score)
                    except ValueError:
                        pass

                # Parse funding
                funding_str = row.get('Money Raised (in USD)', '')
                funding_amount = None
                if funding_str:
                    try:
                        funding_amount = int(float(funding_str.replace(',', '')))
                        analysis['funding_amount'] = funding_amount
                    except ValueError:
                        pass

                funding_stage = row.get('Funding Stage')
                analysis['funding_stage'] = funding_stage

                # Update database
                cur.execute("""
                    UPDATE startups
                    SET
                        analysis_data = %s,
                        period = %s,
                        money_raised_usd = %s,
                        funding_stage = %s,
                        uses_genai = %s,
                        onboarding_status = CASE
                            WHEN COALESCE(onboarding_status, 'verified') = 'stub' THEN 'verified'
                            ELSE onboarding_status
                        END,
                        updated_at = NOW()
                    WHERE dataset_region = %s AND (slug = %s OR LOWER(name) = LOWER(%s))
                    RETURNING id
                """, (
                    Json(analysis),
                    period,
                    funding_amount,
                    funding_stage,
                    analysis['uses_genai'],
                    region,
                    slug,
                    name
                ))

                result = cur.fetchone()
                if result:
                    updated += 1
                else:
                    not_found += 1

                conn.commit()

            except Exception as e:
                conn.rollback()
                errors += 1
                print(f"    Error: {e}")

    return updated, not_found, errors


def main():
    parser = argparse.ArgumentParser(description='Populate analysis_data JSONB column')
    parser.add_argument('--period', default='2026-01', help='Period to process (default: 2026-01)')
    parser.add_argument('--region', default='global', help='Dataset region: global or turkey (legacy alias: tr)')
    parser.add_argument('--from-csv', action='store_true', help='Use CSV instead of JSON files')
    args = parser.parse_args()

    region = normalize_region(args.region)

    print("=" * 60)
    print("POPULATE ANALYSIS DATA")
    print("=" * 60)
    print(f"Period: {args.period}")
    print(f"Region: {region}")
    print(f"Database: {DATABASE_URL.split('@')[1] if '@' in DATABASE_URL else 'configured'}")

    try:
        conn = psycopg2.connect(DATABASE_URL)
        print("Connected to database")

        if args.from_csv:
            print(f"\nLoading from enriched CSV...")
            updated, not_found, errors = populate_from_csv(conn, args.period, region=region)
        else:
            # Load analysis files
            print(f"\nLoading analysis files...")
            analyses = load_analysis_files(args.period, region=region)
            print(f"  Found {len(analyses)} analysis files")

            if not analyses:
                print("\nNo analysis files found. Trying CSV fallback...")
                updated, not_found, errors = populate_from_csv(conn, args.period, region=region)
            else:
                # Populate database
                print(f"\nPopulating database...")
                updated, not_found, errors = populate_analysis_data(conn, args.period, analyses, region=region)

        print("\n" + "=" * 60)
        print("SUMMARY")
        print("=" * 60)
        print(f"  Updated:   {updated}")
        print(f"  Not found: {not_found}")
        print(f"  Errors:    {errors}")

        # Show sample of populated data
        cur = conn.cursor()
        cur.execute("""
            SELECT name,
                   analysis_data->>'uses_genai' as uses_genai,
                   money_raised_usd,
                   funding_stage
            FROM startups
            WHERE dataset_region = %s AND period = %s AND analysis_data IS NOT NULL
            ORDER BY money_raised_usd DESC NULLS LAST
            LIMIT 5
        """, (region, args.period))

        print("\nSample populated records:")
        for row in cur.fetchall():
            print(f"  - {row[0]}: GenAI={row[1]}, ${row[2]:,}" if row[2] else f"  - {row[0]}: GenAI={row[1]}")

        conn.close()
        print("\nDone!")

    except Exception as e:
        print(f"\nError: {e}")
        raise


if __name__ == '__main__':
    main()
