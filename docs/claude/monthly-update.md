# Monthly Startup Data Update Process

Follow these steps when you receive a new CSV with the latest funding data.

## Prerequisites

- New CSV file with startup funding data (e.g., `monthly-ai-startup-funding-DD-MM-YYYY.csv`)
- Azure CLI logged in: `az login`
- Python 3.12+ with virtual environment

## Step 1: Locate and Identify the New CSV

```bash
# Find CSV files
ls *.csv

# Count lines to see total rows
wc -l new-csv.csv existing-data/input/startups.csv

# Compute the delta (new startups)
python3 -c "
import csv

existing = set()
with open('apps/web/data/YYYY-MM/input/startups.csv', 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        existing.add(row['Transaction Name'].lower())

new_count = 0
with open('new-csv.csv', 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        if row['Transaction Name'].lower() not in existing:
            new_count += 1
            print(f'NEW: {row[\"Transaction Name\"]}')

print(f'Total new startups: {new_count}')
"
```

## Step 2: Copy CSV to Data Directories

```bash
# Copy to main data directory (used by analysis pipeline)
cp new-csv.csv data/YYYY-MM/input/startups.csv

# Copy to web data directory (used by frontend)
cp new-csv.csv apps/web/data/YYYY-MM/input/startups.csv
```

## Step 3: Generate Monthly Statistics

```bash
/Users/ozgurguler/Developer/Projects/startup-analysis/packages/analysis/venv/bin/python -c "
import sys
sys.path.insert(0, '/Users/ozgurguler/Developer/Projects/startup-analysis/packages/analysis')

from src.data.monthly_stats import MonthlyStatistics
from src.data.ingestion import load_startups_from_csv
from pathlib import Path

csv_path = Path('/Users/ozgurguler/Developer/Projects/startup-analysis/data/YYYY-MM/input/startups.csv')
startups = load_startups_from_csv(csv_path)
print(f'Loaded {len(startups)} startups')

monthly = MonthlyStatistics('YYYY-MM')
monthly.generate_full_stats(startups)

output_dir = Path('/Users/ozgurguler/Developer/Projects/startup-analysis/data/YYYY-MM/output')
output_dir.mkdir(parents=True, exist_ok=True)
stats_path = monthly.save(output_dir)
print(f'Stats saved to: {stats_path}')

period_dir = Path('/Users/ozgurguler/Developer/Projects/startup-analysis/data/YYYY-MM')
report_path = monthly.generate_summary_report(period_dir)
print(f'Summary saved to: {report_path}')
"
```

## Step 4: Update Web Data Files

```bash
# Copy monthly summary to web data
cp data/YYYY-MM/monthly_summary.md apps/web/data/YYYY-MM/monthly_summary.md

# Copy monthly stats JSON
cp data/YYYY-MM/output/monthly_stats.json apps/web/data/YYYY-MM/output/monthly_stats.json

# Copy enriched CSV (if exists)
cp data/YYYY-MM/output/startups_enriched_with_analysis.csv apps/web/data/YYYY-MM/output/
```

## Step 5: Commit and Push Changes

```bash
git add -A && git commit -m "Update YYYY-MM startup data: X new startups" && git push
```

After pushing to `main`, VM cron (`code-update`) will pick up the change and deploy the frontend.

Backup paths:
- Run the VM job manually via `runner.sh frontend-deploy ...` (if you can reach the VM).
- If the VM is down, deploy the frontend manually from an operator environment (see `docs/claude/deployment.md`).

## Full Automation Path (Future State)

When Azure Functions are fully deployed:

1. **Upload CSV to Blob Storage**:
   ```bash
   az storage blob upload \
     --account-name buildatlasstorage \
     --container-name startup-csvs \
     --name "incoming/monthly-startup-data.csv" \
     --file new-csv.csv \
     --auth-mode login
   ```

2. **Azure Function Triggers** (`process_csv_blob`): Classifies, crawls, analyzes, and saves to PostgreSQL.

3. **Deploy trigger:** Legacy Azure Function deploy triggering is deprecated/disabled; deploys are driven by VM cron (`sync-data` and `code-update`) and manual operator runs when needed.

## Troubleshooting

**Blob upload fails with network rules error:**
- Storage account has network restrictions
- Use the manual process above, or run the VM `sync-data` job (which has the correct network/identity access).

**Monthly stats fail:**
- Ensure Python venv has dependencies: `pip install pydantic pandas`
- Use full paths to Python interpreter and files
