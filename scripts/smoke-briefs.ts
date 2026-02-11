#!/usr/bin/env tsx
/**
 * Smoke test: generate 4 brief combos and validate each snapshot.
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/smoke-briefs.ts
 *
 * Exits non-zero if any validation fails (hard errors only).
 */

import { Pool } from 'pg';
import { makeBriefService } from '../apps/api/src/services/brief';
import { validateBriefSnapshot } from '../apps/api/src/services/brief-validation';

interface Combo {
  label: string;
  region: 'global' | 'turkey';
  periodType: 'monthly' | 'weekly';
  kind: 'rolling' | 'sealed';
}

function currentMonthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function currentMonthEnd(): string {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return last.toISOString().split('T')[0];
}

function currentWeekStart(): string {
  const now = new Date();
  const day = now.getDay() || 7; // Monday = 1
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  return monday.toISOString().split('T')[0];
}

function currentWeekEnd(): string {
  const start = new Date(currentWeekStart());
  start.setDate(start.getDate() + 6);
  return start.toISOString().split('T')[0];
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const briefService = makeBriefService(pool);

  const combos: Combo[] = [
    { label: 'global monthly rolling', region: 'global', periodType: 'monthly', kind: 'rolling' },
    { label: 'global weekly rolling', region: 'global', periodType: 'weekly', kind: 'rolling' },
    { label: 'turkey monthly rolling', region: 'turkey', periodType: 'monthly', kind: 'rolling' },
    { label: 'turkey weekly rolling', region: 'turkey', periodType: 'weekly', kind: 'rolling' },
  ];

  let failures = 0;

  for (const combo of combos) {
    const periodStart = combo.periodType === 'monthly' ? currentMonthStart() : currentWeekStart();
    const periodEnd = combo.periodType === 'monthly' ? currentMonthEnd() : currentWeekEnd();

    console.log(`\n--- ${combo.label} ---`);
    console.log(`  period: ${periodStart} → ${periodEnd}`);

    try {
      const result = await briefService.generateEditionRevision({
        region: combo.region,
        periodType: combo.periodType,
        periodStart,
        periodEnd,
        kind: combo.kind,
      });

      console.log(`  edition: ${result.editionId}`);
      console.log(`  revision: ${result.revision} (skipped=${result.wasSkipped})`);
      console.log(`  inputHash: ${result.inputHash.slice(0, 12)}...`);
      console.log(`  signalsHash: ${result.signalsHash.slice(0, 12)}...`);

      // Fetch and validate snapshot
      const snapshot = await briefService.getEditionBrief({ editionId: result.editionId });
      if (!snapshot) {
        console.log(`  FAIL: snapshot is null`);
        failures++;
        continue;
      }

      const validation = validateBriefSnapshot(snapshot);
      if (validation.valid) {
        console.log(`  PASS (${validation.errors.length} warnings)`);
      } else {
        console.log(`  FAIL: ${validation.errors.filter(e => !e.startsWith('warning:')).join(', ')}`);
        failures++;
      }
      if (validation.errors.length > 0) {
        for (const err of validation.errors) {
          console.log(`    - ${err}`);
        }
      }
    } catch (err) {
      console.log(`  ERROR: ${(err as Error).message}`);
      failures++;
    }
  }

  console.log(`\n=== Summary: ${combos.length - failures}/${combos.length} passed ===`);
  await pool.end();
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
