#!/usr/bin/env python3
"""
Import startup data from CSV and briefs into PostgreSQL database.
Usage: python scripts/import_data.py
"""

import os
import csv
import json
import psycopg2
from psycopg2.extras import execute_values
from datetime import datetime
from pathlib import Path

# Database connection - use 127.0.0.1:5433 to avoid conflict with local PostgreSQL
DATABASE_URL = os.environ.get(
    'DATABASE_URL',
    'postgresql://postgres:postgres@127.0.0.1:5433/startupinvestments'
)

# Data paths
BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / 'data' / '2026-01'
CSV_FILE = BASE_DIR / '2601_inv - monthy-ai-startup-funding-22-01-2026.csv'
ENRICHED_CSV = DATA_DIR / 'output' / 'startups_enriched_with_analysis.csv'
BRIEFS_DIR = DATA_DIR / 'output' / 'briefs'
NEWSLETTER_FILE = DATA_DIR / 'output' / 'comprehensive_newsletter.md'
STATS_FILE = DATA_DIR / 'output' / 'monthly_stats.json'

PERIOD = '2026-01'


def parse_location(location_str):
    """Parse location string into city, country, continent."""
    if not location_str:
        return None, None, None

    parts = [p.strip() for p in location_str.split(',')]
    city = parts[0] if len(parts) > 0 else None
    country = parts[-2] if len(parts) >= 2 else None
    continent = parts[-1] if len(parts) >= 1 else None

    # Normalize continent
    continent_map = {
        'North America': 'north_america',
        'Europe': 'europe',
        'Asia': 'asia',
        'South America': 'south_america',
        'Africa': 'africa',
        'Oceania': 'oceania',
    }
    if continent:
        continent = continent_map.get(continent, continent.lower().replace(' ', '_'))

    return city, country, continent


def parse_money(money_str):
    """Parse money string to integer."""
    if not money_str:
        return None
    try:
        # Remove commas and convert
        return int(float(str(money_str).replace(',', '').replace('$', '')))
    except (ValueError, TypeError):
        return None


def parse_date(date_str):
    """Parse date string to date object."""
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        try:
            return datetime.strptime(date_str, '%m/%d/%Y').date()
        except ValueError:
            return None


def parse_bool(val):
    """Parse boolean value."""
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.lower() in ('true', 'yes', '1', 'high', 'medium')
    return False


def parse_float(val):
    """Parse float value."""
    if not val:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def load_brief(startup_name):
    """Load brief content for a startup."""
    # Try different naming conventions
    name_variants = [
        startup_name.lower().replace(' ', '_').replace('-', '_'),
        startup_name.lower().replace(' ', '-'),
        startup_name.lower().replace(' ', ''),
        startup_name.lower(),
    ]

    for variant in name_variants:
        brief_file = BRIEFS_DIR / f"{variant}_brief.md"
        if brief_file.exists():
            return brief_file.read_text()

    # Try partial match
    for brief_file in BRIEFS_DIR.glob('*_brief.md'):
        if startup_name.lower().replace(' ', '') in brief_file.stem.lower().replace('_', ''):
            return brief_file.read_text()

    return None


def parse_timestamp(ts_str):
    """Parse timestamp string, return None for empty."""
    if not ts_str or ts_str.strip() == '':
        return None
    try:
        return datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
    except ValueError:
        return None


def import_startups(conn):
    """Import startups from enriched CSV."""
    print(f"\n📊 Importing startups from {ENRICHED_CSV}...")

    if not ENRICHED_CSV.exists():
        print(f"  ❌ File not found: {ENRICHED_CSV}")
        return 0

    cur = conn.cursor()

    # Clear existing data for this period
    cur.execute("DELETE FROM startups WHERE period = %s", (PERIOD,))
    conn.commit()
    print(f"  🗑️  Cleared existing data for period {PERIOD}")

    imported = 0
    skipped = 0

    with open(ENRICHED_CSV, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)

        for row in reader:
            try:
                # Extract company name from "Series A - CompanyName" format
                transaction_name = row.get('Transaction Name', '')
                if ' - ' in transaction_name:
                    name = transaction_name.split(' - ', 1)[1].strip()
                else:
                    name = transaction_name.strip()
                if not name:
                    skipped += 1
                    continue

                # Parse location
                location = row.get('Organization Location', '')
                city, country, continent = parse_location(location)

                # Load brief
                brief_content = load_brief(name)

                # Determine genai_native from analysis
                genai_native = parse_bool(row.get('analysis_uses_genai', False))

                # Get pattern from build_patterns
                patterns = row.get('analysis_build_patterns', '')
                pattern = patterns.split(',')[0].strip() if patterns else None

                # Parse optional integers with empty string handling
                num_rounds = row.get('Number of Funding Rounds', '')
                num_rounds = int(num_rounds) if num_rounds and num_rounds.strip() else 0

                content_chars = row.get('analysis_content_analyzed_chars', '')
                content_chars = int(content_chars) if content_chars and content_chars.strip() else None

                cur.execute("""
                    INSERT INTO startups (
                        name, description, website, headquarters_city, headquarters_country,
                        continent, industry, pattern, stage, genai_native,
                        transaction_url, funding_type, money_raised_usd, announced_date,
                        funding_stage, num_funding_rounds, industries, lead_investors,
                        genai_intensity, models_mentioned, build_patterns, market_type,
                        sub_vertical, target_market, unique_findings, newsletter_potential,
                        technical_depth, confidence_score, content_analyzed_chars,
                        analysis_timestamp, brief_content, brief_generated_at, period
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s
                    )
                    RETURNING id
                """, (
                    name,
                    row.get('Organization Description') or None,
                    row.get('Organization Website') or None,
                    city,
                    country,
                    continent,
                    row.get('Organization Industries', '').split(',')[0].strip() if row.get('Organization Industries') else None,
                    pattern,
                    row.get('Funding Stage') or None,
                    genai_native,
                    row.get('Transaction Name URL') or None,
                    row.get('Funding Type') or None,
                    parse_money(row.get('Money Raised (in USD)')),
                    parse_date(row.get('Announced Date')),
                    row.get('Funding Stage') or None,
                    num_rounds,
                    row.get('Organization Industries') or None,
                    row.get('Lead Investors') or None,
                    row.get('analysis_genai_intensity') or None,
                    row.get('analysis_models_mentioned') or None,
                    row.get('analysis_build_patterns') or None,
                    row.get('analysis_market_type') or None,
                    row.get('analysis_sub_vertical') or None,
                    row.get('analysis_target_market') or None,
                    row.get('analysis_unique_findings') or None,
                    row.get('analysis_newsletter_potential') or None,
                    row.get('analysis_technical_depth') or None,
                    parse_float(row.get('analysis_confidence_score')),
                    content_chars,
                    parse_timestamp(row.get('analysis_timestamp')),
                    brief_content,
                    datetime.now() if brief_content else None,
                    PERIOD
                ))
                conn.commit()
                imported += 1

            except Exception as e:
                conn.rollback()
                print(f"  ⚠️  Error importing {row.get('Transaction Name', 'unknown')}: {e}")
                skipped += 1
                continue

    print(f"  ✅ Imported {imported} startups, skipped {skipped}")
    return imported


def import_newsletter(conn):
    """Import newsletter content."""
    print(f"\n📰 Importing newsletter...")

    if not NEWSLETTER_FILE.exists():
        print(f"  ❌ File not found: {NEWSLETTER_FILE}")
        return

    cur = conn.cursor()

    content = NEWSLETTER_FILE.read_text()
    title = f"AI Startup Funding Newsletter - {PERIOD}"

    # Parse period dates
    period_start = datetime.strptime(f"{PERIOD}-01", '%Y-%m-%d').date()
    period_end = datetime.strptime(f"{PERIOD}-31", '%Y-%m-%d').date() if PERIOD.endswith('01') else period_start

    cur.execute("""
        INSERT INTO newsletters (title, content, period_start, period_end, status, period)
        VALUES (%s, %s, %s, %s, 'published', %s)
        ON CONFLICT DO NOTHING
    """, (title, content, period_start, period_end, PERIOD))

    conn.commit()
    print(f"  ✅ Newsletter imported")


def import_investors(conn):
    """Extract and import unique investors."""
    print(f"\n👥 Importing investors...")

    cur = conn.cursor()

    # Get all lead investors from startups
    cur.execute("SELECT DISTINCT lead_investors FROM startups WHERE lead_investors IS NOT NULL AND lead_investors != ''")
    rows = cur.fetchall()

    investors = set()
    for row in rows:
        if row[0]:
            for inv in row[0].split(','):
                inv = inv.strip()
                if inv:
                    investors.add(inv)

    imported = 0
    for investor in investors:
        try:
            cur.execute("""
                INSERT INTO investors (name, type)
                VALUES (%s, 'VC')
                ON CONFLICT (name) DO NOTHING
            """, (investor,))
            imported += 1
        except Exception as e:
            print(f"  ⚠️  Error importing investor {investor}: {e}")

    conn.commit()
    print(f"  ✅ Imported {imported} investors")


def show_summary(conn):
    """Show import summary."""
    print("\n" + "="*60)
    print("📈 IMPORT SUMMARY")
    print("="*60)

    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM startups WHERE period = %s", (PERIOD,))
    startups_count = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM startups WHERE brief_content IS NOT NULL AND period = %s", (PERIOD,))
    briefs_count = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM investors")
    investors_count = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM newsletters WHERE period = %s", (PERIOD,))
    newsletters_count = cur.fetchone()[0]

    cur.execute("SELECT SUM(money_raised_usd) FROM startups WHERE period = %s", (PERIOD,))
    total_funding = cur.fetchone()[0] or 0

    cur.execute("SELECT COUNT(*) FROM startups WHERE genai_native = true AND period = %s", (PERIOD,))
    genai_count = cur.fetchone()[0]

    genai_pct = (genai_count/startups_count*100) if startups_count > 0 else 0
    print(f"""
  Period:           {PERIOD}
  Startups:         {startups_count}
  With Briefs:      {briefs_count}
  Investors:        {investors_count}
  Newsletters:      {newsletters_count}
  Total Funding:    ${total_funding:,.0f}
  GenAI Native:     {genai_count} ({genai_pct:.1f}%)
""")

    # Show pattern distribution
    cur.execute("""
        SELECT pattern, COUNT(*) as count
        FROM startups
        WHERE period = %s AND pattern IS NOT NULL
        GROUP BY pattern
        ORDER BY count DESC
        LIMIT 10
    """, (PERIOD,))

    print("  Top Patterns:")
    for row in cur.fetchall():
        print(f"    - {row[0]}: {row[1]}")

    # Show sub-vertical distribution
    cur.execute("""
        SELECT sub_vertical, COUNT(*) as count
        FROM startups
        WHERE period = %s AND sub_vertical IS NOT NULL
        GROUP BY sub_vertical
        ORDER BY count DESC
        LIMIT 10
    """, (PERIOD,))

    print("\n  Top Sub-Verticals:")
    for row in cur.fetchall():
        print(f"    - {row[0]}: {row[1]}")


def main():
    print("="*60)
    print("🚀 STARTUP DATA IMPORT")
    print("="*60)
    print(f"Database: {DATABASE_URL.split('@')[1] if '@' in DATABASE_URL else DATABASE_URL}")
    print(f"Period: {PERIOD}")

    try:
        conn = psycopg2.connect(DATABASE_URL)
        print("✅ Connected to database")

        # Import data
        import_startups(conn)
        import_newsletter(conn)
        import_investors(conn)

        # Show summary
        show_summary(conn)

        conn.close()
        print("\n✅ Import complete!")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        raise


if __name__ == '__main__':
    main()
