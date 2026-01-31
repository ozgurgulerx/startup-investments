'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus, BarChart3, MapPin, Tag } from 'lucide-react';
import type { StartupAnalysis, MonthlyStats } from '@startup-intelligence/shared';

export interface WatchlistComparisonProps {
  watchedStartups: StartupAnalysis[];
  allStats: MonthlyStats;
  className?: string;
}

interface ComparisonMetric {
  label: string;
  watchlistValue: string;
  baselineValue: string;
  difference: number;
  direction: 'up' | 'down' | 'neutral';
  description: string;
}

export function WatchlistComparison({
  watchedStartups,
  allStats,
  className,
}: WatchlistComparisonProps) {
  const metrics = React.useMemo(
    () => computeComparisonMetrics(watchedStartups, allStats),
    [watchedStartups, allStats]
  );

  if (watchedStartups.length < 2) {
    return null;
  }

  return (
    <div className={cn('border border-border/30 rounded-lg overflow-hidden', className)}>
      <div className="px-4 py-3 bg-muted/10 border-b border-border/30">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">Your Portfolio vs Market</h3>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {metrics.map((metric, i) => (
          <ComparisonRow key={i} metric={metric} />
        ))}
      </div>

      {/* Pattern breakdown */}
      <PatternBreakdown startups={watchedStartups} allStats={allStats} />

      {/* Geographic breakdown */}
      <GeographicBreakdown startups={watchedStartups} allStats={allStats} />
    </div>
  );
}

function ComparisonRow({ metric }: { metric: ComparisonMetric }) {
  const TrendIcon =
    metric.direction === 'up'
      ? TrendingUp
      : metric.direction === 'down'
        ? TrendingDown
        : Minus;

  const trendColor =
    metric.direction === 'up'
      ? 'text-success'
      : metric.direction === 'down'
        ? 'text-destructive'
        : 'text-muted-foreground';

  return (
    <div className="flex items-center justify-between">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{metric.label}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-sm font-medium text-foreground">
            {metric.watchlistValue}
          </span>
          <span className="text-xs text-muted-foreground/60">
            vs {metric.baselineValue}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <TrendIcon className={cn('w-3.5 h-3.5', trendColor)} />
        <span className={cn('text-xs tabular-nums', trendColor)}>
          {metric.difference > 0 ? '+' : ''}
          {metric.difference.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

function PatternBreakdown({
  startups,
  allStats,
}: {
  startups: StartupAnalysis[];
  allStats: MonthlyStats;
}) {
  const patternCounts = new Map<string, number>();
  for (const startup of startups) {
    for (const pattern of startup.build_patterns || []) {
      patternCounts.set(pattern.name, (patternCounts.get(pattern.name) || 0) + 1);
    }
  }

  const topPatterns = Array.from(patternCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  if (topPatterns.length === 0) return null;

  return (
    <div className="px-4 py-3 border-t border-border/30">
      <div className="flex items-center gap-2 mb-3">
        <Tag className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Patterns in your portfolio</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {topPatterns.map(([pattern, count]) => (
          <span
            key={pattern}
            className="px-2 py-1 text-xs bg-muted/30 text-muted-foreground rounded"
          >
            {pattern} ({count})
          </span>
        ))}
      </div>
    </div>
  );
}

function GeographicBreakdown({
  startups,
  allStats,
}: {
  startups: StartupAnalysis[];
  allStats: MonthlyStats;
}) {
  const locationCounts = new Map<string, number>();
  for (const startup of startups) {
    const location = extractRegion(startup.location || '');
    if (location) {
      locationCounts.set(location, (locationCounts.get(location) || 0) + 1);
    }
  }

  const topLocations = Array.from(locationCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  if (topLocations.length === 0) return null;

  return (
    <div className="px-4 py-3 border-t border-border/30">
      <div className="flex items-center gap-2 mb-3">
        <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Geographic distribution</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {topLocations.map(([location, count]) => (
          <span
            key={location}
            className="px-2 py-1 text-xs bg-muted/30 text-muted-foreground rounded"
          >
            {location} ({count})
          </span>
        ))}
      </div>
    </div>
  );
}

function computeComparisonMetrics(
  startups: StartupAnalysis[],
  allStats: MonthlyStats
): ComparisonMetric[] {
  const metrics: ComparisonMetric[] = [];

  // Average funding
  const watchlistFunding = startups
    .filter(s => s.funding_amount)
    .map(s => s.funding_amount!);
  const watchlistAvg =
    watchlistFunding.length > 0
      ? watchlistFunding.reduce((a, b) => a + b, 0) / watchlistFunding.length
      : 0;
  const marketAvg = allStats.deal_summary.average_deal_size;
  const avgDiff = marketAvg > 0 ? ((watchlistAvg - marketAvg) / marketAvg) * 100 : 0;

  metrics.push({
    label: 'Avg Deal Size',
    watchlistValue: formatCurrency(watchlistAvg, true),
    baselineValue: formatCurrency(marketAvg, true),
    difference: avgDiff,
    direction: avgDiff > 5 ? 'up' : avgDiff < -5 ? 'down' : 'neutral',
    description: 'Average funding amount',
  });

  // GenAI adoption
  const watchlistGenai = startups.filter(s => s.uses_genai).length;
  const watchlistGenaiRate =
    startups.length > 0 ? (watchlistGenai / startups.length) * 100 : 0;
  const marketGenaiRate = allStats.genai_analysis.genai_adoption_rate * 100;
  const genaiDiff = watchlistGenaiRate - marketGenaiRate;

  metrics.push({
    label: 'GenAI Adoption',
    watchlistValue: `${watchlistGenaiRate.toFixed(0)}%`,
    baselineValue: `${marketGenaiRate.toFixed(0)}%`,
    difference: genaiDiff,
    direction: genaiDiff > 5 ? 'up' : genaiDiff < -5 ? 'down' : 'neutral',
    description: 'Companies using generative AI',
  });

  return metrics;
}

function extractRegion(location: string): string | null {
  const lower = location.toLowerCase();
  if (lower.includes('california') || lower.includes('san francisco') || lower.includes('sf')) {
    return 'California';
  }
  if (lower.includes('new york') || lower.includes('nyc')) {
    return 'New York';
  }
  if (lower.includes('united states') || lower.includes('usa')) {
    return 'US (Other)';
  }
  if (lower.includes('europe') || lower.includes('uk') || lower.includes('germany')) {
    return 'Europe';
  }
  if (lower.includes('asia') || lower.includes('singapore') || lower.includes('india')) {
    return 'Asia';
  }
  return null;
}
