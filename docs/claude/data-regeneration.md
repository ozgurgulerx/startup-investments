# Data Regeneration Workflow

When startup data changes (CSV updates, new analyses added), multiple data artifacts need to be regenerated to keep the frontend in sync.

## Data Artifacts

| Artifact | Path | Purpose | Triggers |
|----------|------|---------|----------|
| `monthly_stats.json` | `apps/web/data/{period}/output/` | Aggregate statistics, GenAI adoption rates | CSV change, analysis store change |
| `monthly_brief.json` | `apps/web/data/{period}/output/` | Intelligence brief for /brief page | Stats change |
| `comprehensive_newsletter.md` | `apps/web/data/{period}/output/` | Newsletter content for /library | Analysis store change |
| `startups_enriched_with_analysis.csv` | `apps/web/data/{period}/output/` | CSV with analysis columns added | CSV or analysis change |
| `briefs/*.md` | `apps/web/data/{period}/output/briefs/` | Individual company briefs | Per-startup analysis |
| Database tables | PostgreSQL | Startup records, funding rounds | CSV change |

## Regeneration Order (IMPORTANT)

1. First: `monthly_stats.json` (depends on analysis store)
2. Then: `monthly_brief.json` (depends on stats)
3. Then: Enriched CSV (depends on analysis store)

## Automatic Regeneration (VM Cron)

VM cron job `sync-data` is the primary regeneration + sync loop (blob sync -> regen artifacts -> commit/push -> DB sync -> frontend deploy).

**Manual trigger (VM):**
```bash
/opt/buildatlas/startup-analysis/infrastructure/vm-cron/lib/runner.sh \
  sync-data 45 \
  /opt/buildatlas/startup-analysis/infrastructure/vm-cron/jobs/sync-data.sh
```

## Local Regeneration Script

```bash
# Regenerate all data for a period
./scripts/regenerate-data.sh 2026-01

# What it does:
# 1. Updates monthly_stats.json with genai_analysis from analysis store
# 2. Regenerates monthly_brief.json via TypeScript generator
# 3. Regenerates newsletter content (if Python dependencies available)
# 4. Regenerates enriched CSV
# 5. Syncs to database (if DATABASE_URL in .env)
```

## Manual Regeneration Commands

**Regenerate monthly brief only:**
```bash
cd apps/web
npx tsx -e "
const { generateMonthlyBrief } = require('./lib/data/generate-monthly-brief');
const fs = require('fs');

generateMonthlyBrief('2026-01').then(brief => {
  fs.writeFileSync('data/2026-01/output/monthly_brief.json', JSON.stringify(brief, null, 2));
  console.log('Generated at:', brief.generatedAt);
});
"
```

**Regenerate monthly stats from analysis store:**
```python
# Run from packages/analysis directory
python3 << 'EOF'
from pathlib import Path
import json

period = '2026-01'
stats_path = Path(f'../../apps/web/data/{period}/output/monthly_stats.json')
analysis_path = Path(f'../../apps/web/data/{period}/output/analysis_store/base_analyses')

with open(stats_path, 'r') as f:
    stats = json.load(f)

analyses = [json.load(open(f)) for f in analysis_path.glob('*.json')]

# Recalculate genai_analysis section
uses_genai = sum(1 for a in analyses if a.get('uses_genai'))
stats['genai_analysis'] = {
    'total_analyzed': len(analyses),
    'uses_genai_count': uses_genai,
    'genai_adoption_rate': uses_genai / len(analyses),
    # ... other fields
}

with open(stats_path, 'w') as f:
    json.dump(stats, f, indent=2)
EOF
```

## Frontend Pages and Their Data Dependencies

| Page | Data Source | Key Data |
|------|-------------|----------|
| `/brief` | `monthly_brief.json` | Metrics, patterns, top deals, spotlight |
| `/dealbook` | `analysis_store/base_analyses/*` + `monthly_stats.json` | Individual startup data, aggregate stats |
| `/signals` | `monthly_stats.json` | Pattern distribution, GenAI adoption |
| `/capital` | `monthly_stats.json` | Funding by stage, geography, investors |
| `/library` | `comprehensive_newsletter.md` | Newsletter markdown content |
| `/company/[slug]` | `analysis_store/base_analyses/{slug}.json` | Individual startup analysis |

## Data Consistency: Single Source of Truth for Counts

**Single source of truth:** `monthly_stats.json` -> `deal_summary.total_deals`

All pages must display the same deal count:

| Page | Data Access |
|------|-------------|
| `/brief` | `brief.metrics.totalDeals` |
| `/dealbook` | `stats.deal_summary.total_deals` |
| `/signals` | `stats.deal_summary.total_deals` |
| `/capital` | `stats.deal_summary.total_deals` |
| `/library` | `stats.deal_summary.total_deals` |

**DO NOT use these for primary counts:**
- `startups.length` (only counts startups with analysis files)
- `stats.genai_analysis.total_analyzed` (only GenAI-analyzed subset)
- Hardcoded numbers like "200+"

## Automated Workflow Details

The primary automation is the VM cron job `sync-data` (`infrastructure/vm-cron/jobs/sync-data.sh`):

```
Step 1: Sync new input blobs / datasets to disk
Step 2: Recalculate monthly_stats.json and other output artifacts
Step 3: Regenerate monthly_brief.json + newsletters (when enabled)
Step 4: Commit/push regenerated files (dataset-as-code)
Step 5: Sync startups/funding rounds + analysis_data into Postgres
Step 6: Trigger frontend deploy (so build includes the new datasets)
```

GitHub Actions workflows are removed from this repo. Backup path is a manual VM run of `sync-data` (or `frontend-deploy` after a push).
