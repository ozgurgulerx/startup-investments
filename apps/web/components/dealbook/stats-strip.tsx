'use client';

import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import type { MonthlyStats, PeriodInfo } from '@startup-intelligence/shared';

interface StatsStripProps {
  stats: MonthlyStats;
  selectedMonth: string;
  availablePeriods: PeriodInfo[];
  isFiltered?: boolean;
  filteredCount?: number;
  filteredFunding?: number;
  className?: string;
}

interface DeltaInfo {
  deals: number;
  funding: number;
  dealsPercent: number;
  fundingPercent: number;
}

export function StatsStrip({
  stats,
  selectedMonth,
  availablePeriods,
  isFiltered = false,
  filteredCount,
  filteredFunding,
  className,
}: StatsStripProps) {
  // Calculate month-over-month delta
  const delta = useMemo((): DeltaInfo | null => {
    if (selectedMonth === 'all') return null;

    // Find previous month
    const sortedPeriods = [...availablePeriods].sort((a, b) => b.period.localeCompare(a.period));
    const currentIndex = sortedPeriods.findIndex(p => p.period === selectedMonth);

    if (currentIndex === -1 || currentIndex >= sortedPeriods.length - 1) {
      return null;
    }

    const prevPeriod = sortedPeriods[currentIndex + 1];
    const currentDeals = stats.deal_summary.total_deals;
    const currentFunding = stats.deal_summary.total_funding_usd;
    const prevDeals = prevPeriod.deal_count;
    const prevFunding = prevPeriod.total_funding;

    if (prevDeals === 0 && prevFunding === 0) return null;

    return {
      deals: currentDeals - prevDeals,
      funding: currentFunding - prevFunding,
      dealsPercent: prevDeals > 0 ? ((currentDeals - prevDeals) / prevDeals) * 100 : 0,
      fundingPercent: prevFunding > 0 ? ((currentFunding - prevFunding) / prevFunding) * 100 : 0,
    };
  }, [selectedMonth, availablePeriods, stats]);

  const totalDeals = isFiltered && filteredCount !== undefined
    ? filteredCount
    : stats.deal_summary.total_deals;

  const totalFunding = isFiltered && filteredFunding !== undefined
    ? filteredFunding
    : stats.deal_summary.total_funding_usd;

  const medianFunding = stats.deal_summary.median_deal_size;

  return (
    <div className={cn(
      'flex items-center gap-4 md:gap-6 py-3 px-4 rounded-lg',
      'bg-card/35 border border-border/35 backdrop-blur-[1px]',
      'text-sm overflow-x-auto',
      className
    )}>
      {/* Deal count */}
      <div className="flex items-center gap-2 whitespace-nowrap">
        <span className="text-muted-foreground">Deals:</span>
        <span className="font-medium">{totalDeals.toLocaleString()}</span>
        {!isFiltered && delta && (
          <DeltaIndicator value={delta.deals} percent={delta.dealsPercent} />
        )}
      </div>

      <Divider />

      {/* Total invested */}
      <div className="flex items-center gap-2 whitespace-nowrap">
        <span className="text-muted-foreground">Invested:</span>
        <span className="font-medium">{formatCurrency(totalFunding, true)}</span>
        {!isFiltered && delta && (
          <DeltaIndicator value={delta.funding} percent={delta.fundingPercent} />
        )}
      </div>

      {/* Median (only show if not filtered and we have the data) */}
      {!isFiltered && medianFunding > 0 && (
        <>
          <Divider />
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="text-muted-foreground">Median:</span>
            <span className="font-medium">{formatCurrency(medianFunding, true)}</span>
          </div>
        </>
      )}

      {/* Period indicator */}
      {selectedMonth === 'all' && (
        <>
          <Divider />
          <div className="flex items-center gap-2 whitespace-nowrap text-muted-foreground">
            <span>All Time</span>
            <span className="text-xs">({availablePeriods.length} months)</span>
          </div>
        </>
      )}
    </div>
  );
}

function Divider() {
  return <div className="w-px h-4 bg-border/50 hidden sm:block" />;
}

interface DeltaIndicatorProps {
  value: number;
  percent: number;
}

function DeltaIndicator({ value, percent }: DeltaIndicatorProps) {
  if (value === 0) {
    return (
      <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" />
        <span>0%</span>
      </span>
    );
  }

  const isPositive = value > 0;
  const Icon = isPositive ? TrendingUp : TrendingDown;
  const colorClass = isPositive ? 'text-success' : 'text-destructive';

  return (
    <span className={cn('flex items-center gap-0.5 text-xs', colorClass)}>
      <Icon className="h-3 w-3" />
      <span>
        {isPositive ? '+' : ''}{Math.round(percent)}%
      </span>
    </span>
  );
}
