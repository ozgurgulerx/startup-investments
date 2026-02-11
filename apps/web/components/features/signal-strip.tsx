'use client';

import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus, Zap, ArrowRight } from 'lucide-react';
import type { StartupAnalysis, MonthlyStats } from '@startup-intelligence/shared';
import { getTopSignals } from '@/lib/data/signals';

export interface SignalStripProps {
  startups: StartupAnalysis[];
  stats: MonthlyStats;
  previousStats?: MonthlyStats;
  className?: string;
}

export function SignalStrip({
  startups,
  stats,
  previousStats,
  className,
}: SignalStripProps) {
  const { deltas, anomaly, risingPattern } = React.useMemo(
    () => getTopSignals(startups, stats, previousStats),
    [startups, stats, previousStats]
  );

  return (
    <div
      className={cn(
        'mb-8 p-4 border border-border/30 rounded-lg bg-muted/5',
        className
      )}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-accent-info" />
          <span className="text-xs font-medium text-foreground uppercase tracking-wider">
            Today&apos;s Signals
          </span>
        </div>
        <Link
          href="/signals"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          All signals
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {/* Delta cards */}
        {deltas.map((delta, i) => (
          <DeltaChip key={i} {...delta} />
        ))}

        {/* Anomaly card */}
        {anomaly && (
          <div className="col-span-1">
            {anomaly.slug ? (
              <Link
                href={`/company/${anomaly.slug}`}
                className="block p-3 border border-accent-info/20 rounded bg-accent-info/5 hover:bg-accent-info/10 transition-colors"
              >
                <p className="text-[10px] text-accent-info uppercase tracking-wider mb-1">
                  Top Deal
                </p>
                <p className="text-sm font-medium text-foreground truncate">
                  {anomaly.title}
                </p>
                <p className="text-xs text-muted-foreground/70 truncate">
                  {anomaly.description}
                </p>
              </Link>
            ) : (
              <div className="p-3 border border-accent-info/20 rounded bg-accent-info/5">
                <p className="text-[10px] text-accent-info uppercase tracking-wider mb-1">
                  Top Deal
                </p>
                <p className="text-sm font-medium text-foreground truncate">
                  {anomaly.title}
                </p>
                <p className="text-xs text-muted-foreground/70 truncate">
                  {anomaly.description}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Rising pattern */}
        {risingPattern && risingPattern.change > 0 && (
          <div className="col-span-1">
            <Link
              href="/signals"
              className="block p-3 border border-border/30 rounded hover:bg-muted/20 transition-colors"
            >
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                Rising Pattern
              </p>
              <p className="text-sm font-medium text-foreground truncate">
                {risingPattern.name}
              </p>
              <p className="text-xs text-success">
                +{risingPattern.change} new
              </p>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

interface DeltaChipProps {
  label: string;
  value: string;
  change: number;
  direction: 'up' | 'down' | 'neutral';
}

function DeltaChip({ label, value, change, direction }: DeltaChipProps) {
  const TrendIcon =
    direction === 'up'
      ? TrendingUp
      : direction === 'down'
        ? TrendingDown
        : Minus;

  const trendColor =
    direction === 'up'
      ? 'text-success'
      : direction === 'down'
        ? 'text-destructive'
        : 'text-muted-foreground';

  return (
    <div className="p-3 border border-border/30 rounded hover:bg-muted/20 transition-colors">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
        {label}
      </p>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground tabular-nums">
          {value}
        </span>
        {change !== 0 && (
          <div className={cn('flex items-center gap-1', trendColor)}>
            <TrendIcon className="w-3 h-3" />
            <span className="text-xs tabular-nums">
              {change > 0 ? '+' : ''}
              {change.toFixed(0)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// Static signal strip for server components
export interface StaticSignalStripDeltas {
  totalFunding?: { pct: number } | null;
  dealCount?: { pct: number } | null;
  genaiAdoptionRate?: { ppChange: number } | null;
}

export interface StaticSignalStripProps {
  metrics: {
    totalFunding: string;
    totalDeals: number;
    genaiAdoption: string;
    topDeal?: { name: string; amount: string; slug?: string };
  };
  deltas?: StaticSignalStripDeltas | null;
  className?: string;
}

function TrendArrow({ change, suffix = '%' }: { change: number; suffix?: string }) {
  if (change === 0) return null;
  const isUp = change > 0;
  const Icon = isUp ? TrendingUp : TrendingDown;
  const color = isUp ? 'text-success' : 'text-destructive';
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[10px] tabular-nums', color)}>
      <Icon className="w-2.5 h-2.5" />
      {isUp ? '+' : ''}{change}{suffix}
    </span>
  );
}

export function StaticSignalStrip({ metrics, deltas, className }: StaticSignalStripProps) {
  return (
    <div
      className={cn(
        'mb-8 p-4 border border-border/30 rounded-lg bg-muted/5',
        className
      )}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-accent-info" />
          <span className="text-xs font-medium text-foreground uppercase tracking-wider">
            Quick Stats
          </span>
        </div>
        <Link
          href="/signals"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          Full analysis
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-3 border border-border/30 rounded">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
            Total Funding
          </p>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground tabular-nums">
              {metrics.totalFunding}
            </p>
            {deltas?.totalFunding && <TrendArrow change={deltas.totalFunding.pct} />}
          </div>
        </div>

        <div className="p-3 border border-border/30 rounded">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
            Deals
          </p>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground tabular-nums">
              {metrics.totalDeals}
            </p>
            {deltas?.dealCount && <TrendArrow change={deltas.dealCount.pct} />}
          </div>
        </div>

        <div className="p-3 border border-border/30 rounded">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
            GenAI Adoption
          </p>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground tabular-nums">
              {metrics.genaiAdoption}
            </p>
            {deltas?.genaiAdoptionRate && <TrendArrow change={deltas.genaiAdoptionRate.ppChange} suffix="pp" />}
          </div>
        </div>

        {metrics.topDeal && (
          <div className="p-3 border border-accent-info/20 rounded bg-accent-info/5">
            <p className="text-[10px] text-accent-info uppercase tracking-wider mb-1">
              Top Deal
            </p>
            {metrics.topDeal.slug ? (
              <Link
                href={`/company/${metrics.topDeal.slug}`}
                className="text-sm font-medium text-foreground hover:text-accent-info transition-colors truncate block"
              >
                {metrics.topDeal.name}
              </Link>
            ) : (
              <p className="text-sm font-medium text-foreground truncate">
                {metrics.topDeal.name}
              </p>
            )}
            <p className="text-xs text-muted-foreground/70">
              {metrics.topDeal.amount}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
