#!/usr/bin/env tsx
/**
 * Backfill Brief Editions
 *
 * One-time script to populate brief_editions + brief_revisions
 * with historical data. Generates sealed editions for past periods
 * and rolling editions for the current period.
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/backfill-brief-editions.ts
 *
 * Options:
 *   --dry-run   Print what would be generated without writing to DB
 *   --months N  Number of past months to backfill (default: 6)
 *   --weeks N   Number of past weeks to backfill (default: 8)
 */

import { Pool } from 'pg';
import { makeBriefService } from '../apps/api/src/services/brief';

const DRY_RUN = process.argv.includes('--dry-run');
const MONTHS_BACK = parseInt(process.argv.find(a => a.startsWith('--months='))?.split('=')[1] || '6');
const WEEKS_BACK = parseInt(process.argv.find(a => a.startsWith('--weeks='))?.split('=')[1] || '8');

const REGIONS = ['global', 'turkey'] as const;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const briefService = makeBriefService(pool);

  console.log(`=== Backfill Brief Editions ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Months back: ${MONTHS_BACK}, Weeks back: ${WEEKS_BACK}`);
  console.log(`Regions: ${REGIONS.join(', ')}`);
  console.log('');

  const now = new Date();
  const editions: Array<{
    region: string;
    periodType: string;
    periodStart: string;
    periodEnd: string;
    kind: string;
  }> = [];

  // === Monthly editions ===
  for (let i = 0; i <= MONTHS_BACK; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = d.toISOString().split('T')[0];
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
    const isCurrent = i === 0;

    for (const region of REGIONS) {
      if (isCurrent) {
        editions.push({ region, periodType: 'monthly', periodStart: start, periodEnd: end, kind: 'rolling' });
      } else {
        editions.push({ region, periodType: 'monthly', periodStart: start, periodEnd: end, kind: 'sealed' });
      }
    }
  }

  // === Weekly editions ===
  // Find this week's Monday
  const todayDow = now.getDay() || 7; // 1=Mon ... 7=Sun
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - (todayDow - 1));
  thisMonday.setHours(0, 0, 0, 0);

  for (let i = 0; i <= WEEKS_BACK; i++) {
    const weekStart = new Date(thisMonday);
    weekStart.setDate(thisMonday.getDate() - (i * 7));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    const start = weekStart.toISOString().split('T')[0];
    const end = weekEnd.toISOString().split('T')[0];
    const isCurrent = i === 0;

    for (const region of REGIONS) {
      if (isCurrent) {
        editions.push({ region, periodType: 'weekly', periodStart: start, periodEnd: end, kind: 'rolling' });
      } else {
        editions.push({ region, periodType: 'weekly', periodStart: start, periodEnd: end, kind: 'sealed' });
      }
    }
  }

  console.log(`Total editions to generate: ${editions.length}`);
  console.log('');

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const ed of editions) {
    const label = `${ed.region}/${ed.periodType}/${ed.kind}: ${ed.periodStart}→${ed.periodEnd}`;

    if (DRY_RUN) {
      console.log(`[DRY] ${label}`);
      succeeded += 1;
      continue;
    }

    try {
      const result = await briefService.generateEditionRevision({
        region: ed.region as 'global' | 'turkey',
        periodType: ed.periodType as 'monthly' | 'weekly',
        periodStart: ed.periodStart,
        periodEnd: ed.periodEnd,
        kind: ed.kind as 'rolling' | 'sealed',
      });

      if (result.wasSkipped) {
        console.log(`[SKIP] ${label} — data unchanged`);
        skipped += 1;
      } else {
        console.log(`[OK]   ${label} — rev ${result.revision}`);
        succeeded += 1;
      }
    } catch (err) {
      console.error(`[FAIL] ${label} — ${(err as Error).message}`);
      failed += 1;
    }
  }

  console.log('');
  console.log(`=== Backfill complete: ${succeeded} succeeded, ${skipped} skipped, ${failed} failed ===`);

  await pool.end();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
