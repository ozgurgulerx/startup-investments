/**
 * Data filtering utilities for engagement loops
 */

import type { StartupAnalysis, MonthlyStats } from '@startup-intelligence/shared';

/**
 * Filter query interface - matches SavedFilter schema
 */
export interface FilterQuery {
  stages?: string[];
  patterns?: string[];
  continents?: string[];
  fundingMin?: number;
  fundingMax?: number;
  usesGenai?: boolean;
  verticals?: string[];
}

/**
 * Filter startups based on query criteria
 */
export function filterStartups(
  startups: StartupAnalysis[],
  query: FilterQuery
): StartupAnalysis[] {
  return startups.filter(startup => {
    // Stage filter
    if (query.stages?.length) {
      const stage = startup.funding_stage?.toLowerCase() || '';
      const matches = query.stages.some(s => stage.includes(s.toLowerCase()));
      if (!matches) return false;
    }

    // Pattern filter
    if (query.patterns?.length) {
      const patterns = startup.build_patterns?.map(p => p.name.toLowerCase()) || [];
      const matches = query.patterns.some(p =>
        patterns.some(sp => sp.includes(p.toLowerCase()))
      );
      if (!matches) return false;
    }

    // Continent filter
    if (query.continents?.length) {
      const location = startup.location?.toLowerCase() || '';
      const matches = query.continents.some(c => location.includes(c.toLowerCase()));
      if (!matches) return false;
    }

    // Vertical filter
    if (query.verticals?.length) {
      const vertical = startup.vertical?.toLowerCase() || '';
      const matches = query.verticals.some(v => vertical.includes(v.toLowerCase()));
      if (!matches) return false;
    }

    // Funding range
    const funding = startup.funding_amount || 0;
    if (query.fundingMin !== undefined && funding < query.fundingMin) return false;
    if (query.fundingMax !== undefined && funding > query.fundingMax) return false;

    // GenAI filter
    if (query.usesGenai !== undefined && startup.uses_genai !== query.usesGenai) {
      return false;
    }

    return true;
  });
}

/**
 * Compute pattern cohort - all startups with a specific pattern
 */
export function computePatternCohort(
  startups: StartupAnalysis[],
  patternName: string
): StartupAnalysis[] {
  const normalizedPattern = patternName.toLowerCase();
  return startups
    .filter(s =>
      s.build_patterns?.some(p =>
        p.name.toLowerCase().includes(normalizedPattern)
      )
    )
    .sort((a, b) => (b.funding_amount || 0) - (a.funding_amount || 0));
}

/**
 * Delta summary for month-over-month comparisons
 */
export interface DeltaSummary {
  totalFunding: {
    current: number;
    previous: number;
    change: number;
    changePercent: number;
  };
  totalDeals: {
    current: number;
    previous: number;
    change: number;
    changePercent: number;
  };
  avgDeal: {
    current: number;
    previous: number;
    change: number;
    changePercent: number;
  };
  genaiAdoption: {
    current: number;
    previous: number;
    change: number;
    changePercent: number;
  };
  topPatternChanges: Array<{
    pattern: string;
    currentCount: number;
    previousCount: number;
    change: number;
    changePercent: number;
    direction: 'up' | 'down' | 'neutral';
  }>;
}

/**
 * Compute month-over-month deltas
 */
export function computeMoMDeltas(
  currentStats: MonthlyStats,
  previousStats?: MonthlyStats
): DeltaSummary {
  const current = currentStats.deal_summary;

  // If no previous stats, return current with zero change
  if (!previousStats) {
    return {
      totalFunding: {
        current: current.total_funding_usd,
        previous: 0,
        change: 0,
        changePercent: 0,
      },
      totalDeals: {
        current: current.total_deals,
        previous: 0,
        change: 0,
        changePercent: 0,
      },
      avgDeal: {
        current: current.average_deal_size,
        previous: 0,
        change: 0,
        changePercent: 0,
      },
      genaiAdoption: {
        current: currentStats.genai_analysis.genai_adoption_rate * 100,
        previous: 0,
        change: 0,
        changePercent: 0,
      },
      topPatternChanges: [],
    };
  }

  const previous = previousStats.deal_summary;

  const computeChange = (curr: number, prev: number) => ({
    current: curr,
    previous: prev,
    change: curr - prev,
    changePercent: prev > 0 ? ((curr - prev) / prev) * 100 : 0,
  });

  // Pattern changes
  const currentPatterns = currentStats.genai_analysis.pattern_distribution;
  const previousPatterns = previousStats.genai_analysis.pattern_distribution;

  const allPatterns = new Set([
    ...Object.keys(currentPatterns),
    ...Object.keys(previousPatterns),
  ]);

  const patternChanges = Array.from(allPatterns).map(pattern => {
    const curr = currentPatterns[pattern] || 0;
    const prev = previousPatterns[pattern] || 0;
    const change = curr - prev;
    const changePercent = prev > 0 ? (change / prev) * 100 : curr > 0 ? 100 : 0;

    return {
      pattern,
      currentCount: curr,
      previousCount: prev,
      change,
      changePercent,
      direction: (change > 0 ? 'up' : change < 0 ? 'down' : 'neutral') as
        | 'up'
        | 'down'
        | 'neutral',
    };
  });

  // Sort by absolute change
  patternChanges.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  return {
    totalFunding: computeChange(current.total_funding_usd, previous.total_funding_usd),
    totalDeals: computeChange(current.total_deals, previous.total_deals),
    avgDeal: computeChange(current.average_deal_size, previous.average_deal_size),
    genaiAdoption: computeChange(
      currentStats.genai_analysis.genai_adoption_rate * 100,
      previousStats.genai_analysis.genai_adoption_rate * 100
    ),
    topPatternChanges: patternChanges.slice(0, 5),
  };
}

/**
 * Stage filter presets
 */
export const STAGE_PRESETS = {
  seed: ['seed', 'pre_seed', 'pre-seed'],
  early: ['series_a', 'series a', 'series_b', 'series b'],
  late: ['series_c', 'series c', 'series_d', 'series d', 'late_stage', 'late stage'],
  all: [],
};

/**
 * Funding range presets
 */
export const FUNDING_PRESETS = {
  small: { min: 0, max: 5_000_000 },
  medium: { min: 5_000_000, max: 20_000_000 },
  large: { min: 20_000_000, max: 100_000_000 },
  mega: { min: 100_000_000, max: undefined },
};

/**
 * Compute filter statistics - how many startups match each filter option
 */
export function computeFilterStats(
  startups: StartupAnalysis[]
): {
  byStage: Record<string, number>;
  byPattern: Record<string, number>;
  byContinent: Record<string, number>;
  byGenai: { genai: number; nonGenai: number };
} {
  const byStage: Record<string, number> = {};
  const byPattern: Record<string, number> = {};
  const byContinent: Record<string, number> = {};
  let genaiCount = 0;

  for (const startup of startups) {
    // Stage
    const stage = startup.funding_stage || 'unknown';
    byStage[stage] = (byStage[stage] || 0) + 1;

    // Patterns
    for (const pattern of startup.build_patterns || []) {
      byPattern[pattern.name] = (byPattern[pattern.name] || 0) + 1;
    }

    // Continent (extract from location)
    const location = startup.location || '';
    const continent = extractContinent(location);
    if (continent) {
      byContinent[continent] = (byContinent[continent] || 0) + 1;
    }

    // GenAI
    if (startup.uses_genai) {
      genaiCount++;
    }
  }

  return {
    byStage,
    byPattern,
    byContinent,
    byGenai: { genai: genaiCount, nonGenai: startups.length - genaiCount },
  };
}

/**
 * Extract continent from location string
 */
function extractContinent(location: string): string | null {
  const lower = location.toLowerCase();
  if (
    lower.includes('united states') ||
    lower.includes('canada') ||
    lower.includes('us') ||
    lower.includes('california') ||
    lower.includes('new york')
  ) {
    return 'North America';
  }
  if (
    lower.includes('europe') ||
    lower.includes('uk') ||
    lower.includes('germany') ||
    lower.includes('france') ||
    lower.includes('london')
  ) {
    return 'Europe';
  }
  if (
    lower.includes('asia') ||
    lower.includes('china') ||
    lower.includes('india') ||
    lower.includes('japan') ||
    lower.includes('singapore')
  ) {
    return 'Asia';
  }
  if (lower.includes('israel') || lower.includes('middle east')) {
    return 'Middle East';
  }
  if (lower.includes('australia') || lower.includes('oceania')) {
    return 'Oceania';
  }
  if (lower.includes('africa')) {
    return 'Africa';
  }
  if (lower.includes('south america') || lower.includes('brazil') || lower.includes('latin')) {
    return 'South America';
  }
  return null;
}
