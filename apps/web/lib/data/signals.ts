/**
 * Signal and event utilities for engagement loops
 */

import type { StartupAnalysis, MonthlyStats } from '@startup-intelligence/shared';

/**
 * Signal event from database or derived
 */
export interface SignalEvent {
  id: string;
  type: 'funding' | 'pattern' | 'website' | 'news' | 'trend';
  title: string;
  description: string;
  companySlug?: string;
  companyName?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  importance: 'high' | 'medium' | 'low';
}

/**
 * Derive signal events from startup data and stats
 */
export function deriveSignalEvents(
  startups: StartupAnalysis[],
  stats: MonthlyStats,
  limit = 10
): SignalEvent[] {
  const events: SignalEvent[] = [];
  const now = new Date().toISOString();

  // Top funding rounds as signals
  const topDeals = [...startups]
    .filter(s => s.funding_amount && s.funding_amount > 0)
    .sort((a, b) => (b.funding_amount || 0) - (a.funding_amount || 0))
    .slice(0, 5);

  for (const deal of topDeals) {
    events.push({
      id: `funding-${deal.company_slug}`,
      type: 'funding',
      title: `${deal.company_name} raises ${formatCompactNumber(deal.funding_amount || 0)}`,
      description: deal.description || `${deal.funding_stage?.replace(/_/g, ' ')} round`,
      companySlug: deal.company_slug,
      companyName: deal.company_name,
      metadata: {
        amount: deal.funding_amount,
        stage: deal.funding_stage,
      },
      createdAt: now,
      importance: deal.funding_amount && deal.funding_amount > 50_000_000 ? 'high' : 'medium',
    });
  }

  // Rising patterns as signals
  const patterns = Object.entries(stats.genai_analysis.pattern_distribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  for (const [pattern, count] of patterns) {
    const percentage = ((count / stats.genai_analysis.total_analyzed) * 100).toFixed(0);
    events.push({
      id: `pattern-${pattern.toLowerCase().replace(/\s+/g, '-')}`,
      type: 'pattern',
      title: `${pattern}: ${percentage}% adoption`,
      description: `${count} startups using this pattern this month`,
      metadata: { pattern, count, percentage: Number(percentage) },
      createdAt: now,
      importance: Number(percentage) > 15 ? 'high' : 'medium',
    });
  }

  // GenAI adoption as signal
  const genaiRate = (stats.genai_analysis.genai_adoption_rate * 100).toFixed(0);
  events.push({
    id: 'genai-adoption',
    type: 'trend',
    title: `${genaiRate}% GenAI adoption`,
    description: `${stats.genai_analysis.uses_genai_count} of ${stats.genai_analysis.total_analyzed} startups leverage generative AI`,
    metadata: {
      rate: stats.genai_analysis.genai_adoption_rate,
      count: stats.genai_analysis.uses_genai_count,
    },
    createdAt: now,
    importance: Number(genaiRate) > 50 ? 'high' : 'medium',
  });

  // Sort by importance then by title
  const importanceOrder = { high: 0, medium: 1, low: 2 };
  events.sort((a, b) => importanceOrder[a.importance] - importanceOrder[b.importance]);

  return events.slice(0, limit);
}

/**
 * Get watchlist changes (simulated for now, would query DB in production)
 */
export function getWatchlistChanges(
  watchlistSlugs: string[],
  startups: StartupAnalysis[]
): SignalEvent[] {
  const events: SignalEvent[] = [];
  const now = new Date().toISOString();

  const watchedStartups = startups.filter(s =>
    watchlistSlugs.includes(s.company_slug)
  );

  for (const startup of watchedStartups) {
    // Generate funding event for watched companies
    if (startup.funding_amount && startup.funding_amount > 0) {
      events.push({
        id: `watchlist-funding-${startup.company_slug}`,
        type: 'funding',
        title: `${startup.company_name} funding update`,
        description: `${formatCompactNumber(startup.funding_amount)} ${startup.funding_stage?.replace(/_/g, ' ')} round`,
        companySlug: startup.company_slug,
        companyName: startup.company_name,
        metadata: {
          amount: startup.funding_amount,
          stage: startup.funding_stage,
        },
        createdAt: now,
        importance: 'high',
      });
    }

    // Pattern signals for watched companies
    if (startup.build_patterns && startup.build_patterns.length > 0) {
      events.push({
        id: `watchlist-patterns-${startup.company_slug}`,
        type: 'pattern',
        title: `${startup.company_name} patterns detected`,
        description: startup.build_patterns.map(p => p.name).join(', '),
        companySlug: startup.company_slug,
        companyName: startup.company_name,
        metadata: {
          patterns: startup.build_patterns.map(p => p.name),
        },
        createdAt: now,
        importance: 'medium',
      });
    }
  }

  return events;
}

/**
 * Pattern correlation for co-occurrence matrix
 */
export interface PatternCorrelation {
  patternA: string;
  patternB: string;
  coOccurrenceCount: number;
  patternACount: number;
  patternBCount: number;
  correlation: number; // Jaccard similarity or Pearson
}

/**
 * Compute pattern co-occurrence matrix
 */
export function computePatternCorrelations(
  startups: StartupAnalysis[]
): PatternCorrelation[] {
  const correlations: PatternCorrelation[] = [];

  // Count patterns
  const patternCounts = new Map<string, number>();
  const patternStartups = new Map<string, Set<string>>();

  for (const startup of startups) {
    for (const pattern of startup.build_patterns || []) {
      const name = pattern.name;
      patternCounts.set(name, (patternCounts.get(name) || 0) + 1);

      if (!patternStartups.has(name)) {
        patternStartups.set(name, new Set());
      }
      patternStartups.get(name)!.add(startup.company_slug);
    }
  }

  // Compute correlations for pattern pairs
  const patterns = Array.from(patternCounts.keys());

  for (let i = 0; i < patterns.length; i++) {
    for (let j = i + 1; j < patterns.length; j++) {
      const patternA = patterns[i];
      const patternB = patterns[j];

      const setA = patternStartups.get(patternA)!;
      const setB = patternStartups.get(patternB)!;

      // Intersection
      const intersection = new Set([...setA].filter(x => setB.has(x)));
      const coOccurrenceCount = intersection.size;

      if (coOccurrenceCount === 0) continue;

      // Union for Jaccard
      const union = new Set([...setA, ...setB]);

      // Jaccard similarity
      const correlation = intersection.size / union.size;

      correlations.push({
        patternA,
        patternB,
        coOccurrenceCount,
        patternACount: setA.size,
        patternBCount: setB.size,
        correlation,
      });
    }
  }

  // Sort by correlation strength
  return correlations.sort((a, b) => b.correlation - a.correlation);
}

/**
 * Get top signals for signal strip
 */
export function getTopSignals(
  startups: StartupAnalysis[],
  stats: MonthlyStats,
  previousStats?: MonthlyStats
): {
  deltas: Array<{
    label: string;
    value: string;
    change: number;
    direction: 'up' | 'down' | 'neutral';
  }>;
  anomaly: {
    title: string;
    description: string;
    slug?: string;
  } | null;
  risingPattern: {
    name: string;
    count: number;
    change: number;
  } | null;
} {
  const deltas: Array<{
    label: string;
    value: string;
    change: number;
    direction: 'up' | 'down' | 'neutral';
  }> = [];

  // Funding delta
  const currentFunding = stats.deal_summary.total_funding_usd;
  const prevFunding = previousStats?.deal_summary.total_funding_usd || currentFunding;
  const fundingChange = prevFunding > 0 ? ((currentFunding - prevFunding) / prevFunding) * 100 : 0;

  deltas.push({
    label: 'Total Funding',
    value: formatCompactNumber(currentFunding),
    change: fundingChange,
    direction: fundingChange > 0 ? 'up' : fundingChange < 0 ? 'down' : 'neutral',
  });

  // Deals delta
  const currentDeals = stats.deal_summary.total_deals;
  const prevDeals = previousStats?.deal_summary.total_deals || currentDeals;
  const dealsChange = prevDeals > 0 ? ((currentDeals - prevDeals) / prevDeals) * 100 : 0;

  deltas.push({
    label: 'Deals',
    value: currentDeals.toString(),
    change: dealsChange,
    direction: dealsChange > 0 ? 'up' : dealsChange < 0 ? 'down' : 'neutral',
  });

  // GenAI delta
  const currentGenai = stats.genai_analysis.genai_adoption_rate * 100;
  const prevGenai = (previousStats?.genai_analysis.genai_adoption_rate || 0) * 100;
  const genaiChange = prevGenai > 0 ? currentGenai - prevGenai : 0;

  deltas.push({
    label: 'GenAI Rate',
    value: `${currentGenai.toFixed(0)}%`,
    change: genaiChange,
    direction: genaiChange > 0 ? 'up' : genaiChange < 0 ? 'down' : 'neutral',
  });

  // Anomaly - largest deal
  const topDeal = [...startups]
    .filter(s => s.funding_amount)
    .sort((a, b) => (b.funding_amount || 0) - (a.funding_amount || 0))[0];

  const anomaly = topDeal
    ? {
        title: `${topDeal.company_name}: ${formatCompactNumber(topDeal.funding_amount || 0)}`,
        description: `Largest deal this month`,
        slug: topDeal.company_slug,
      }
    : null;

  // Rising pattern
  const patterns = Object.entries(stats.genai_analysis.pattern_distribution);
  const prevPatterns = previousStats?.genai_analysis.pattern_distribution || {};

  const patternChanges = patterns.map(([name, count]) => ({
    name,
    count,
    change: count - (prevPatterns[name] || 0),
  }));

  patternChanges.sort((a, b) => b.change - a.change);
  const risingPattern = patternChanges[0]?.change > 0 ? patternChanges[0] : null;

  return { deltas, anomaly, risingPattern };
}

/**
 * Format number compactly (e.g., 1.2M, 500K)
 */
function formatCompactNumber(num: number): string {
  if (num >= 1_000_000_000) {
    return `$${(num / 1_000_000_000).toFixed(1)}B`;
  }
  if (num >= 1_000_000) {
    return `$${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `$${(num / 1_000).toFixed(0)}K`;
  }
  return `$${num}`;
}
