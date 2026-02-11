/**
 * Dealbook Brief Service — Edition + Revision model
 *
 * Computes living brief snapshots from the database.
 * All metrics are deterministic (no LLM) — LLM is only used
 * for narrative sections (delta bullets, executive summary, etc).
 *
 * Two-table model:
 *   brief_editions  — one row per (region, period_type, period_start, period_end, kind)
 *   brief_revisions — each regeneration creates a new revision (only if input changed)
 */

import { Pool } from 'pg';
import crypto from 'crypto';
import { validateBriefSnapshot } from './brief-validation';

// Types are mirrored from packages/shared/src/types/brief-snapshot.ts
// (API doesn't have a workspace dep on shared — keep in sync manually)

interface BriefSnapshotMetrics {
  totalFunding: number;
  dealCount: number;
  avgDeal: number;
  medianDeal: number;
  largestDeal: { company: string; slug: string; amount: number; stage: string };
  genaiAdoptionRate: number;
  analysisCount: number;
  topPatterns: Array<{ pattern: string; count: number; prevalencePct: number }>;
  stageMix: Array<{ stage: string; amount: number; deals: number; pct: number }>;
}

interface BriefSnapshotDeltas {
  totalFunding: { value: number; pct: number } | null;
  dealCount: { value: number; pct: number } | null;
  avgDeal: { value: number; pct: number } | null;
  genaiAdoptionRate: { ppChange: number } | null;
  patternShifts: Array<{ pattern: string; prevPct: number; currPct: number; deltaPp: number }>;
  stageShifts: Array<{ stage: string; prevPct: number; currPct: number; deltaPp: number }>;
}

interface BriefNewsContext {
  clusters: Array<{
    id: string; title: string; summary: string; storyType: string;
    publishedAt: string; linkedStartupSlugs: string[]; rankScore: number;
  }>;
  topEntities: Array<{ name: string; factCount: number; latestFact: string }>;
}

interface SignalRef {
  clusterId: string;
  title: string;
  summary: string;
  storyType: string;
  builderTakeaway: string;
  signalScore: number;
  linkedSlugs: string[];
  publishedAt: string;
}

export interface BuilderActionRef {
  refType: 'signal' | 'pattern' | 'company';
  refId: string;
  label: string;
  url: string;
}

interface BuilderAction {
  action: string;
  rationale: string;
  refs: BuilderActionRef[];
}

export interface BriefSnapshot {
  id: string;
  editionId?: string;
  region: 'global' | 'turkey';
  periodType: 'monthly' | 'weekly';
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  kind?: 'rolling' | 'sealed';
  revisionNumber: number;
  generatedAt: string;
  metrics: BriefSnapshotMetrics;
  prevPeriod: BriefSnapshotMetrics | null;
  deltas: BriefSnapshotDeltas | null;
  revisionDeltas: BriefSnapshotDeltas | null;
  prevPeriodBounds: { periodStart: string; periodEnd: string; mtdAligned: boolean } | null;
  newsContext: BriefNewsContext | null;
  topSignals: SignalRef[];
  deltaBullets: string[];
  revisionDeltaBullets: string[];
  executiveSummary: string;
  theme: { name: string; summaryBullets: string[] };
  builderLessons: Array<{ title: string; text: string; howToApply?: string }>;
  whatWatching: string[];
  builderActions: BuilderAction[];
  patternLandscape: Array<{ pattern: string; prevalencePct: number; startupCount: number; signal: string }>;
  fundingByStage: Array<{ stage: string; amount: number; pct: number; deals: number }>;
  topDeals: Array<{ rank: number; company: string; slug: string; amount: number; stage: string; location: string }>;
  geography: Array<{ region: string; deals: number; totalFunding: number; avgDeal: number }>;
  investors: {
    mostActive: Array<{ name: string; deals: number; totalDeployed: number }>;
    megaCheckWriters: Array<{ name: string; singleInvestment: number; company: string }>;
  };
  spotlight?: {
    company: string; slug: string; amount: number; stage: string; location: string;
    whyThisMatters: string; buildPatterns: string[]; risk: string; builderTakeaway: string;
  };
  methodology: { bullets: string[] };
  status: 'draft' | 'ready' | 'sealed';
}

interface BriefEditionSummary {
  editionId: string;
  region: 'global' | 'turkey';
  periodType: 'monthly' | 'weekly';
  periodKey: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  kind: 'rolling' | 'sealed';
  revisionNumber: number;
  generatedAt: string;
  dealCount: number;
  totalFunding: number;
  status: 'ready' | 'sealed';
}

// ============================================================================
// Types
// ============================================================================

interface PeriodBounds {
  periodKey: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;
  periodLabel: string;
  prevPeriodKey: string;
  prevPeriodStart: string;
  prevPeriodEnd: string;
}

interface GenerateEditionParams {
  region: 'global' | 'turkey';
  periodType: 'monthly' | 'weekly';
  periodStart: string;  // YYYY-MM-DD
  periodEnd: string;    // YYYY-MM-DD
  kind: 'rolling' | 'sealed';
  force?: boolean;
}

interface GenerateEditionResult {
  editionId: string;
  revisionId: string;
  revision: number;
  wasSkipped: boolean;
  inputHash: string;
  signalsHash: string;
  validationErrors?: string[];
}

const PROMPT_VERSION = 'brief-v2';

/** Recursively sort object keys for stable JSON serialization */
function sortKeysDeep(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortKeysDeep);
  const sorted: Record<string, any> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeysDeep(obj[key]);
  }
  return sorted;
}

// ============================================================================
// Factory
// ============================================================================

export function makeBriefService(pool: Pool) {
  // --------------------------------------------------------------------------
  // Period helpers
  // --------------------------------------------------------------------------

  function resolvePeriodBounds(
    periodType: 'monthly' | 'weekly',
    periodKey?: string,
    mtdAlign?: { periodEnd: string },
  ): PeriodBounds & { mtdAligned: boolean } {
    const now = new Date();

    if (periodType === 'monthly') {
      const key = periodKey || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const [year, month] = key.split('-').map(Number);
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0); // last day of month
      const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === month;
      const monthName = start.toLocaleString('en-US', { month: 'long' });
      const label = `${monthName} ${year}${isCurrentMonth ? ' (MTD)' : ''}`;

      // Previous month
      const prevDate = new Date(year, month - 2, 1);
      const prevKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

      let prevEnd: Date;
      let mtdAligned = false;

      if (mtdAlign) {
        // MTD-aligned: match day count into previous month
        const currentEnd = new Date(mtdAlign.periodEnd);
        const dayCount = Math.ceil((currentEnd.getTime() - start.getTime()) / 86400000) + 1;
        const prevLastDay = new Date(year, month - 1, 0).getDate(); // last day of prev month
        const alignedDay = Math.min(dayCount, prevLastDay);
        prevEnd = new Date(prevDate.getFullYear(), prevDate.getMonth(), alignedDay);
        mtdAligned = true;
      } else {
        prevEnd = new Date(year, month - 1, 0);
      }

      return {
        periodKey: key,
        periodStart: fmt(start),
        periodEnd: fmt(end),
        periodLabel: label,
        prevPeriodKey: prevKey,
        prevPeriodStart: fmt(prevDate),
        prevPeriodEnd: fmt(prevEnd),
        mtdAligned,
      };
    }

    // Weekly
    const key = periodKey || currentISOWeek(now);
    const weekStart = isoWeekToDate(key);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const label = `Week of ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

    const prevStart = new Date(weekStart);
    prevStart.setDate(prevStart.getDate() - 7);
    const prevEnd = new Date(prevStart);
    prevEnd.setDate(prevEnd.getDate() + 6);
    const prevKey = currentISOWeek(prevStart);

    return {
      periodKey: key,
      periodStart: fmt(weekStart),
      periodEnd: fmt(weekEnd),
      periodLabel: label,
      prevPeriodKey: prevKey,
      prevPeriodStart: fmt(prevStart),
      prevPeriodEnd: fmt(prevEnd),
      mtdAligned: false,
    };
  }

  function fmt(d: Date): string {
    return d.toISOString().split('T')[0];
  }

  function currentISOWeek(d: Date): string {
    const tmp = new Date(d.getTime());
    tmp.setHours(0, 0, 0, 0);
    tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
    const week1 = new Date(tmp.getFullYear(), 0, 4);
    const weekNum = 1 + Math.round(((tmp.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
    return `${tmp.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  }

  function isoWeekToDate(weekKey: string): Date {
    const [yearStr, weekStr] = weekKey.split('-W');
    const year = parseInt(yearStr, 10);
    const week = parseInt(weekStr, 10);
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
    return monday;
  }

  /** Derive period key (YYYY-MM or YYYY-Wnn) from dates + type */
  function derivePeriodKey(periodType: string, periodStart: string): string {
    if (periodType === 'monthly') {
      return periodStart.slice(0, 7); // "2026-02-01" → "2026-02"
    }
    return currentISOWeek(new Date(periodStart));
  }

  /** Derive human-readable label from dates + type */
  function derivePeriodLabel(periodType: string, periodStart: string, periodEnd: string, kind: string): string {
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    const now = new Date();

    if (periodType === 'monthly') {
      const monthName = start.toLocaleString('en-US', { month: 'long' });
      const year = start.getFullYear();
      if (kind === 'rolling' && now >= start && now <= end) {
        return `${monthName} ${year} (MTD)`;
      }
      return `${monthName} ${year}`;
    }

    // Weekly
    const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `Week of ${startStr}–${endStr}`;
  }

  // --------------------------------------------------------------------------
  // Compute metrics for a given period
  // --------------------------------------------------------------------------

  async function computeMetrics(region: string, periodKey: string, periodType: string, periodStart: string, periodEnd: string): Promise<BriefSnapshotMetrics> {
    // Funding aggregation
    const fundingResult = await pool.query(`
      SELECT
        COALESCE(SUM(fr.amount_usd), 0)::bigint AS total_funding,
        COUNT(*)::int AS deal_count,
        COALESCE(AVG(fr.amount_usd), 0)::bigint AS avg_deal,
        COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY fr.amount_usd), 0)::bigint AS median_deal
      FROM funding_rounds fr
      INNER JOIN startups s ON fr.startup_id = s.id
      WHERE s.dataset_region = $1
        AND s.period = $2
        AND fr.amount_usd > 0
    `, [region, periodKey]);

    const funding = fundingResult.rows[0] || {};

    // Largest deal
    const largestResult = await pool.query(`
      SELECT s.name, COALESCE(s.slug, '') AS slug, fr.amount_usd, fr.round_type AS stage
      FROM funding_rounds fr
      INNER JOIN startups s ON fr.startup_id = s.id
      WHERE s.dataset_region = $1 AND s.period = $2 AND fr.amount_usd > 0
      ORDER BY fr.amount_usd DESC NULLS LAST
      LIMIT 1
    `, [region, periodKey]);

    const largest = largestResult.rows[0];

    // GenAI adoption
    const genaiResult = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE s.uses_genai = true)::int AS genai_count,
        COUNT(*) FILTER (WHERE s.analysis_data IS NOT NULL)::int AS analysis_count
      FROM startups s
      WHERE s.dataset_region = $1 AND s.period = $2
    `, [region, periodKey]);

    const genai = genaiResult.rows[0] || {};
    const totalStartups = parseInt(genai.total) || 0;
    const genaiCount = parseInt(genai.genai_count) || 0;
    const analysisCount = parseInt(genai.analysis_count) || 0;

    // Top patterns from analysis_data->'build_patterns'
    const patternsResult = await pool.query(`
      SELECT p.name, COUNT(*)::int AS cnt
      FROM startups s,
        LATERAL jsonb_array_elements(s.analysis_data->'build_patterns') AS bp,
        LATERAL jsonb_to_record(bp) AS p(name text)
      WHERE s.dataset_region = $1 AND s.period = $2
        AND s.analysis_data IS NOT NULL
        AND jsonb_typeof(s.analysis_data->'build_patterns') = 'array'
      GROUP BY p.name
      ORDER BY cnt DESC
      LIMIT 10
    `, [region, periodKey]);

    const patterns = patternsResult.rows.map(r => ({
      pattern: r.name,
      count: parseInt(r.cnt),
      prevalencePct: analysisCount > 0 ? Math.round((parseInt(r.cnt) / analysisCount) * 100) : 0,
    }));

    // Stage mix
    const stageResult = await pool.query(`
      SELECT
        COALESCE(fr.round_type, 'Unknown') AS stage,
        SUM(fr.amount_usd)::bigint AS amount,
        COUNT(*)::int AS deals
      FROM funding_rounds fr
      INNER JOIN startups s ON fr.startup_id = s.id
      WHERE s.dataset_region = $1 AND s.period = $2 AND fr.amount_usd > 0
      GROUP BY fr.round_type
      ORDER BY amount DESC
    `, [region, periodKey]);

    const totalFunding = parseInt(funding.total_funding) || 0;
    const stageMix = stageResult.rows.map(r => ({
      stage: r.stage,
      amount: parseInt(r.amount) || 0,
      deals: parseInt(r.deals) || 0,
      pct: totalFunding > 0 ? Math.round((parseInt(r.amount) / totalFunding) * 100) : 0,
    }));

    return {
      totalFunding,
      dealCount: parseInt(funding.deal_count) || 0,
      avgDeal: parseInt(funding.avg_deal) || 0,
      medianDeal: parseInt(funding.median_deal) || 0,
      largestDeal: largest
        ? { company: largest.name, slug: largest.slug, amount: parseInt(largest.amount_usd) || 0, stage: largest.stage || 'Unknown' }
        : { company: 'N/A', slug: '', amount: 0, stage: 'Unknown' },
      genaiAdoptionRate: totalStartups > 0 ? Math.round((genaiCount / totalStartups) * 100) : 0,
      analysisCount,
      topPatterns: patterns,
      stageMix,
    };
  }

  // --------------------------------------------------------------------------
  // Compute deltas between current and previous period
  // --------------------------------------------------------------------------

  function computeDeltas(current: BriefSnapshotMetrics, prev: BriefSnapshotMetrics | null): BriefSnapshotDeltas | null {
    if (!prev || prev.dealCount === 0) return null;

    function pctChange(curr: number, p: number): { value: number; pct: number } | null {
      if (p === 0) return curr !== 0 ? { value: curr, pct: 100 } : null;
      return { value: curr - p, pct: Math.round(((curr - p) / p) * 100) };
    }

    const patternMap = new Map<string, number>(current.topPatterns.map(p => [p.pattern, p.prevalencePct]));
    const prevPatternMap = new Map<string, number>(prev.topPatterns.map(p => [p.pattern, p.prevalencePct]));
    const allPatterns = new Set([...patternMap.keys(), ...prevPatternMap.keys()]);
    const patternShifts = Array.from(allPatterns)
      .map((pattern: string) => ({
        pattern,
        prevPct: prevPatternMap.get(pattern) || 0,
        currPct: patternMap.get(pattern) || 0,
        deltaPp: (patternMap.get(pattern) || 0) - (prevPatternMap.get(pattern) || 0),
      }))
      .filter(s => Math.abs(s.deltaPp) >= 3)
      .sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp))
      .slice(0, 5);

    const stageMap = new Map<string, number>(current.stageMix.map(s => [s.stage, s.pct]));
    const prevStageMap = new Map<string, number>(prev.stageMix.map(s => [s.stage, s.pct]));
    const allStages = new Set([...stageMap.keys(), ...prevStageMap.keys()]);
    const stageShifts = Array.from(allStages)
      .map((stage: string) => ({
        stage,
        prevPct: prevStageMap.get(stage) || 0,
        currPct: stageMap.get(stage) || 0,
        deltaPp: (stageMap.get(stage) || 0) - (prevStageMap.get(stage) || 0),
      }))
      .filter(s => Math.abs(s.deltaPp) >= 3)
      .sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp))
      .slice(0, 5);

    return {
      totalFunding: pctChange(current.totalFunding, prev.totalFunding),
      dealCount: pctChange(current.dealCount, prev.dealCount),
      avgDeal: pctChange(current.avgDeal, prev.avgDeal),
      genaiAdoptionRate: prev.genaiAdoptionRate !== undefined
        ? { ppChange: current.genaiAdoptionRate - prev.genaiAdoptionRate }
        : null,
      patternShifts,
      stageShifts,
    };
  }

  // --------------------------------------------------------------------------
  // Top deals
  // --------------------------------------------------------------------------

  async function computeTopDeals(region: string, periodKey: string, limit = 10): Promise<BriefSnapshot['topDeals']> {
    const result = await pool.query(`
      SELECT
        s.name AS company,
        COALESCE(s.slug, '') AS slug,
        fr.amount_usd AS amount,
        fr.round_type AS stage,
        COALESCE(s.headquarters_city || ', ' || s.headquarters_country, s.headquarters_country, '') AS location
      FROM funding_rounds fr
      INNER JOIN startups s ON fr.startup_id = s.id
      WHERE s.dataset_region = $1 AND s.period = $2 AND fr.amount_usd > 0
      ORDER BY fr.amount_usd DESC NULLS LAST
      LIMIT $3
    `, [region, periodKey, limit]);

    return result.rows.map((r, i) => ({
      rank: i + 1,
      company: r.company,
      slug: r.slug,
      amount: parseInt(r.amount_usd) || 0,
      stage: r.stage || 'Unknown',
      location: r.location || '',
    }));
  }

  // --------------------------------------------------------------------------
  // Geography
  // --------------------------------------------------------------------------

  async function computeGeography(region: string, periodKey: string): Promise<BriefSnapshot['geography']> {
    const result = await pool.query(`
      SELECT
        COALESCE(s.continent, 'Unknown') AS region,
        COUNT(*)::int AS deals,
        COALESCE(SUM(fr.amount_usd), 0)::bigint AS total_funding,
        COALESCE(AVG(fr.amount_usd), 0)::bigint AS avg_deal
      FROM funding_rounds fr
      INNER JOIN startups s ON fr.startup_id = s.id
      WHERE s.dataset_region = $1 AND s.period = $2 AND fr.amount_usd > 0
      GROUP BY s.continent
      ORDER BY total_funding DESC
    `, [region, periodKey]);

    return result.rows.map(r => ({
      region: r.region,
      deals: parseInt(r.deals) || 0,
      totalFunding: parseInt(r.total_funding) || 0,
      avgDeal: parseInt(r.avg_deal) || 0,
    }));
  }

  // --------------------------------------------------------------------------
  // Investors
  // --------------------------------------------------------------------------

  async function computeInvestors(region: string, periodKey: string): Promise<BriefSnapshot['investors']> {
    // Most active (by deal count)
    const activeResult = await pool.query(`
      SELECT
        i.name,
        COUNT(DISTINCT inv.funding_round_id)::int AS deals,
        COALESCE(SUM(fr.amount_usd), 0)::bigint AS total_deployed
      FROM investments inv
      INNER JOIN investors i ON inv.investor_id = i.id
      INNER JOIN funding_rounds fr ON inv.funding_round_id = fr.id
      INNER JOIN startups s ON fr.startup_id = s.id
      WHERE s.dataset_region = $1 AND s.period = $2
      GROUP BY i.name
      HAVING COUNT(DISTINCT inv.funding_round_id) >= 2
      ORDER BY deals DESC, total_deployed DESC
      LIMIT 10
    `, [region, periodKey]);

    // Mega-check writers (single largest investment)
    const megaResult = await pool.query(`
      SELECT
        i.name,
        fr.amount_usd AS single_investment,
        s.name AS company
      FROM investments inv
      INNER JOIN investors i ON inv.investor_id = i.id
      INNER JOIN funding_rounds fr ON inv.funding_round_id = fr.id
      INNER JOIN startups s ON fr.startup_id = s.id
      WHERE s.dataset_region = $1 AND s.period = $2 AND fr.amount_usd > 0
      ORDER BY fr.amount_usd DESC
      LIMIT 5
    `, [region, periodKey]);

    return {
      mostActive: activeResult.rows.map(r => ({
        name: r.name,
        deals: parseInt(r.deals) || 0,
        totalDeployed: parseInt(r.total_deployed) || 0,
      })),
      megaCheckWriters: megaResult.rows.map(r => ({
        name: r.name,
        singleInvestment: parseInt(r.single_investment) || 0,
        company: r.company,
      })),
    };
  }

  // --------------------------------------------------------------------------
  // Pattern landscape (for display — with signal descriptions)
  // --------------------------------------------------------------------------

  async function computePatternLandscape(region: string, periodKey: string): Promise<BriefSnapshot['patternLandscape']> {
    const result = await pool.query(`
      SELECT p.name, COUNT(*)::int AS cnt
      FROM startups s,
        LATERAL jsonb_array_elements(s.analysis_data->'build_patterns') AS bp,
        LATERAL jsonb_to_record(bp) AS p(name text)
      WHERE s.dataset_region = $1 AND s.period = $2
        AND s.analysis_data IS NOT NULL
        AND jsonb_typeof(s.analysis_data->'build_patterns') = 'array'
      GROUP BY p.name
      ORDER BY cnt DESC
      LIMIT 10
    `, [region, periodKey]);

    // Get total analyzed for percentages
    const totalResult = await pool.query(`
      SELECT COUNT(*)::int AS total
      FROM startups s
      WHERE s.dataset_region = $1 AND s.period = $2
        AND s.analysis_data IS NOT NULL
    `, [region, periodKey]);

    const total = parseInt(totalResult.rows[0]?.total) || 1;

    return result.rows.map(r => {
      const cnt = parseInt(r.cnt);
      const pct = Math.round((cnt / total) * 100);
      return {
        pattern: r.name,
        prevalencePct: pct,
        startupCount: cnt,
        signal: getPatternSignal(r.name, pct),
      };
    });
  }

  function getPatternSignal(pattern: string, pct: number): string {
    if (pct >= 50) return `Dominant pattern — adopted by ${pct}% of startups`;
    if (pct >= 30) return `Strong adoption at ${pct}% — increasingly table stakes`;
    if (pct >= 15) return `Emerging pattern at ${pct}% — early adopter advantage`;
    return `Niche at ${pct}% — differentiation opportunity`;
  }

  // --------------------------------------------------------------------------
  // Spotlight (highest-funded startup with analysis)
  // --------------------------------------------------------------------------

  async function computeSpotlight(region: string, periodKey: string): Promise<BriefSnapshot['spotlight'] | undefined> {
    const result = await pool.query(`
      SELECT
        s.name AS company,
        COALESCE(s.slug, '') AS slug,
        fr.amount_usd AS amount,
        fr.round_type AS stage,
        COALESCE(s.headquarters_city || ', ' || s.headquarters_country, s.headquarters_country, '') AS location,
        s.analysis_data
      FROM funding_rounds fr
      INNER JOIN startups s ON fr.startup_id = s.id
      WHERE s.dataset_region = $1 AND s.period = $2
        AND fr.amount_usd > 0
        AND s.analysis_data IS NOT NULL
      ORDER BY fr.amount_usd DESC
      LIMIT 1
    `, [region, periodKey]);

    const row = result.rows[0];
    if (!row) return undefined;

    const analysis = row.analysis_data as Record<string, any> | null;
    const patterns = Array.isArray(analysis?.build_patterns)
      ? analysis!.build_patterns.map((p: any) => p.name || p.pattern_name).filter(Boolean).slice(0, 4)
      : [];

    return {
      company: row.company,
      slug: row.slug,
      amount: parseInt(row.amount_usd) || 0,
      stage: row.stage || 'Unknown',
      location: row.location || '',
      whyThisMatters: analysis?.contrarian_analysis?.honest_take || `${row.company} secured ${formatM(parseInt(row.amount_usd))} in ${row.stage || 'funding'}, making it the largest deal this period.`,
      buildPatterns: patterns,
      risk: analysis?.contrarian_analysis?.bull_case_flaw || 'Execution risk in a competitive market.',
      builderTakeaway: analysis?.builder_takeaways?.[0]?.insight || `Watch how ${row.company} scales its core technology advantage.`,
    };
  }

  function formatM(usd: number): string {
    if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(1)}B`;
    if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(0)}M`;
    if (usd >= 1_000) return `$${(usd / 1_000).toFixed(0)}K`;
    return `$${usd}`;
  }

  // --------------------------------------------------------------------------
  // News context (linked via entity facts)
  // --------------------------------------------------------------------------

  async function computeNewsContext(region: string, periodKey: string): Promise<BriefNewsContext | null> {
    try {
      // Get startup IDs for this period
      const startupIdsResult = await pool.query(`
        SELECT id FROM startups
        WHERE dataset_region = $1 AND period = $2
      `, [region, periodKey]);

      if (startupIdsResult.rows.length === 0) return null;

      const ids = startupIdsResult.rows.map(r => r.id);

      // Get news clusters linked to these startups via entity facts
      const clustersResult = await pool.query(`
        SELECT DISTINCT ON (nc.id)
          nc.id::text,
          nc.title,
          nc.summary,
          COALESCE(nc.llm_story_type, nc.story_type, 'general') AS story_type,
          nc.published_at,
          nc.rank_score,
          array_agg(DISTINCT s.slug) FILTER (WHERE s.slug IS NOT NULL) AS linked_slugs
        FROM news_entity_facts nef
        INNER JOIN news_clusters nc ON nef.source_cluster_id = nc.id
        INNER JOIN startups s ON nef.linked_startup_id = s.id
        WHERE nef.linked_startup_id = ANY($1::uuid[])
          AND nef.is_current = true
          AND nc.published_at > NOW() - INTERVAL '30 days'
        GROUP BY nc.id, nc.title, nc.summary,
                 nc.llm_story_type, nc.story_type, nc.published_at, nc.rank_score
        ORDER BY nc.id, nc.rank_score DESC
        LIMIT 10
      `, [ids]);

      // Top entities
      const entitiesResult = await pool.query(`
        SELECT
          nef.entity_name AS name,
          COUNT(*)::int AS fact_count,
          MAX(nef.extracted_value) AS latest_fact
        FROM news_entity_facts nef
        WHERE nef.linked_startup_id = ANY($1::uuid[])
          AND nef.is_current = true
        GROUP BY nef.entity_name
        ORDER BY fact_count DESC
        LIMIT 5
      `, [ids]);

      return {
        clusters: clustersResult.rows.map(r => ({
          id: r.id,
          title: r.title || '',
          summary: r.summary || '',
          storyType: r.story_type || 'general',
          publishedAt: r.published_at?.toISOString() || '',
          linkedStartupSlugs: r.linked_slugs || [],
          rankScore: parseFloat(r.rank_score) || 0,
        })),
        topEntities: entitiesResult.rows.map(r => ({
          name: r.name,
          factCount: parseInt(r.fact_count) || 0,
          latestFact: r.latest_fact || '',
        })),
      };
    } catch (err) {
      // News tables may not exist yet — graceful degradation
      console.warn('Brief: news context query failed (tables may not exist):', (err as Error).message);
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // Select top news signals for provenance
  // --------------------------------------------------------------------------

  async function selectTopSignals(
    region: string,
    periodKey: string,
  ): Promise<{ signals: SignalRef[]; meta: { candidateCount: number; selectedAt: string } }> {
    try {
      // Get startup IDs for this period
      const startupIdsResult = await pool.query(`
        SELECT id FROM startups
        WHERE dataset_region = $1 AND period = $2
      `, [region, periodKey]);

      if (startupIdsResult.rows.length === 0) {
        return { signals: [], meta: { candidateCount: 0, selectedAt: new Date().toISOString() } };
      }

      const ids = startupIdsResult.rows.map(r => r.id);

      // Two-part UNION: entity-linked clusters + high-score unlinked clusters
      const candidatesResult = await pool.query(`
        WITH linked AS (
          SELECT DISTINCT ON (nc.id)
            nc.id::text AS cluster_id,
            nc.title,
            nc.summary,
            COALESCE(nc.llm_story_type, nc.story_type, 'general') AS story_type,
            nc.builder_takeaway,
            nc.published_at,
            nc.llm_signal_score,
            nc.rank_score,
            nc.trust_score,
            nc.source_count,
            true AS has_entity_link,
            array_agg(DISTINCT s.slug) FILTER (WHERE s.slug IS NOT NULL) AS linked_slugs
          FROM news_entity_facts nef
          INNER JOIN news_clusters nc ON nef.source_cluster_id = nc.id
          INNER JOIN startups s ON nef.linked_startup_id = s.id
          WHERE nef.linked_startup_id = ANY($1::uuid[])
            AND nef.is_current = true
            AND nc.published_at > NOW() - INTERVAL '30 days'
            AND nc.builder_takeaway IS NOT NULL
          GROUP BY nc.id, nc.title, nc.summary, nc.llm_story_type, nc.story_type,
                   nc.builder_takeaway, nc.published_at, nc.llm_signal_score,
                   nc.rank_score, nc.trust_score, nc.source_count
        ),
        unlinked AS (
          SELECT
            nc.id::text AS cluster_id,
            nc.title,
            nc.summary,
            COALESCE(nc.llm_story_type, nc.story_type, 'general') AS story_type,
            nc.builder_takeaway,
            nc.published_at,
            nc.llm_signal_score,
            nc.rank_score,
            nc.trust_score,
            nc.source_count,
            false AS has_entity_link,
            ARRAY[]::text[] AS linked_slugs
          FROM news_clusters nc
          WHERE nc.region = $2
            AND nc.published_at > NOW() - INTERVAL '30 days'
            AND nc.builder_takeaway IS NOT NULL
            AND nc.id NOT IN (SELECT nc2.id::uuid FROM linked nc2)
          ORDER BY nc.llm_signal_score DESC NULLS LAST
          LIMIT 20
        ),
        combined AS (
          SELECT * FROM linked
          UNION ALL
          SELECT * FROM unlinked
        )
        SELECT *,
          (0.4 * COALESCE(llm_signal_score, 0)
           + 0.3 * COALESCE(rank_score, 0)
           + 0.2 * COALESCE(trust_score, 0)
           + 0.1 * LEAST(COALESCE(source_count, 1)::numeric / 5.0, 1.0)
          ) AS composite_score
        FROM combined
        ORDER BY has_entity_link DESC, composite_score DESC
        LIMIT 20
      `, [ids, region]);

      const candidates = candidatesResult.rows;

      // Diversity constraint: max 2 per story_type, select up to 8
      const signals: SignalRef[] = [];
      const storyTypeCounts = new Map<string, number>();

      for (const row of candidates) {
        if (signals.length >= 8) break;
        const st = row.story_type || 'general';
        const count = storyTypeCounts.get(st) || 0;
        if (count >= 2) continue;
        storyTypeCounts.set(st, count + 1);

        signals.push({
          clusterId: row.cluster_id,
          title: row.title || '',
          summary: (row.summary || '').split(/[.!?]\s/)[0] + '.',
          storyType: st,
          builderTakeaway: row.builder_takeaway || '',
          signalScore: parseFloat(row.composite_score) || 0,
          linkedSlugs: row.linked_slugs || [],
          publishedAt: row.published_at?.toISOString?.() || row.published_at || '',
        });
      }

      return {
        signals,
        meta: { candidateCount: candidates.length, selectedAt: new Date().toISOString() },
      };
    } catch (err) {
      console.warn('Brief: selectTopSignals failed (tables may not exist):', (err as Error).message);
      return { signals: [], meta: { candidateCount: 0, selectedAt: new Date().toISOString() } };
    }
  }

  // --------------------------------------------------------------------------
  // Draft builder actions (deterministic template engine)
  // --------------------------------------------------------------------------

  function draftBuilderActions(
    topSignals: SignalRef[],
    patternLandscape: BriefSnapshot['patternLandscape'],
    deltas: BriefSnapshotDeltas | null,
    revisionDeltas: BriefSnapshotDeltas | null,
    region: string,
  ): BuilderAction[] {
    const candidates: BuilderAction[] = [];

    function regionUrl(url: string): string {
      if (!region || region === 'global') return url;
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}region=${region}`;
    }

    function truncate(s: string, max: number): string {
      return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
    }

    // 1. Signal-driven actions (up to 3)
    const signalActions: BuilderAction[] = [];
    for (const signal of topSignals.slice(0, 5)) {
      if (signalActions.length >= 3) break;

      const st = (signal.storyType || '').toLowerCase();
      let actionText: string;
      let rationale: string;

      if (st === 'platform' || st === 'agents') {
        actionText = 'Instrument agent workflows with retries and eval baselines before scaling to production.';
        rationale = 'Agent reliability separates prototypes from production — eval-first unlocks safe iteration.';
      } else if (st === 'regulation' || st === 'policy') {
        actionText = 'Add audit logging and regional feature flags — compliance is becoming a product requirement.';
        rationale = 'Regulatory signals indicate new compliance surfaces that early movers can turn into trust advantages.';
      } else if (st === 'funding' || st === 'mega_round') {
        actionText = `Revisit your fundraise timeline — capital is concentrating in ${st} plays.`;
        rationale = 'Capital concentration shifts competitive dynamics; timing your raise matters more in clustered markets.';
      } else if (st === 'acquisition' || st === 'consolidation') {
        actionText = 'Map your competitive landscape — acqui-hire signals suggest consolidation in your vertical.';
        rationale = 'Consolidation waves compress timelines; knowing the acquirers helps you position or partner early.';
      } else if (st === 'product_launch') {
        actionText = `Benchmark against ${truncate(signal.title, 30)} — new entrants are resetting customer expectations.`;
        rationale = 'New product launches shift the baseline; benchmark early to avoid feature-gap surprises.';
      } else if (st === 'research' || st === 'benchmark') {
        actionText = 'Update your eval suite to include latest benchmarks — the bar just moved.';
        rationale = 'Benchmark shifts can invalidate your current positioning overnight; update evals proactively.';
      } else {
        actionText = `Monitor '${truncate(signal.title, 30)}' — this signal could impact your roadmap within 30 days.`;
        rationale = 'Early signal detection gives you a 2-4 week decision advantage over competitors.';
      }

      const refs: BuilderActionRef[] = [{
        refType: 'signal',
        refId: signal.clusterId,
        label: truncate(signal.title, 40),
        url: regionUrl(`/news?story=${signal.clusterId}`),
      }];

      if (signal.linkedSlugs && signal.linkedSlugs.length > 0) {
        refs.push({
          refType: 'company',
          refId: signal.linkedSlugs[0],
          label: signal.linkedSlugs[0],
          url: regionUrl(`/company/${signal.linkedSlugs[0]}`),
        });
      }

      signalActions.push({ action: actionText, rationale, refs });
    }
    candidates.push(...signalActions);

    // 2. Pattern-driven actions (up to 2)
    const allDeltas = deltas || revisionDeltas;
    const patternShiftMap = new Map<string, number>(
      (allDeltas?.patternShifts || []).map(s => [s.pattern, s.deltaPp]),
    );

    const patternActions: BuilderAction[] = [];
    for (const p of patternLandscape) {
      if (patternActions.length >= 2) break;

      const deltaPp = patternShiftMap.get(p.pattern);
      let actionText: string | null = null;
      let rationale = '';

      if (p.prevalencePct > 40) {
        actionText = `Adopt ${p.pattern} as table stakes — ${p.prevalencePct}% of funded startups already ship it.`;
        rationale = `At ${p.prevalencePct}% prevalence, not having ${p.pattern} is now a competitive disadvantage.`;
      } else if (deltaPp && deltaPp > 5) {
        actionText = `${p.pattern} prevalence jumped ${deltaPp}pp — evaluate whether this accelerates your time-to-market.`;
        rationale = `Rapid adoption shifts (+${deltaPp}pp) signal market validation; early adopters capture integration advantages.`;
      } else if (deltaPp && deltaPp < -5) {
        actionText = `${p.pattern} is declining (${deltaPp}pp) — consider migrating to emerging alternatives.`;
        rationale = 'Declining patterns signal ecosystem migration; reassess before lock-in costs rise.';
      }

      if (actionText) {
        patternActions.push({
          action: actionText,
          rationale,
          refs: [{
            refType: 'pattern',
            refId: p.pattern,
            label: p.pattern,
            url: regionUrl(`/signals?pattern=${encodeURIComponent(p.pattern)}`),
          }],
        });
      }
    }
    candidates.push(...patternActions);

    // 3. Delta-driven actions (up to 1)
    if (deltas) {
      let deltaAction: BuilderAction | null = null;
      const fundingPct = deltas.totalFunding?.pct;
      const dealPct = deltas.dealCount?.pct;

      if (fundingPct != null && fundingPct > 30) {
        deltaAction = {
          action: `Capital inflows surged ${fundingPct}% — accelerate your go-to-market before the window closes.`,
          rationale: 'Funding surges attract new entrants; speed-to-market becomes the primary moat.',
          refs: [{ refType: 'pattern', refId: 'dealflow', label: 'Dealbook', url: regionUrl('/dealbook') }],
        };
      } else if (fundingPct != null && fundingPct < -20) {
        deltaAction = {
          action: `Funding contracted ${Math.abs(fundingPct)}% — extend your runway and prioritize unit economics.`,
          rationale: 'Capital contraction rewards capital efficiency; unit economics become the investor pitch.',
          refs: [{ refType: 'pattern', refId: 'dealflow', label: 'Dealbook', url: regionUrl('/dealbook') }],
        };
      } else if (dealPct != null && dealPct > 25) {
        deltaAction = {
          action: `Deal velocity is up ${dealPct}% — more competition entering; differentiate now.`,
          rationale: 'Rising deal counts signal market entry acceleration; differentiation is your defense.',
          refs: [{ refType: 'pattern', refId: 'dealflow', label: 'Dealbook', url: regionUrl('/dealbook') }],
        };
      }

      if (deltaAction) candidates.push(deltaAction);
    }

    // Deduplicate by primary ref (refs[0].refId)
    const seen = new Set<string>();
    const deduped: BuilderAction[] = [];
    for (const c of candidates) {
      const key = c.refs[0]?.refId || '';
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(c);
    }

    // Cap at 5, prefer signal → pattern → delta ordering (already in that order)
    return deduped.slice(0, 5);
  }

  // --------------------------------------------------------------------------
  // LLM generation (optional)
  // --------------------------------------------------------------------------

  async function generateLLMSections(
    metrics: BriefSnapshotMetrics,
    deltas: BriefSnapshotDeltas | null,
    newsContext: BriefNewsContext | null,
    topSignals: SignalRef[],
    periodLabel: string,
    revisionDeltas?: BriefSnapshotDeltas | null,
    draftActions?: BuilderAction[],
  ): Promise<{
    deltaBullets: string[];
    revisionDeltaBullets: string[];
    executiveSummary: string;
    theme: { name: string; summaryBullets: string[] };
    builderLessons: Array<{ title: string; text: string; howToApply?: string }>;
    whatWatching: string[];
    builderActions: BuilderAction[];
  }> {
    // Try LLM generation via Azure OpenAI
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;

    if (!endpoint || !deployment) {
      console.log('Brief: LLM not configured, using template generation');
      return generateTemplateSections(metrics, deltas, periodLabel, revisionDeltas, draftActions);
    }

    try {
      const prompt = buildLLMPrompt(metrics, deltas, newsContext, topSignals, periodLabel, revisionDeltas, draftActions);

      // Build request — try API key first, fall back to managed identity
      const apiKey = process.env.AZURE_OPENAI_API_KEY;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };

      if (apiKey) {
        headers['api-key'] = apiKey;
      } else {
        // Use managed identity token
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const azIdentity = await import(/* webpackIgnore: true */ '@azure/identity' as string);
          const cred = new azIdentity.DefaultAzureCredential();
          const token = await cred.getToken('https://cognitiveservices.azure.com/.default');
          headers['Authorization'] = `Bearer ${token.token}`;
        } catch {
          console.log('Brief: Cannot get Azure credential, using template generation');
          return generateTemplateSections(metrics, deltas, periodLabel, revisionDeltas);
        }
      }

      const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=2024-12-01-preview`;

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You are a startup intelligence analyst. Output strict JSON only, no markdown.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_completion_tokens: 1500,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        console.warn(`Brief: LLM call failed (${response.status}), using template`);
        return generateTemplateSections(metrics, deltas, periodLabel, revisionDeltas, draftActions);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        return generateTemplateSections(metrics, deltas, periodLabel, revisionDeltas, draftActions);
      }

      const parsed = JSON.parse(content);

      // Overlay LLM-polished action text onto draft actions (preserve refs)
      let builderActions = draftActions || [];
      if (Array.isArray(parsed.builder_actions) && draftActions && draftActions.length > 0) {
        builderActions = draftActions.map((draft, i) => {
          const polished = parsed.builder_actions[i];
          if (typeof polished === 'string' && polished.length > 0) {
            return { ...draft, action: polished };
          }
          return draft;
        });
      }

      return {
        deltaBullets: Array.isArray(parsed.delta_bullets) ? parsed.delta_bullets.slice(0, 5) : [],
        revisionDeltaBullets: Array.isArray(parsed.revision_delta_bullets) ? parsed.revision_delta_bullets.slice(0, 3) : [],
        executiveSummary: typeof parsed.executive_summary === 'string' ? parsed.executive_summary : '',
        theme: parsed.theme && typeof parsed.theme.name === 'string'
          ? { name: parsed.theme.name, summaryBullets: Array.isArray(parsed.theme.summaryBullets) ? parsed.theme.summaryBullets : [] }
          : { name: 'AI Ecosystem Update', summaryBullets: [] },
        builderLessons: Array.isArray(parsed.builder_lessons)
          ? parsed.builder_lessons.map((l: any) => ({ title: l.title || '', text: l.text || '', howToApply: l.howToApply }))
          : [],
        whatWatching: Array.isArray(parsed.what_watching) ? parsed.what_watching.slice(0, 5) : [],
        builderActions,
      };
    } catch (err) {
      console.warn('Brief: LLM generation error:', (err as Error).message);
      return generateTemplateSections(metrics, deltas, periodLabel, revisionDeltas, draftActions);
    }
  }

  function buildLLMPrompt(
    metrics: BriefSnapshotMetrics,
    deltas: BriefSnapshotDeltas | null,
    newsContext: BriefNewsContext | null,
    topSignals: SignalRef[],
    periodLabel: string,
    revisionDeltas?: BriefSnapshotDeltas | null,
    draftActions?: BuilderAction[],
  ): string {
    let prompt = `Generate a brief intelligence analysis for "${periodLabel}".

Metrics:
- Total funding: $${(metrics.totalFunding / 1_000_000).toFixed(0)}M across ${metrics.dealCount} deals
- Average deal: $${(metrics.avgDeal / 1_000_000).toFixed(1)}M, Median: $${(metrics.medianDeal / 1_000_000).toFixed(1)}M
- Largest deal: ${metrics.largestDeal.company} at $${(metrics.largestDeal.amount / 1_000_000).toFixed(0)}M (${metrics.largestDeal.stage})
- GenAI adoption: ${metrics.genaiAdoptionRate}%
- Top patterns: ${metrics.topPatterns.slice(0, 5).map((p: BriefSnapshotMetrics['topPatterns'][number]) => `${p.pattern} (${p.prevalencePct}%)`).join(', ')}`;

    if (deltas) {
      prompt += `\n\nChanges vs prior period:`;
      if (deltas.totalFunding) prompt += `\n- Total funding: ${deltas.totalFunding.pct > 0 ? '+' : ''}${deltas.totalFunding.pct}%`;
      if (deltas.dealCount) prompt += `\n- Deal count: ${deltas.dealCount.pct > 0 ? '+' : ''}${deltas.dealCount.pct}%`;
      if (deltas.avgDeal) prompt += `\n- Average deal: ${deltas.avgDeal.pct > 0 ? '+' : ''}${deltas.avgDeal.pct}%`;
      if (deltas.genaiAdoptionRate) prompt += `\n- GenAI adoption: ${deltas.genaiAdoptionRate.ppChange > 0 ? '+' : ''}${deltas.genaiAdoptionRate.ppChange}pp`;
      if (deltas.patternShifts.length > 0) {
        prompt += `\n- Pattern shifts: ${deltas.patternShifts.map((s: BriefSnapshotDeltas['patternShifts'][number]) => `${s.pattern} ${s.deltaPp > 0 ? '+' : ''}${s.deltaPp}pp`).join(', ')}`;
      }
      if (deltas.stageShifts.length > 0) {
        prompt += `\n- Stage shifts: ${deltas.stageShifts.map((s: BriefSnapshotDeltas['stageShifts'][number]) => `${s.stage} ${s.deltaPp > 0 ? '+' : ''}${s.deltaPp}pp`).join(', ')}`;
      }
    }

    if (revisionDeltas) {
      prompt += `\n\nChanges since last update (revision-level):`;
      if (revisionDeltas.totalFunding) prompt += `\n- Funding: ${revisionDeltas.totalFunding.pct > 0 ? '+' : ''}${revisionDeltas.totalFunding.pct}%`;
      if (revisionDeltas.dealCount) prompt += `\n- Deals: ${revisionDeltas.dealCount.value > 0 ? '+' : ''}${revisionDeltas.dealCount.value}`;
      if (revisionDeltas.avgDeal) prompt += `\n- Avg deal: ${revisionDeltas.avgDeal.pct > 0 ? '+' : ''}${revisionDeltas.avgDeal.pct}%`;
    }

    if (newsContext && newsContext.clusters.length > 0) {
      prompt += `\n\nRecent news headlines linked to these startups:`;
      newsContext.clusters.slice(0, 5).forEach((c: BriefNewsContext['clusters'][number]) => {
        prompt += `\n- ${c.title} [${c.storyType}]`;
      });
    }

    if (topSignals && topSignals.length > 0) {
      prompt += `\n\nTop signals informing this brief:`;
      topSignals.slice(0, 5).forEach(s => {
        prompt += `\n- "${s.title}" [${s.storyType}]: ${s.builderTakeaway}`;
      });
      prompt += `\n(Reference these signals in executive_summary and builder_lessons where relevant.)`;
    }

    if (draftActions && draftActions.length > 0) {
      prompt += `\n\nDraft builder actions (rewrite to be crisper, 18-22 words, imperative voice, preserve meaning):`;
      draftActions.forEach((a, i) => {
        prompt += `\n${i + 1}. ${a.action}`;
      });
    }

    prompt += `

Output JSON with these exact keys:
{
  "delta_bullets": ["string (max 24 words each, reference specific numbers)", ...3-5 items],${revisionDeltas ? '\n  "revision_delta_bullets": ["string (max 20 words, what changed since last update)", ...1-3 items],' : ''}
  "executive_summary": "string (70-120 words, rephrase only — use provided numbers)",
  "theme": { "name": "string (2-4 words)", "summaryBullets": ["string", ...3-4 items] },
  "builder_lessons": [{ "title": "string", "text": "string", "howToApply": "string" }, ...2-3 items],
  "what_watching": ["string", ...3-5 items]${draftActions && draftActions.length > 0 ? `,\n  "builder_actions": ["string (rewritten action text, 18-22 words, imperative)", ...${draftActions.length} items]` : ''}
}

Rules:
- Delta bullets must reference at least one numeric delta from input. Can reference news headlines. Max 24 words per bullet.${revisionDeltas ? '\n- Revision delta bullets describe what changed since the last update — reference the revision-level deltas provided.' : ''}
- Executive summary: Rephrase only — use provided numbers. No fabricated statistics.
- Theme: Ground in pattern shifts and news trends.${draftActions && draftActions.length > 0 ? '\n- Builder actions: Rewrite each draft action to be crisper (18-22 words). Do NOT change meaning or add new claims.' : ''}
- NO fabricated numbers. If a delta is null, skip it.`;

    return prompt;
  }

  // --------------------------------------------------------------------------
  // Template fallback (no LLM)
  // --------------------------------------------------------------------------

  function generateTemplateSections(
    metrics: BriefSnapshotMetrics,
    deltas: BriefSnapshotDeltas | null,
    periodLabel: string,
    revisionDeltas?: BriefSnapshotDeltas | null,
    draftActions?: BuilderAction[],
  ) {
    const deltaBullets: string[] = [];
    if (deltas?.totalFunding) {
      deltaBullets.push(`Total funding ${deltas.totalFunding.pct > 0 ? 'rose' : 'fell'} ${Math.abs(deltas.totalFunding.pct)}% to ${formatM(metrics.totalFunding)} across ${metrics.dealCount} deals`);
    }
    if (deltas?.dealCount) {
      deltaBullets.push(`Deal count ${deltas.dealCount.pct > 0 ? 'increased' : 'decreased'} ${Math.abs(deltas.dealCount.pct)}% to ${metrics.dealCount} deals`);
    }
    if (deltas?.avgDeal) {
      deltaBullets.push(`Average deal size ${deltas.avgDeal.pct > 0 ? 'rose' : 'fell'} ${Math.abs(deltas.avgDeal.pct)}% to ${formatM(metrics.avgDeal)}`);
    }
    if (deltas?.genaiAdoptionRate && deltas.genaiAdoptionRate.ppChange !== 0) {
      deltaBullets.push(`GenAI adoption ${deltas.genaiAdoptionRate.ppChange > 0 ? 'rose' : 'fell'} ${Math.abs(deltas.genaiAdoptionRate.ppChange)}pp to ${metrics.genaiAdoptionRate}%`);
    }
    if (deltas?.patternShifts) {
      for (const s of deltas.patternShifts.slice(0, 2)) {
        deltaBullets.push(`${s.pattern} prevalence ${s.deltaPp > 0 ? 'rose' : 'fell'} ${Math.abs(s.deltaPp)}pp to ${s.currPct}%`);
      }
    }
    if (deltas?.stageShifts) {
      for (const s of deltas.stageShifts.slice(0, 2)) {
        deltaBullets.push(`${s.stage} share ${s.deltaPp > 0 ? 'rose' : 'fell'} ${Math.abs(s.deltaPp)}pp`);
      }
    }

    // Revision delta bullets
    const revisionDeltaBullets: string[] = [];
    if (revisionDeltas) {
      if (revisionDeltas.dealCount && revisionDeltas.dealCount.value !== 0) {
        revisionDeltaBullets.push(`${Math.abs(revisionDeltas.dealCount.value)} ${revisionDeltas.dealCount.value > 0 ? 'new' : 'fewer'} deal${Math.abs(revisionDeltas.dealCount.value) !== 1 ? 's' : ''} tracked since last update`);
      }
      if (revisionDeltas.totalFunding && revisionDeltas.totalFunding.pct !== 0) {
        revisionDeltaBullets.push(`Funding ${revisionDeltas.totalFunding.pct > 0 ? 'up' : 'down'} ${Math.abs(revisionDeltas.totalFunding.pct)}% vs previous revision`);
      }
    }

    const topPattern = metrics.topPatterns[0];
    const executiveSummary = `${periodLabel} saw ${formatM(metrics.totalFunding)} deployed across ${metrics.dealCount} deals. The average deal size was ${formatM(metrics.avgDeal)}, with ${metrics.largestDeal.company} leading at ${formatM(metrics.largestDeal.amount)}. GenAI adoption stands at ${metrics.genaiAdoptionRate}%.${topPattern ? ` ${topPattern.pattern} remains the dominant build pattern at ${topPattern.prevalencePct}% prevalence.` : ''}`;

    const theme = {
      name: topPattern ? `The ${topPattern.pattern} Era` : 'AI Ecosystem Update',
      summaryBullets: [
        `${metrics.dealCount} deals totaling ${formatM(metrics.totalFunding)} in funding`,
        `GenAI adoption at ${metrics.genaiAdoptionRate}% across analyzed startups`,
        topPattern ? `${topPattern.pattern} leads at ${topPattern.prevalencePct}% prevalence` : 'Diverse pattern adoption across the ecosystem',
        `Median deal size: ${formatM(metrics.medianDeal)}`,
      ],
    };

    const builderLessons = [
      {
        title: 'Follow the funding signals',
        text: `${formatM(metrics.totalFunding)} deployed this period suggests strong investor conviction in AI infrastructure plays.`,
        howToApply: 'Align your pitch with funded patterns — investors are validating these bets.',
      },
      {
        title: 'Pattern adoption matters',
        text: topPattern
          ? `${topPattern.pattern} at ${topPattern.prevalencePct}% adoption signals market readiness.`
          : 'Diverse patterns suggest the market is still exploring optimal architectures.',
        howToApply: 'Evaluate whether adopting leading patterns accelerates your time-to-market.',
      },
    ];

    const whatWatching = [
      'Monitoring deal flow velocity for early signals of market shifts',
      `Tracking ${topPattern?.pattern || 'emerging pattern'} adoption trajectory`,
      'Watching for new entrants challenging established players',
      'Observing geographic expansion of AI funding beyond traditional hubs',
    ];

    return { deltaBullets, revisionDeltaBullets, executiveSummary, theme, builderLessons, whatWatching, builderActions: draftActions || [] };
  }

  // --------------------------------------------------------------------------
  // Methodology
  // --------------------------------------------------------------------------

  function computeMethodology(model?: string, promptVersion?: string): BriefSnapshot['methodology'] {
    const bullets = [
      'Metrics derived from tracked funding rounds and startup profiles in the BuildAtlas database',
      'GenAI adoption determined by analysis pipeline examining company website, documentation, and product signals',
      'Pattern prevalence calculated across all startups with completed analysis for this period',
      'Top deals ranked by disclosed funding amount; undisclosed rounds excluded from aggregations',
      'Geography based on startup headquarters location; investor geography may differ',
      'Brief generated daily with incremental revision tracking',
    ];
    if (model) {
      bullets.push(`Generated using ${model} (prompt ${promptVersion || 'unknown'})`);
    }
    return { bullets };
  }

  // --------------------------------------------------------------------------
  // Signals hash — SHA-256 of sorted cluster IDs
  // --------------------------------------------------------------------------

  function computeSignalsHash(signals: SignalRef[]): string {
    const ids = signals.map(s => s.clusterId).sort();
    return crypto.createHash('sha256').update(JSON.stringify(ids)).digest('hex');
  }

  // --------------------------------------------------------------------------
  // Input hash — SHA-256 of deterministic inputs for change detection
  // --------------------------------------------------------------------------

  function computeInputHash(inputs: {
    region: string;
    periodType: string;
    periodStart: string;
    periodEnd: string;
    kind: string;
    metricsSnapshot: any;
    promptVersion: string;
    signalsHash: string;
  }): string {
    // Stable key ordering via recursive sort
    const sorted = JSON.stringify(sortKeysDeep(inputs));
    return crypto.createHash('sha256').update(sorted).digest('hex');
  }

  // --------------------------------------------------------------------------
  // Adapter: edition+revision row → BriefSnapshot (API response contract)
  // --------------------------------------------------------------------------

  function editionRevisionToSnapshot(edition: any, revision: any): BriefSnapshot {
    const content = revision.content_sections || {};
    const computed = revision.computed_sections || {};
    const metricsData = revision.metrics_snapshot || {};
    const periodKey = derivePeriodKey(edition.period_type, dateStr(edition.period_start));
    const periodLabel = derivePeriodLabel(
      edition.period_type, dateStr(edition.period_start),
      dateStr(edition.period_end), edition.kind,
    );

    // Parse deltas envelope — support both new envelope and legacy flat format
    const rawDeltas = revision.deltas_snapshot;
    let periodDeltas: BriefSnapshotDeltas | null = null;
    let revisionDeltas: BriefSnapshotDeltas | null = null;
    let prevPeriodBounds: { periodStart: string; periodEnd: string; mtdAligned: boolean } | null = null;

    if (rawDeltas && Object.keys(rawDeltas).length > 0) {
      if (rawDeltas.vsPrevPeriod !== undefined) {
        // New envelope format
        if (rawDeltas.vsPrevPeriod) {
          const { periodStart: ps, periodEnd: pe, mtdAligned, ...deltaFields } = rawDeltas.vsPrevPeriod;
          periodDeltas = deltaFields;
          prevPeriodBounds = ps ? { periodStart: ps, periodEnd: pe, mtdAligned: !!mtdAligned } : null;
        }
        if (rawDeltas.vsPrevRevision) {
          const { prevRevisionId, prevGeneratedAt, ...deltaFields } = rawDeltas.vsPrevRevision;
          revisionDeltas = deltaFields;
        }
      } else {
        // Legacy flat format — treat whole object as period deltas
        periodDeltas = rawDeltas;
      }
    }

    return {
      id: revision.id,
      editionId: edition.id,
      region: edition.region,
      periodType: edition.period_type,
      periodKey,
      periodStart: dateStr(edition.period_start),
      periodEnd: dateStr(edition.period_end),
      periodLabel,
      kind: edition.kind,
      revisionNumber: revision.revision,
      generatedAt: revision.generated_at instanceof Date ? revision.generated_at.toISOString() : revision.generated_at,

      metrics: metricsData.metrics || {},
      prevPeriod: metricsData.prevPeriod || null,
      deltas: periodDeltas,
      revisionDeltas,
      prevPeriodBounds,
      newsContext: computed.newsContext || null,
      topSignals: revision.top_signal_refs?.signals || [],

      deltaBullets: content.delta_bullets || [],
      revisionDeltaBullets: content.revision_delta_bullets || [],
      executiveSummary: content.executive_summary || '',
      theme: content.theme_title
        ? { name: content.theme_title, summaryBullets: content.theme_bullets || [] }
        : { name: '', summaryBullets: [] },
      builderLessons: Array.isArray(content.implications) ? content.implications : [],
      whatWatching: content.what_were_watching || [],
      builderActions: Array.isArray(content.builder_actions) ? content.builder_actions : [],

      patternLandscape: computed.patternLandscape || [],
      fundingByStage: computed.fundingByStage || [],
      topDeals: computed.topDeals || [],
      geography: computed.geography || [],
      investors: computed.investors || { mostActive: [], megaCheckWriters: [] },
      spotlight: computed.spotlight || undefined,
      methodology: computed.methodology || { bullets: [] },

      status: edition.kind === 'sealed' ? 'sealed' : 'ready',
    };
  }

  function dateStr(d: any): string {
    if (d instanceof Date) return d.toISOString().split('T')[0];
    if (typeof d === 'string') return d.split('T')[0];
    return String(d);
  }

  // ==========================================================================
  // Main: generateEditionRevision
  // ==========================================================================

  async function generateEditionRevision(params: GenerateEditionParams): Promise<GenerateEditionResult> {
    const { region, periodType, periodStart, periodEnd, kind, force } = params;
    const periodKey = derivePeriodKey(periodType, periodStart);
    const periodLabel = derivePeriodLabel(periodType, periodStart, periodEnd, kind);

    // Resolve previous period for deltas (MTD-aligned for rolling monthly)
    const bounds = resolvePeriodBounds(
      periodType, periodKey,
      kind === 'rolling' && periodType === 'monthly' ? { periodEnd } : undefined,
    );

    // 1. Compute all deterministic data in parallel
    const [metrics, prevMetrics, topDeals, geography, investorsData, patternLandscape, spotlight, newsContext, signalResult] = await Promise.all([
      computeMetrics(region, periodKey, periodType, periodStart, periodEnd),
      computeMetrics(region, bounds.prevPeriodKey, periodType, bounds.prevPeriodStart, bounds.prevPeriodEnd),
      computeTopDeals(region, periodKey),
      computeGeography(region, periodKey),
      computeInvestors(region, periodKey),
      computePatternLandscape(region, periodKey),
      computeSpotlight(region, periodKey),
      computeNewsContext(region, periodKey),
      selectTopSignals(region, periodKey),
    ]);

    const topSignals = signalResult.signals;
    const signalsHash = computeSignalsHash(topSignals);

    const deltas = computeDeltas(metrics, prevMetrics);

    const metricsSnapshot = {
      metrics,
      prevPeriod: prevMetrics.dealCount > 0 ? prevMetrics : null,
    };

    // 2. Compute input hash (deltas excluded — derived deterministically from metrics)
    const inputHash = computeInputHash({
      region, periodType, periodStart, periodEnd, kind,
      metricsSnapshot, promptVersion: PROMPT_VERSION,
      signalsHash,
    });

    // 3. Upsert edition and check hash — inside a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 3a. Upsert edition
      const editionResult = await client.query(`
        INSERT INTO brief_editions (region, period_type, period_start, period_end, kind)
        VALUES ($1, $2, $3::date, $4::date, $5)
        ON CONFLICT (region, period_type, period_start, period_end, kind)
        DO UPDATE SET id = brief_editions.id
        RETURNING id, latest_revision_id
      `, [region, periodType, periodStart, periodEnd, kind]);

      const editionId = editionResult.rows[0].id;
      const latestRevisionId = editionResult.rows[0].latest_revision_id;

      // 3b. Check if input hash matches latest revision (skip if unchanged)
      if (!force && latestRevisionId) {
        const hashResult = await client.query(
          `SELECT input_hash, revision FROM brief_revisions WHERE id = $1`,
          [latestRevisionId],
        );
        if (hashResult.rows.length > 0 && hashResult.rows[0].input_hash === inputHash) {
          await client.query('COMMIT');
          return {
            editionId,
            revisionId: latestRevisionId,
            revision: hashResult.rows[0].revision,
            wasSkipped: true,
            inputHash,
            signalsHash,
          };
        }
      }

      // 3c. Compute revision-vs-revision deltas
      let revisionDeltas: BriefSnapshotDeltas | null = null;
      let prevRevisionId: string | null = null;
      let prevGeneratedAt: string | null = null;
      if (latestRevisionId) {
        const prevRev = await client.query(
          'SELECT metrics_snapshot, id, generated_at FROM brief_revisions WHERE id = $1',
          [latestRevisionId],
        );
        const prevMetricsData = prevRev.rows[0]?.metrics_snapshot?.metrics;
        prevRevisionId = prevRev.rows[0]?.id || null;
        prevGeneratedAt = prevRev.rows[0]?.generated_at instanceof Date
          ? prevRev.rows[0].generated_at.toISOString()
          : prevRev.rows[0]?.generated_at || null;
        if (prevMetricsData && prevMetricsData.dealCount > 0) {
          revisionDeltas = computeDeltas(metrics, prevMetricsData);
        }
      }

      // Release connection before LLM call — we'll re-acquire for the insert
      await client.query('COMMIT');
      client.release();

      // 4. Draft builder actions (deterministic), then generate LLM sections
      const draftActions = draftBuilderActions(topSignals, patternLandscape, deltas, revisionDeltas, region);
      const llmSections = await generateLLMSections(metrics, deltas, newsContext, topSignals, periodLabel, revisionDeltas, draftActions);

      const contentSections = {
        title: `${periodLabel} Intelligence Brief`,
        executive_summary: llmSections.executiveSummary,
        theme_title: llmSections.theme.name,
        theme_bullets: llmSections.theme.summaryBullets,
        implications: llmSections.builderLessons,
        what_were_watching: llmSections.whatWatching,
        delta_bullets: llmSections.deltaBullets,
        revision_delta_bullets: llmSections.revisionDeltaBullets || [],
        builder_actions: llmSections.builderActions,
      };

      const fundingByStage = metrics.stageMix.map(s => ({
        stage: s.stage, amount: s.amount, pct: s.pct, deals: s.deals,
      }));

      const computedSections = {
        topDeals,
        geography,
        investors: investorsData,
        patternLandscape,
        fundingByStage,
        spotlight,
        newsContext,
        methodology: computeMethodology(process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-5-nano', PROMPT_VERSION),
      };

      const topSignalRefsPayload = {
        signals: topSignals,
        selectionMeta: signalResult.meta,
      };

      // Build deltas envelope
      const deltasEnvelope = {
        vsPrevPeriod: deltas ? {
          ...deltas,
          periodStart: bounds.prevPeriodStart,
          periodEnd: bounds.prevPeriodEnd,
          mtdAligned: bounds.mtdAligned,
        } : null,
        vsPrevRevision: revisionDeltas ? {
          ...revisionDeltas,
          prevRevisionId,
          prevGeneratedAt,
        } : null,
      };

      // 5. Insert revision inside a new transaction
      const client2 = await pool.connect();
      try {
        await client2.query('BEGIN');

        // Get next revision number
        const revNumResult = await client2.query(
          `SELECT COALESCE(MAX(revision), 0) + 1 AS next_rev FROM brief_revisions WHERE edition_id = $1`,
          [editionId],
        );
        const nextRev = parseInt(revNumResult.rows[0].next_rev) || 1;

        const model = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-5-nano';

        const revResult = await client2.query(`
          INSERT INTO brief_revisions (
            edition_id, revision, input_hash, prompt_version, model,
            metrics_snapshot, deltas_snapshot, content_sections, computed_sections,
            top_signal_refs
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id
        `, [
          editionId, nextRev, inputHash, PROMPT_VERSION, model,
          JSON.stringify(metricsSnapshot),
          JSON.stringify(deltasEnvelope),
          JSON.stringify(contentSections),
          JSON.stringify(computedSections),
          JSON.stringify(topSignalRefsPayload),
        ]);

        const revisionId = revResult.rows[0].id;

        // Update edition pointer
        await client2.query(
          `UPDATE brief_editions SET latest_revision_id = $1 WHERE id = $2`,
          [revisionId, editionId],
        );

        // Seal if requested
        if (kind === 'sealed') {
          await client2.query(
            `UPDATE brief_editions SET sealed_at = NOW() WHERE id = $1 AND sealed_at IS NULL`,
            [editionId],
          );
        }

        await client2.query('COMMIT');

        // E1.3: Validate the generated snapshot (non-blocking)
        let validationErrors: string[] | undefined;
        try {
          const snapshot = await getEditionBrief({ editionId });
          if (snapshot) {
            const result = validateBriefSnapshot(snapshot);
            if (result.errors.length > 0) {
              console.warn('Brief validation warnings:', result.errors);
              validationErrors = result.errors;
            }
          }
        } catch (err) {
          console.warn('Brief validation failed:', (err as Error).message);
        }

        return {
          editionId,
          revisionId,
          revision: nextRev,
          wasSkipped: false,
          inputHash,
          signalsHash,
          validationErrors,
        };
      } catch (err) {
        await client2.query('ROLLBACK');
        throw err;
      } finally {
        client2.release();
      }
    } catch (err) {
      // Only rollback if client not already released
      try { await client.query('ROLLBACK'); } catch { /* already released */ }
      throw err;
    } finally {
      try { client.release(); } catch { /* already released */ }
    }
  }

  // ==========================================================================
  // Query: getEditionBrief — fetch one brief (by edition ID or coordinates)
  // ==========================================================================

  async function getEditionBrief(params: {
    editionId?: string;
    region?: string;
    periodType?: string;
    periodStart?: string;
    kind?: string;
    revision?: number;
  }): Promise<BriefSnapshot | null> {
    let editionQuery: string;
    let editionParams: any[];

    if (params.editionId) {
      editionQuery = `SELECT * FROM brief_editions WHERE id = $1`;
      editionParams = [params.editionId];
    } else if (params.region && params.periodType && params.periodStart) {
      const k = params.kind || 'rolling';
      // Derive period_end from period_start + period_type
      const start = new Date(params.periodStart);
      let end: Date;
      if (params.periodType === 'monthly') {
        end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
      } else {
        end = new Date(start);
        end.setDate(end.getDate() + 6);
      }
      editionQuery = `
        SELECT * FROM brief_editions
        WHERE region = $1 AND period_type = $2 AND period_start = $3::date
          AND kind = $4
        LIMIT 1
      `;
      editionParams = [params.region, params.periodType, params.periodStart, k];
    } else if (params.region && params.periodType) {
      // No period_start: get most recent edition
      const k = params.kind || 'rolling';
      editionQuery = `
        SELECT * FROM brief_editions
        WHERE region = $1 AND period_type = $2 AND kind = $3
          AND latest_revision_id IS NOT NULL
        ORDER BY period_start DESC
        LIMIT 1
      `;
      editionParams = [params.region, params.periodType, k];
    } else {
      return null;
    }

    const editionResult = await pool.query(editionQuery, editionParams);
    if (editionResult.rows.length === 0) return null;

    const edition = editionResult.rows[0];
    if (!edition.latest_revision_id && !params.revision) return null;

    let revisionQuery: string;
    let revisionParams: any[];

    if (params.revision) {
      revisionQuery = `SELECT * FROM brief_revisions WHERE edition_id = $1 AND revision = $2`;
      revisionParams = [edition.id, params.revision];
    } else {
      revisionQuery = `SELECT * FROM brief_revisions WHERE id = $1`;
      revisionParams = [edition.latest_revision_id];
    }

    const revisionResult = await pool.query(revisionQuery, revisionParams);
    if (revisionResult.rows.length === 0) return null;

    return editionRevisionToSnapshot(edition, revisionResult.rows[0]);
  }

  // ==========================================================================
  // Query: listEditions — list available briefs
  // ==========================================================================

  async function listEditions(params: {
    region: string;
    periodType: string;
    kind?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: BriefEditionSummary[]; total: number }> {
    const conditions = ['e.latest_revision_id IS NOT NULL', 'e.region = $1', 'e.period_type = $2'];
    const queryParams: any[] = [params.region, params.periodType];
    let paramIdx = 3;

    if (params.kind) {
      conditions.push(`e.kind = $${paramIdx}`);
      queryParams.push(params.kind);
      paramIdx += 1;
    }

    const whereClause = conditions.join(' AND ');

    const result = await pool.query(`
      SELECT
        e.id AS edition_id,
        e.region,
        e.period_type,
        e.period_start,
        e.period_end,
        e.kind,
        e.sealed_at,
        r.revision,
        r.generated_at,
        (r.metrics_snapshot->'metrics'->>'dealCount')::int AS deal_count,
        (r.metrics_snapshot->'metrics'->>'totalFunding')::bigint AS total_funding
      FROM brief_editions e
      JOIN brief_revisions r ON r.id = e.latest_revision_id
      WHERE ${whereClause}
      ORDER BY e.period_start DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `, [...queryParams, params.limit, params.offset]);

    const countResult = await pool.query(`
      SELECT COUNT(*)::int AS total
      FROM brief_editions e
      WHERE ${whereClause}
    `, queryParams);

    return {
      items: result.rows.map(r => {
        const ps = dateStr(r.period_start);
        const pe = dateStr(r.period_end);
        return {
          editionId: r.edition_id,
          region: r.region,
          periodType: r.period_type,
          periodKey: derivePeriodKey(r.period_type, ps),
          periodLabel: derivePeriodLabel(r.period_type, ps, pe, r.kind),
          periodStart: ps,
          periodEnd: pe,
          kind: r.kind,
          revisionNumber: r.revision,
          generatedAt: r.generated_at instanceof Date ? r.generated_at.toISOString() : r.generated_at,
          dealCount: parseInt(r.deal_count) || 0,
          totalFunding: parseInt(r.total_funding) || 0,
          status: r.kind === 'sealed' ? 'sealed' as const : 'ready' as const,
        };
      }),
      total: parseInt(countResult.rows[0]?.total) || 0,
    };
  }

  // ==========================================================================
  // Query: getRevisionHistory — list revisions for one edition
  // ==========================================================================

  async function getRevisionHistory(editionId: string): Promise<Array<{
    revision: number; generatedAt: string; inputHash: string;
  }>> {
    const result = await pool.query(`
      SELECT revision, generated_at, input_hash
      FROM brief_revisions
      WHERE edition_id = $1
      ORDER BY revision DESC
    `, [editionId]);

    return result.rows.map(r => ({
      revision: r.revision,
      generatedAt: r.generated_at instanceof Date ? r.generated_at.toISOString() : r.generated_at,
      inputHash: r.input_hash,
    }));
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  return {
    generateEditionRevision,
    getEditionBrief,
    listEditions,
    getRevisionHistory,
    resolvePeriodBounds,
    // Exposed for testing
    computeDeltas,
    draftBuilderActions,
  };
}

// =============================================================================
// Exported pure functions for testing
// =============================================================================

/** Compute percentage change between two numbers */
export function pctChange(curr: number, prev: number): { value: number; pct: number } | null {
  if (prev === 0) return curr !== 0 ? { value: curr, pct: 100 } : null;
  return { value: curr - prev, pct: Math.round(((curr - prev) / prev) * 100) };
}

/** Compute SHA-256 of sorted cluster IDs for signal change detection */
export function computeSignalsHashPure(signals: { clusterId: string }[]): string {
  const ids = signals.map(s => s.clusterId).sort();
  return crypto.createHash('sha256').update(JSON.stringify(ids)).digest('hex');
}

/** Compute SHA-256 input hash for idempotency */
export function computeInputHashPure(inputs: {
  region: string;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  kind: string;
  metricsSnapshot: any;
  promptVersion: string;
  signalsHash: string;
}): string {
  const sorted = JSON.stringify(sortKeysDeep(inputs));
  return crypto.createHash('sha256').update(sorted).digest('hex');
}
