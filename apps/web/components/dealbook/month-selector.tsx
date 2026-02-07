'use client';

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import type { PeriodInfo } from '@startup-intelligence/shared';

interface MonthSelectorProps {
  selectedMonth: string;
  availablePeriods: PeriodInfo[];
  className?: string;
}

// Format YYYY-MM to "January 2026"
function formatMonthLabel(period: string): string {
  if (period === 'all') return 'All Time';
  const [year, month] = period.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// Format YYYY-MM to "Jan 2026" (short form)
function formatMonthShort(period: string): string {
  if (period === 'all') return 'All Time';
  const [year, month] = period.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function MonthSelector({
  selectedMonth,
  availablePeriods,
  className,
}: MonthSelectorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Get sorted periods (most recent first)
  const sortedPeriods = useMemo(
    () => [...availablePeriods].sort((a, b) => b.period.localeCompare(a.period)),
    [availablePeriods]
  );

  const latestPeriod = sortedPeriods[0]?.period;

  // Find current index in the sorted list
  const currentIndex = useMemo(() => {
    if (selectedMonth === 'all') return -1;
    return sortedPeriods.findIndex(p => p.period === selectedMonth);
  }, [selectedMonth, sortedPeriods]);

  // Navigate to a month
  const navigateToMonth = useCallback((month: string) => {
    const params = new URLSearchParams(searchParams.toString());

    // Remove page param when switching months
    params.delete('page');

    if (month === latestPeriod) {
      // Default month - don't include in URL
      params.delete('month');
    } else {
      params.set('month', month);
    }

    const queryString = params.toString();
    router.push(queryString ? `/dealbook/?${queryString}` : '/dealbook/');
  }, [router, searchParams, latestPeriod]);

  // Prev/next navigation
  const canGoPrev = currentIndex < sortedPeriods.length - 1;
  const canGoNext = currentIndex > 0 || selectedMonth === 'all';

  const handlePrev = () => {
    if (!canGoPrev) return;
    const prevPeriod = sortedPeriods[currentIndex + 1];
    if (prevPeriod) {
      navigateToMonth(prevPeriod.period);
    }
  };

  const handleNext = () => {
    if (!canGoNext) return;
    if (selectedMonth === 'all') {
      navigateToMonth(latestPeriod);
    } else {
      const nextPeriod = sortedPeriods[currentIndex - 1];
      if (nextPeriod) {
        navigateToMonth(nextPeriod.period);
      }
    }
  };

  // Current period stats
  const currentStats = useMemo(() => {
    if (selectedMonth === 'all') {
      return {
        deal_count: sortedPeriods.reduce((sum, p) => sum + p.deal_count, 0),
        total_funding: sortedPeriods.reduce((sum, p) => sum + p.total_funding, 0),
      };
    }
    return sortedPeriods.find(p => p.period === selectedMonth);
  }, [selectedMonth, sortedPeriods]);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Prev button */}
      <button
        type="button"
        onClick={handlePrev}
        disabled={!canGoPrev}
        aria-label="Previous month"
        className={cn(
          'p-1.5 rounded transition-colors duration-150',
          canGoPrev
            ? 'text-muted-foreground hover:text-foreground hover:bg-muted/35'
            : 'text-muted-foreground/30 cursor-not-allowed'
        )}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {/* Month dropdown */}
      <div className="relative group">
        <button
          type="button"
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded transition-colors duration-150',
            'text-sm font-medium',
            'border border-border/35 bg-card/35 hover:bg-muted/30 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-info/70'
          )}
        >
          <span>{formatMonthLabel(selectedMonth)}</span>
          {selectedMonth === latestPeriod && (
            <span className="text-[10px] uppercase tracking-wider text-accent-info px-1.5 py-0.5 bg-accent-info/10 rounded">
              Latest
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/60 transition-transform duration-150 group-hover:translate-y-0.5">
            ▾
          </span>
        </button>

        {/* Dropdown menu */}
        <div className={cn(
          'absolute top-full left-0 mt-1 z-50',
          'min-w-[220px] max-h-[320px] overflow-y-auto',
          'bg-card/95 backdrop-blur-sm rounded-lg',
          'border border-border/50',
          'shadow-lg shadow-black/20',
          'opacity-0 invisible translate-y-1',
          'group-hover:opacity-100 group-hover:visible group-hover:translate-y-0',
          'transition-all duration-150'
        )}>
          {/* All Time option */}
          <button
            type="button"
            onClick={() => navigateToMonth('all')}
            className={cn(
              'w-full px-3 py-2.5 text-left text-sm',
              'flex items-center justify-between',
              'border-b border-border/30',
              'transition-colors duration-100',
              selectedMonth === 'all'
                ? 'text-foreground bg-muted/30'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/20'
            )}
          >
            <span className="font-medium">All Time</span>
            <span className="text-xs text-muted-foreground">
              {sortedPeriods.reduce((sum, p) => sum + p.deal_count, 0)} deals
            </span>
          </button>

          {/* Monthly options */}
          {sortedPeriods.map((period, index) => {
            const isSelected = period.period === selectedMonth;
            const isLatest = index === 0;

            return (
              <button
                key={period.period}
                type="button"
                onClick={() => navigateToMonth(period.period)}
                className={cn(
                  'w-full px-3 py-2 text-left text-sm',
                  'flex items-center justify-between',
                  'transition-colors duration-100',
                  isSelected
                    ? 'text-foreground bg-muted/30'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/20'
                )}
              >
                <span className="flex items-center gap-2">
                  <span>{formatMonthShort(period.period)}</span>
                  {isLatest && (
                    <span className="text-[9px] uppercase tracking-wider text-accent-info/80">
                      Latest
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground/70">
                  {period.deal_count} deals
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Next button */}
      <button
        type="button"
        onClick={handleNext}
        disabled={!canGoNext}
        aria-label="Next month"
        className={cn(
          'p-1.5 rounded transition-colors duration-150',
          canGoNext
            ? 'text-muted-foreground hover:text-foreground hover:bg-muted/35'
            : 'text-muted-foreground/30 cursor-not-allowed'
        )}
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      {/* Stats summary (hidden on small screens) */}
      {currentStats && (
        <div className="hidden sm:flex items-center gap-3 ml-3 pl-3 border-l border-border/30 text-xs text-muted-foreground">
          <span>{currentStats.deal_count} deals</span>
          <span className="text-border/60">·</span>
          <span>{formatCurrency(currentStats.total_funding, true)}</span>
        </div>
      )}
    </div>
  );
}
