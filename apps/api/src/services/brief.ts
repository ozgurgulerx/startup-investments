/**
 * Dealbook Brief Service
 *
 * Computes living brief snapshots from the database.
 * All metrics are deterministic (no LLM) — LLM is only used
 * for narrative sections (delta bullets, executive summary, etc).
 */

import { Pool } from 'pg';

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

interface BriefSnapshot {
  id: string;
  region: 'global' | 'turkey';
  periodType: 'monthly' | 'weekly';
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  revisionNumber: number;
  generatedAt: string;
  metrics: BriefSnapshotMetrics;
  prevPeriod: BriefSnapshotMetrics | null;
  deltas: BriefSnapshotDeltas | null;
  newsContext: BriefNewsContext | null;
  deltaBullets: string[];
  executiveSummary: string;
  theme: { name: string; summaryBullets: string[] };
  builderLessons: Array<{ title: string; text: string; howToApply?: string }>;
  whatWatching: string[];
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

interface BriefSnapshotSummary {
  id: string;
  region: 'global' | 'turkey';
  periodType: 'monthly' | 'weekly';
  periodKey: string;
  periodLabel: string;
  revisionNumber: number;
  generatedAt: string;
  dealCount: number;
  totalFunding: number;
  status: 'draft' | 'ready' | 'sealed';
}

// ============================================================================
// Types
// ============================================================================

interface ComputeParams {
  region: 'global' | 'turkey';
  periodType: 'monthly' | 'weekly';
  periodKey?: string; // defaults to current month/week
}

interface PeriodBounds {
  periodKey: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;
  periodLabel: string;
  prevPeriodKey: string;
  prevPeriodStart: string;
  prevPeriodEnd: string;
}

// ============================================================================
// Factory
// ============================================================================

export function makeBriefService(pool: Pool) {
  // --------------------------------------------------------------------------
  // Period helpers
  // --------------------------------------------------------------------------

  function resolvePeriodBounds(periodType: 'monthly' | 'weekly', periodKey?: string): PeriodBounds {
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
      const prevEnd = new Date(year, month - 1, 0);

      return {
        periodKey: key,
        periodStart: fmt(start),
        periodEnd: fmt(end),
        periodLabel: label,
        prevPeriodKey: prevKey,
        prevPeriodStart: fmt(prevDate),
        prevPeriodEnd: fmt(prevEnd),
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

  // --------------------------------------------------------------------------
  // For monthly periods, map period key (YYYY-MM) to the `startups.period` column format
  // For weekly, we use date-range filtering on funding_rounds.announced_date
  // --------------------------------------------------------------------------

  function periodMatchClause(periodType: string, periodKey: string, periodStart: string, periodEnd: string): { whereClause: string; params: string[] } {
    if (periodType === 'monthly') {
      // startups.period stores "YYYY-MM"
      return { whereClause: `s.period = $OFFSET`, params: [periodKey] };
    }
    // Weekly: filter by funding round date range
    return {
      whereClause: `fr.announced_date >= $OFFSET::date AND fr.announced_date <= $NEXTOFFSET::date`,
      params: [periodStart, periodEnd],
    };
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
          nc.representative_title AS title,
          nc.representative_summary AS summary,
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
        GROUP BY nc.id, nc.representative_title, nc.representative_summary,
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
  // LLM generation (optional)
  // --------------------------------------------------------------------------

  async function generateLLMSections(
    metrics: BriefSnapshotMetrics,
    deltas: BriefSnapshotDeltas | null,
    newsContext: BriefNewsContext | null,
    periodLabel: string,
  ): Promise<{
    deltaBullets: string[];
    executiveSummary: string;
    theme: { name: string; summaryBullets: string[] };
    builderLessons: Array<{ title: string; text: string; howToApply?: string }>;
    whatWatching: string[];
  }> {
    // Try LLM generation via Azure OpenAI
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;

    if (!endpoint || !deployment) {
      console.log('Brief: LLM not configured, using template generation');
      return generateTemplateSections(metrics, deltas, periodLabel);
    }

    try {
      const prompt = buildLLMPrompt(metrics, deltas, newsContext, periodLabel);

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
          return generateTemplateSections(metrics, deltas, periodLabel);
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
        return generateTemplateSections(metrics, deltas, periodLabel);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        return generateTemplateSections(metrics, deltas, periodLabel);
      }

      const parsed = JSON.parse(content);
      return {
        deltaBullets: Array.isArray(parsed.delta_bullets) ? parsed.delta_bullets.slice(0, 5) : [],
        executiveSummary: typeof parsed.executive_summary === 'string' ? parsed.executive_summary : '',
        theme: parsed.theme && typeof parsed.theme.name === 'string'
          ? { name: parsed.theme.name, summaryBullets: Array.isArray(parsed.theme.summaryBullets) ? parsed.theme.summaryBullets : [] }
          : { name: 'AI Ecosystem Update', summaryBullets: [] },
        builderLessons: Array.isArray(parsed.builder_lessons)
          ? parsed.builder_lessons.map((l: any) => ({ title: l.title || '', text: l.text || '', howToApply: l.howToApply }))
          : [],
        whatWatching: Array.isArray(parsed.what_watching) ? parsed.what_watching.slice(0, 5) : [],
      };
    } catch (err) {
      console.warn('Brief: LLM generation error:', (err as Error).message);
      return generateTemplateSections(metrics, deltas, periodLabel);
    }
  }

  function buildLLMPrompt(
    metrics: BriefSnapshotMetrics,
    deltas: BriefSnapshotDeltas | null,
    newsContext: BriefNewsContext | null,
    periodLabel: string,
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
      if (deltas.genaiAdoptionRate) prompt += `\n- GenAI adoption: ${deltas.genaiAdoptionRate.ppChange > 0 ? '+' : ''}${deltas.genaiAdoptionRate.ppChange}pp`;
      if (deltas.patternShifts.length > 0) {
        prompt += `\n- Pattern shifts: ${deltas.patternShifts.map((s: BriefSnapshotDeltas['patternShifts'][number]) => `${s.pattern} ${s.deltaPp > 0 ? '+' : ''}${s.deltaPp}pp`).join(', ')}`;
      }
    }

    if (newsContext && newsContext.clusters.length > 0) {
      prompt += `\n\nRecent news headlines linked to these startups:`;
      newsContext.clusters.slice(0, 5).forEach((c: BriefNewsContext['clusters'][number]) => {
        prompt += `\n- ${c.title} [${c.storyType}]`;
      });
    }

    prompt += `

Output JSON with these exact keys:
{
  "delta_bullets": ["string (max 24 words each, reference specific numbers)", ...3-5 items],
  "executive_summary": "string (70-120 words, rephrase only — use provided numbers)",
  "theme": { "name": "string (2-4 words)", "summaryBullets": ["string", ...3-4 items] },
  "builder_lessons": [{ "title": "string", "text": "string", "howToApply": "string" }, ...2-3 items],
  "what_watching": ["string", ...3-5 items]
}

Rules:
- Delta bullets must reference at least one numeric delta from input. Can reference news headlines. Max 24 words per bullet.
- Executive summary: Rephrase only — use provided numbers. No fabricated statistics.
- Theme: Ground in pattern shifts and news trends.
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
  ) {
    const deltaBullets: string[] = [];
    if (deltas?.totalFunding) {
      deltaBullets.push(`Total funding ${deltas.totalFunding.pct > 0 ? 'rose' : 'fell'} ${Math.abs(deltas.totalFunding.pct)}% to ${formatM(metrics.totalFunding)} across ${metrics.dealCount} deals`);
    }
    if (deltas?.dealCount) {
      deltaBullets.push(`Deal count ${deltas.dealCount.pct > 0 ? 'increased' : 'decreased'} ${Math.abs(deltas.dealCount.pct)}% to ${metrics.dealCount} deals`);
    }
    if (deltas?.genaiAdoptionRate && deltas.genaiAdoptionRate.ppChange !== 0) {
      deltaBullets.push(`GenAI adoption ${deltas.genaiAdoptionRate.ppChange > 0 ? 'rose' : 'fell'} ${Math.abs(deltas.genaiAdoptionRate.ppChange)}pp to ${metrics.genaiAdoptionRate}%`);
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

    return { deltaBullets, executiveSummary, theme, builderLessons, whatWatching };
  }

  // --------------------------------------------------------------------------
  // Methodology
  // --------------------------------------------------------------------------

  function computeMethodology(): BriefSnapshot['methodology'] {
    return {
      bullets: [
        'Metrics derived from tracked funding rounds and startup profiles in the BuildAtlas database',
        'GenAI adoption determined by analysis pipeline examining company website, documentation, and product signals',
        'Pattern prevalence calculated across all startups with completed analysis for this period',
        'Top deals ranked by disclosed funding amount; undisclosed rounds excluded from aggregations',
        'Geography based on startup headquarters location; investor geography may differ',
        'Brief generated daily with incremental revision tracking',
      ],
    };
  }

  // --------------------------------------------------------------------------
  // Main: computeBriefSnapshot
  // --------------------------------------------------------------------------

  async function computeBriefSnapshot(params: ComputeParams): Promise<BriefSnapshot> {
    const bounds = resolvePeriodBounds(params.periodType, params.periodKey);

    // Compute metrics for current and previous period in parallel
    const [metrics, prevMetrics, topDeals, geography, investorsData, patternLandscape, spotlight, newsContext] = await Promise.all([
      computeMetrics(params.region, bounds.periodKey, params.periodType, bounds.periodStart, bounds.periodEnd),
      computeMetrics(params.region, bounds.prevPeriodKey, params.periodType, bounds.prevPeriodStart, bounds.prevPeriodEnd),
      computeTopDeals(params.region, bounds.periodKey),
      computeGeography(params.region, bounds.periodKey),
      computeInvestors(params.region, bounds.periodKey),
      computePatternLandscape(params.region, bounds.periodKey),
      computeSpotlight(params.region, bounds.periodKey),
      computeNewsContext(params.region, bounds.periodKey),
    ]);

    const deltas = computeDeltas(metrics, prevMetrics);

    // Generate LLM sections (with template fallback)
    const llmSections = await generateLLMSections(metrics, deltas, newsContext, bounds.periodLabel);

    // Funding by stage for display
    const fundingByStage = metrics.stageMix.map((s: BriefSnapshotMetrics['stageMix'][number]) => ({
      stage: s.stage,
      amount: s.amount,
      pct: s.pct,
      deals: s.deals,
    }));

    return {
      id: '', // will be set by persist
      region: params.region,
      periodType: params.periodType,
      periodKey: bounds.periodKey,
      periodStart: bounds.periodStart,
      periodEnd: bounds.periodEnd,
      periodLabel: bounds.periodLabel,
      revisionNumber: 0, // will be set by persist
      generatedAt: new Date().toISOString(),

      metrics,
      prevPeriod: prevMetrics.dealCount > 0 ? prevMetrics : null,
      deltas,
      newsContext,

      deltaBullets: llmSections.deltaBullets,
      executiveSummary: llmSections.executiveSummary,
      theme: llmSections.theme,
      builderLessons: llmSections.builderLessons,
      whatWatching: llmSections.whatWatching,

      patternLandscape,
      fundingByStage,
      topDeals,
      geography,
      investors: investorsData,
      spotlight,
      methodology: computeMethodology(),

      status: 'ready',
    };
  }

  // --------------------------------------------------------------------------
  // Persist snapshot
  // --------------------------------------------------------------------------

  async function persistSnapshot(snapshot: BriefSnapshot): Promise<BriefSnapshot> {
    // Get next revision number
    const revResult = await pool.query(`
      SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_rev
      FROM dealbook_brief_snapshots
      WHERE region = $1 AND period_type = $2 AND period_key = $3
    `, [snapshot.region, snapshot.periodType, snapshot.periodKey]);

    const revisionNumber = parseInt(revResult.rows[0]?.next_rev) || 1;

    // Determine status: if period has ended, seal it
    const now = new Date();
    const endDate = new Date(snapshot.periodEnd);
    const status = endDate < now ? 'sealed' : 'ready';

    const result = await pool.query(`
      INSERT INTO dealbook_brief_snapshots (
        region, period_type, period_key, period_start, period_end, period_label,
        revision_number, metrics_json, prev_period_json, deltas_json,
        delta_bullets, executive_summary, theme_json, builder_lessons_json, what_watching,
        top_deals_json, geography_json, investors_json, spotlight_json,
        patterns_json, funding_by_stage_json, methodology_json,
        news_context_json, status, generated_at
      ) VALUES (
        $1, $2, $3, $4::date, $5::date, $6,
        $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18, $19,
        $20, $21, $22,
        $23, $24, NOW()
      )
      RETURNING id, generated_at, revision_number
    `, [
      snapshot.region, snapshot.periodType, snapshot.periodKey,
      snapshot.periodStart, snapshot.periodEnd, snapshot.periodLabel,
      revisionNumber,
      JSON.stringify(snapshot.metrics),
      snapshot.prevPeriod ? JSON.stringify(snapshot.prevPeriod) : null,
      snapshot.deltas ? JSON.stringify(snapshot.deltas) : null,
      snapshot.deltaBullets,
      snapshot.executiveSummary,
      JSON.stringify(snapshot.theme),
      JSON.stringify(snapshot.builderLessons),
      snapshot.whatWatching,
      JSON.stringify(snapshot.topDeals),
      JSON.stringify(snapshot.geography),
      JSON.stringify(snapshot.investors),
      snapshot.spotlight ? JSON.stringify(snapshot.spotlight) : null,
      JSON.stringify(snapshot.patternLandscape),
      JSON.stringify(snapshot.fundingByStage),
      JSON.stringify(snapshot.methodology),
      snapshot.newsContext ? JSON.stringify(snapshot.newsContext) : null,
      status,
    ]);

    const row = result.rows[0];
    return {
      ...snapshot,
      id: row.id,
      revisionNumber: row.revision_number,
      generatedAt: row.generated_at.toISOString(),
      status,
    };
  }

  // --------------------------------------------------------------------------
  // Query: getLatestSnapshot
  // --------------------------------------------------------------------------

  async function getLatestSnapshot(
    region: string,
    periodType: string,
    periodKey?: string,
  ): Promise<BriefSnapshot | null> {
    let query: string;
    let params: any[];

    if (periodKey) {
      query = `
        SELECT * FROM dealbook_brief_snapshots
        WHERE region = $1 AND period_type = $2 AND period_key = $3
          AND status IN ('ready', 'sealed')
        ORDER BY revision_number DESC
        LIMIT 1
      `;
      params = [region, periodType, periodKey];
    } else {
      query = `
        SELECT * FROM dealbook_brief_snapshots
        WHERE region = $1 AND period_type = $2
          AND status IN ('ready', 'sealed')
        ORDER BY generated_at DESC
        LIMIT 1
      `;
      params = [region, periodType];
    }

    const result = await pool.query(query, params);
    if (result.rows.length === 0) return null;
    return rowToSnapshot(result.rows[0]);
  }

  // --------------------------------------------------------------------------
  // Query: getSnapshotArchive
  // --------------------------------------------------------------------------

  async function getSnapshotArchive(
    region: string,
    periodType: string,
    limit: number,
    offset: number,
  ): Promise<{ items: BriefSnapshotSummary[]; total: number }> {
    // Get latest revision per period_key
    const result = await pool.query(`
      SELECT DISTINCT ON (period_key)
        id, region, period_type, period_key, period_label,
        revision_number, generated_at,
        (metrics_json->>'dealCount')::int AS deal_count,
        (metrics_json->>'totalFunding')::bigint AS total_funding,
        status
      FROM dealbook_brief_snapshots
      WHERE region = $1 AND period_type = $2
        AND status IN ('ready', 'sealed')
      ORDER BY period_key DESC, revision_number DESC
      LIMIT $3 OFFSET $4
    `, [region, periodType, limit, offset]);

    const countResult = await pool.query(`
      SELECT COUNT(DISTINCT period_key)::int AS total
      FROM dealbook_brief_snapshots
      WHERE region = $1 AND period_type = $2
        AND status IN ('ready', 'sealed')
    `, [region, periodType]);

    return {
      items: result.rows.map(r => ({
        id: r.id,
        region: r.region,
        periodType: r.period_type,
        periodKey: r.period_key,
        periodLabel: r.period_label,
        revisionNumber: r.revision_number,
        generatedAt: r.generated_at?.toISOString() || '',
        dealCount: parseInt(r.deal_count) || 0,
        totalFunding: parseInt(r.total_funding) || 0,
        status: r.status,
      })),
      total: parseInt(countResult.rows[0]?.total) || 0,
    };
  }

  // --------------------------------------------------------------------------
  // Row mapper
  // --------------------------------------------------------------------------

  function rowToSnapshot(row: any): BriefSnapshot {
    return {
      id: row.id,
      region: row.region,
      periodType: row.period_type,
      periodKey: row.period_key,
      periodStart: row.period_start instanceof Date ? row.period_start.toISOString().split('T')[0] : row.period_start,
      periodEnd: row.period_end instanceof Date ? row.period_end.toISOString().split('T')[0] : row.period_end,
      periodLabel: row.period_label,
      revisionNumber: row.revision_number,
      generatedAt: row.generated_at instanceof Date ? row.generated_at.toISOString() : row.generated_at,

      metrics: row.metrics_json || {},
      prevPeriod: row.prev_period_json || null,
      deltas: row.deltas_json || null,
      newsContext: row.news_context_json || null,

      deltaBullets: row.delta_bullets || [],
      executiveSummary: row.executive_summary || '',
      theme: row.theme_json || { name: '', summaryBullets: [] },
      builderLessons: row.builder_lessons_json || [],
      whatWatching: row.what_watching || [],

      patternLandscape: row.patterns_json || [],
      fundingByStage: row.funding_by_stage_json || [],
      topDeals: row.top_deals_json || [],
      geography: row.geography_json || [],
      investors: row.investors_json || { mostActive: [], megaCheckWriters: [] },
      spotlight: row.spotlight_json || undefined,
      methodology: row.methodology_json || { bullets: [] },

      status: row.status,
    };
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  return {
    computeBriefSnapshot,
    persistSnapshot,
    getLatestSnapshot,
    getSnapshotArchive,
    resolvePeriodBounds,
  };
}
