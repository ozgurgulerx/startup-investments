#!/bin/bash
# Comprehensive Data Regeneration Script
# Regenerates all data artifacts when startup data changes
#
# Usage: ./scripts/regenerate-data.sh [PERIOD]
# Example: ./scripts/regenerate-data.sh 2026-01
#
# This script regenerates:
# 1. Monthly statistics (monthly_stats.json)
# 2. Monthly brief (monthly_brief.json)
# 3. Newsletter content (comprehensive_newsletter.md)
# 4. Enriched CSV with analysis data
# 5. Syncs to database
# 6. Copies to public directories (for client-side fetching)

set -e

PERIOD="${1:-2026-01}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=============================================="
echo "Data Regeneration for Period: $PERIOD"
echo "=============================================="
echo ""

# Check if CSV exists
CSV_PATH="$PROJECT_ROOT/apps/web/data/$PERIOD/input/startups.csv"
if [ ! -f "$CSV_PATH" ]; then
    echo "ERROR: CSV not found at $CSV_PATH"
    exit 1
fi

STARTUP_COUNT=$(wc -l < "$CSV_PATH" | tr -d ' ')
echo "Found $((STARTUP_COUNT - 1)) startups in CSV"
echo ""

# ============================================
# Step 1: Regenerate Monthly Statistics
# ============================================
echo "[1/6] Regenerating monthly_stats.json..."

cd "$PROJECT_ROOT/packages/analysis"

# Check if Python venv exists
if [ -d "venv" ]; then
    PYTHON="$PROJECT_ROOT/packages/analysis/venv/bin/python"
elif [ -d ".venv" ]; then
    PYTHON="$PROJECT_ROOT/packages/analysis/.venv/bin/python"
else
    PYTHON="/opt/homebrew/bin/python3"
fi

$PYTHON << EOF
import sys
sys.path.insert(0, '$PROJECT_ROOT/packages/analysis')

from pathlib import Path
import json
import csv
import statistics

csv_path = Path('$PROJECT_ROOT/apps/web/data/$PERIOD/input/startups.csv')
analysis_store_path = Path('$PROJECT_ROOT/apps/web/data/$PERIOD/output/analysis_store')
stats_path = Path('$PROJECT_ROOT/apps/web/data/$PERIOD/output/monthly_stats.json')

# Load existing stats or create new
if stats_path.exists():
    with open(stats_path, 'r') as f:
        stats = json.load(f)
else:
    stats = {'period': '$PERIOD'}

# ============================================
# Recalculate deal_summary from CSV
# This ensures total_deals is always accurate
# ============================================
funding_amounts = []
with open(csv_path, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    rows = list(reader)
    for row in rows:
        amount_str = row.get('Money Raised (in USD)', '').replace(',', '').strip()
        if amount_str:
            try:
                amount = float(amount_str)
                if amount > 0:
                    funding_amounts.append(amount)
            except ValueError:
                pass

total_deals = len(rows)
stats['deal_summary'] = {
    'total_deals': total_deals,
    'deals_with_funding': len(funding_amounts),
    'total_funding_usd': sum(funding_amounts) if funding_amounts else 0,
    'average_deal_size': statistics.mean(funding_amounts) if funding_amounts else 0,
    'median_deal_size': statistics.median(funding_amounts) if funding_amounts else 0,
    'min_deal_size': min(funding_amounts) if funding_amounts else 0,
    'max_deal_size': max(funding_amounts) if funding_amounts else 0,
}
print(f"  Updated deal_summary: {total_deals} total deals")

# ============================================
# Update genai_analysis from analysis store
# ============================================
base_path = analysis_store_path / 'base_analyses'
analyses = []
if base_path.exists():
    for f in base_path.glob('*.json'):
        with open(f, 'r') as fp:
            analyses.append(json.load(fp))

if analyses:
    uses_genai_count = sum(1 for a in analyses if a.get('uses_genai', False))

    intensity_dist = {}
    pattern_dist = {}
    newsletter_dist = {}
    vertical_dist = {}
    market_dist = {}
    depth_dist = {}

    for a in analyses:
        intensity = a.get('genai_intensity', 'none')
        intensity_dist[intensity] = intensity_dist.get(intensity, 0) + 1

        for p in a.get('build_patterns', []):
            name = p.get('name', p) if isinstance(p, dict) else p
            pattern_dist[name] = pattern_dist.get(name, 0) + 1

        nl = a.get('newsletter_potential', 'low')
        newsletter_dist[nl] = newsletter_dist.get(nl, 0) + 1

        vertical = a.get('sub_vertical') or a.get('vertical', 'unknown')
        vertical_dist[vertical] = vertical_dist.get(vertical, 0) + 1

        market = a.get('market_type', 'unknown')
        market_dist[market] = market_dist.get(market, 0) + 1

        depth = a.get('technical_depth', 'unknown')
        depth_dist[depth] = depth_dist.get(depth, 0) + 1

    stats['genai_analysis'] = {
        'total_analyzed': len(analyses),
        'uses_genai_count': uses_genai_count,
        'genai_adoption_rate': uses_genai_count / len(analyses) if analyses else 0,
        'intensity_distribution': dict(sorted(intensity_dist.items(), key=lambda x: -x[1])),
        'pattern_distribution': dict(sorted(pattern_dist.items(), key=lambda x: -x[1])),
        'newsletter_potential': dict(sorted(newsletter_dist.items(), key=lambda x: -x[1])),
        'vertical_distribution': dict(sorted(vertical_dist.items(), key=lambda x: -x[1])[:20]),
        'market_type_distribution': market_dist,
        'technical_depth_distribution': depth_dist,
        'high_potential_startups': [
            a.get('company_name') for a in analyses
            if a.get('newsletter_potential') == 'high'
        ][:20]
    }
    print(f"  Updated genai_analysis: {len(analyses)} analyzed")
else:
    print("  No analyses found in store")

with open(stats_path, 'w') as f:
    json.dump(stats, f, indent=2)
EOF

echo "  Done"
echo ""

# ============================================
# Step 2: Regenerate Monthly Brief
# ============================================
echo "[2/6] Regenerating monthly_brief.json..."

cd "$PROJECT_ROOT/apps/web"

npx tsx -e "
const { generateMonthlyBrief } = require('./lib/data/generate-monthly-brief');
const fs = require('fs');
const path = require('path');

async function main() {
  const brief = await generateMonthlyBrief('$PERIOD');
  const outputPath = path.join(process.cwd(), 'data', '$PERIOD', 'output', 'monthly_brief.json');
  fs.writeFileSync(outputPath, JSON.stringify(brief, null, 2));
  console.log('  Generated at:', brief.generatedAt);
  console.log('  Total deals:', brief.metrics.totalDeals);
}

main().catch(e => { console.error('  Error:', e.message); process.exit(1); });
"

echo ""

# ============================================
# Step 3: Regenerate Newsletter Content
# ============================================
echo "[3/6] Regenerating newsletter content..."

cd "$PROJECT_ROOT/packages/analysis"

$PYTHON << EOF
import sys
sys.path.insert(0, '$PROJECT_ROOT/packages/analysis')

from pathlib import Path
import json

try:
    from src.reports.newsletter_generator import generate_viral_newsletter

    analysis_store_path = Path('$PROJECT_ROOT/apps/web/data/$PERIOD/output/analysis_store/base_analyses')
    output_path = Path('$PROJECT_ROOT/apps/web/data/$PERIOD/output')

    if analysis_store_path.exists():
        analyses = []
        for f in analysis_store_path.glob('*.json'):
            with open(f, 'r') as fp:
                analyses.append(json.load(fp))

        if analyses:
            # Convert to expected format
            from src.data.models import StartupAnalysis, FundingStage, GenAIIntensity, MarketType, TargetMarket, BuildPattern
            from src.data.models import CompetitiveAnalysis, Competitor, Differentiation, SecretSauce

            parsed = []
            for a in analyses:
                try:
                    # Create minimal CompetitiveAnalysis
                    comp = CompetitiveAnalysis(
                        competitors=[],
                        differentiation=Differentiation(),
                        secret_sauce=SecretSauce()
                    )

                    analysis = StartupAnalysis(
                        company_name=a.get('company_name', 'Unknown'),
                        company_slug=a.get('company_slug', 'unknown'),
                        description=a.get('description', ''),
                        website=a.get('website'),
                        funding_amount=a.get('funding_amount'),
                        funding_stage=FundingStage(a.get('funding_stage', 'unknown')),
                        uses_genai=a.get('uses_genai', False),
                        genai_intensity=GenAIIntensity(a.get('genai_intensity', 'none')),
                        confidence_score=a.get('confidence_score', 0.5),
                        models_mentioned=a.get('models_mentioned', []),
                        build_patterns=[BuildPattern(name=p.get('name', p) if isinstance(p, dict) else p, confidence=0.8) for p in a.get('build_patterns', [])],
                        unique_findings=a.get('unique_findings', []),
                        evidence_quotes=a.get('evidence_quotes', []),
                        market_type=MarketType(a.get('market_type', 'horizontal')),
                        sub_vertical=a.get('sub_vertical'),
                        target_market=TargetMarket(a.get('target_market', 'enterprise')),
                        newsletter_potential=a.get('newsletter_potential', 'low'),
                        technical_depth=a.get('technical_depth', 'surface'),
                        sources_crawled=a.get('sources_crawled', []),
                        raw_content_analyzed=a.get('raw_content_analyzed', 0),
                        competitive_analysis=comp
                    )
                    parsed.append(analysis)
                except Exception as e:
                    continue

            if parsed:
                newsletter_path = output_path / 'comprehensive_newsletter.md'
                generate_viral_newsletter(parsed, newsletter_path)
                print(f"  Generated newsletter with {len(parsed)} startups")
            else:
                print("  No valid analyses to generate newsletter")
        else:
            print("  No analyses found")
    else:
        print("  Analysis store not found")
except ImportError as e:
    print(f"  Skipping newsletter (missing dependency: {e})")
except Exception as e:
    print(f"  Error: {e}")
EOF

echo ""

# ============================================
# Step 4: Regenerate Enriched CSV
# ============================================
echo "[4/6] Regenerating enriched CSV..."

$PYTHON << EOF
import sys
sys.path.insert(0, '$PROJECT_ROOT/packages/analysis')

from pathlib import Path
import json
import csv

analysis_store_path = Path('$PROJECT_ROOT/apps/web/data/$PERIOD/output/analysis_store/base_analyses')
csv_path = Path('$PROJECT_ROOT/apps/web/data/$PERIOD/input/startups.csv')
output_path = Path('$PROJECT_ROOT/apps/web/data/$PERIOD/output/startups_enriched_with_analysis.csv')

if not analysis_store_path.exists():
    print("  Analysis store not found, skipping")
    sys.exit(0)

# Load analyses
analysis_map = {}
for f in analysis_store_path.glob('*.json'):
    with open(f, 'r') as fp:
        a = json.load(fp)
        key = a.get('company_name', '').lower()
        analysis_map[key] = a

# Read original CSV
with open(csv_path, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    original_fieldnames = list(reader.fieldnames or [])
    rows = list(reader)

# Analysis columns
analysis_cols = [
    'analysis_uses_genai', 'analysis_genai_intensity', 'analysis_models_mentioned',
    'analysis_build_patterns', 'analysis_market_type', 'analysis_sub_vertical',
    'analysis_target_market', 'analysis_newsletter_potential', 'analysis_technical_depth',
    'analysis_confidence_score', 'analysis_competitors', 'analysis_competitive_moat'
]

new_fieldnames = original_fieldnames + analysis_cols

enriched_rows = []
matched = 0
for row in rows:
    # Extract company name from transaction name
    transaction_name = row.get('Transaction Name', '')
    company_name = transaction_name
    for prefix in ['Series A - ', 'Series B - ', 'Series C - ', 'Series D - ', 'Series E - ',
                   'Seed Round - ', 'Pre Seed Round - ', 'Venture Round - ', 'Debt Financing - ',
                   'Private Equity Round - ', 'Corporate Round - ', 'Angel Round - ', 'Funding Round - ']:
        company_name = company_name.replace(prefix, '')
    company_name = company_name.strip()

    analysis = analysis_map.get(company_name.lower())

    if analysis:
        matched += 1
        patterns = analysis.get('build_patterns', [])
        pattern_names = [p.get('name', p) if isinstance(p, dict) else p for p in patterns]
        competitors = analysis.get('competitive_analysis', {}).get('competitors', [])
        competitor_names = [c.get('name', c) if isinstance(c, dict) else c for c in competitors]

        row['analysis_uses_genai'] = 'Yes' if analysis.get('uses_genai') else 'No'
        row['analysis_genai_intensity'] = analysis.get('genai_intensity', '')
        row['analysis_models_mentioned'] = '; '.join(analysis.get('models_mentioned', []))
        row['analysis_build_patterns'] = '; '.join(pattern_names)
        row['analysis_market_type'] = analysis.get('market_type', '')
        row['analysis_sub_vertical'] = analysis.get('sub_vertical', '')
        row['analysis_target_market'] = analysis.get('target_market', '')
        row['analysis_newsletter_potential'] = analysis.get('newsletter_potential', '')
        row['analysis_technical_depth'] = analysis.get('technical_depth', '')
        row['analysis_confidence_score'] = str(analysis.get('confidence_score', ''))
        row['analysis_competitors'] = '; '.join(competitor_names[:5])
        row['analysis_competitive_moat'] = analysis.get('competitive_analysis', {}).get('competitive_moat', '')
    else:
        for col in analysis_cols:
            row[col] = ''

    enriched_rows.append(row)

with open(output_path, 'w', encoding='utf-8', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=new_fieldnames)
    writer.writeheader()
    writer.writerows(enriched_rows)

print(f"  Enriched {matched}/{len(rows)} startups with analysis data")
EOF

echo ""

# ============================================
# Step 5: Sync to Database
# ============================================
echo "[5/6] Syncing to database..."

# Check if DATABASE_URL exists
if [ -f "$PROJECT_ROOT/.env" ] && grep -q "DATABASE_URL" "$PROJECT_ROOT/.env"; then
    $PYTHON << EOF
import sys
import os
sys.path.insert(0, '$PROJECT_ROOT')

# Load DATABASE_URL
with open('$PROJECT_ROOT/.env', 'r') as f:
    for line in f:
        if line.startswith('DATABASE_URL='):
            os.environ['DATABASE_URL'] = line.split('=', 1)[1].strip().strip('"')
            break

try:
    import psycopg2
    import csv
    import re

    database_url = os.environ.get('DATABASE_URL')
    if not database_url:
        print("  DATABASE_URL not found, skipping")
        sys.exit(0)

    conn = psycopg2.connect(database_url)
    cur = conn.cursor()

    def slugify(name):
        return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')

    csv_path = '$PROJECT_ROOT/apps/web/data/$PERIOD/input/startups.csv'
    inserted, updated = 0, 0

    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get('Transaction Name', '')
            if ' - ' in name:
                name = name.split(' - ', 1)[1]

            slug = slugify(name)

            cur.execute("SELECT id FROM startups WHERE slug = %s", (slug,))
            existing = cur.fetchone()

            if existing:
                cur.execute("""
                    UPDATE startups SET
                        description = COALESCE(%s, description),
                        website = COALESCE(%s, website),
                        updated_at = NOW()
                    WHERE id = %s
                """, (row.get('Organization Description'), row.get('Organization Website'), existing[0]))
                updated += 1
            else:
                cur.execute("""
                    INSERT INTO startups (name, slug, description, website)
                    VALUES (%s, %s, %s, %s)
                """, (name, slug, row.get('Organization Description'), row.get('Organization Website')))
                inserted += 1

            conn.commit()

    print(f"  Database sync: {inserted} inserted, {updated} updated")
    cur.close()
    conn.close()
except ImportError:
    print("  psycopg2 not available, skipping database sync")
except Exception as e:
    print(f"  Database sync error: {e}")
EOF
else
    echo "  DATABASE_URL not found, skipping database sync"
fi

# ============================================
# Step 6: Copy to Public Directories
# ============================================
echo "[6/6] Copying to public directories..."

# Copy full brief to public/data/briefs/
cp "$PROJECT_ROOT/apps/web/data/$PERIOD/output/monthly_brief.json" "$PROJECT_ROOT/apps/web/public/data/briefs/$PERIOD.json" 2>/dev/null && echo "  Copied to public/data/briefs/$PERIOD.json" || echo "  Skipped public/data/briefs (file not found)"

# Update public/data/briefings/ with key stats
$PYTHON << EOF
import json
from pathlib import Path

brief_path = Path('$PROJECT_ROOT/apps/web/data/$PERIOD/output/monthly_brief.json')
briefings_path = Path('$PROJECT_ROOT/apps/web/public/data/briefings/$PERIOD.json')

if not brief_path.exists():
    print("  Brief not found, skipping briefings update")
    exit(0)

with open(brief_path, 'r') as f:
    brief = json.load(f)

if not briefings_path.exists():
    print("  Briefings file not found, skipping")
    exit(0)

with open(briefings_path, 'r') as f:
    briefings = json.load(f)

# Update key stats
briefings['stats']['totalDeals'] = brief['metrics']['totalDeals']
briefings['stats']['totalFunding'] = brief['metrics']['totalFunding']
briefings['stats']['genaiAdoptionRate'] = brief['metrics']['genaiAdoptionPct']

# Update insight text to match
genai_pct = brief['metrics']['genaiAdoptionPct']
briefings['insight'] = f"Capital concentrated around vertical data moats, with {genai_pct}% of funded startups building on generative AI infrastructure."

with open(briefings_path, 'w') as f:
    json.dump(briefings, f, indent=2)

print(f"  Updated briefings: totalDeals={brief['metrics']['totalDeals']}, genaiAdoptionRate={genai_pct}")
EOF

echo ""
echo "=============================================="
echo "Data Regeneration Complete!"
echo "=============================================="
echo ""
echo "Updated files:"
echo "  - apps/web/data/$PERIOD/output/monthly_stats.json"
echo "  - apps/web/data/$PERIOD/output/monthly_brief.json"
echo "  - apps/web/data/$PERIOD/output/comprehensive_newsletter.md"
echo "  - apps/web/data/$PERIOD/output/startups_enriched_with_analysis.csv"
echo "  - apps/web/public/data/briefs/$PERIOD.json"
echo "  - apps/web/public/data/briefings/$PERIOD.json"
echo ""
echo "Remember to commit and push these changes!"
