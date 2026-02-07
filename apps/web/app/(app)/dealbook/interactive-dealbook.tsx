'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FilterBuilder, type SavedFilter } from '@/components/features';
import type { FilterQuery } from '@/lib/data/filtering';
import type { StartupAnalysis, MonthlyStats, PeriodInfo } from '@startup-intelligence/shared';
import { CompanyRow } from './company-row';
import { Sheet, SheetHeader, SheetContent } from '@/components/ui';
import { MonthSelector, DealbookToolbar, StatsStrip } from '@/components/dealbook';
import { X } from 'lucide-react';
import Link from 'next/link';

interface UrlFilters {
  stage?: string;
  pattern?: string;
  continent?: string;
  minFunding?: number;
  maxFunding?: number;
  usesGenai?: boolean;
  search?: string;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface FilterOptions {
  stages: string[];
  continents: string[];
  patterns: Array<{ name: string; count: number }>;
}

interface InteractiveDealbookProps {
  startups: StartupAnalysis[];
  stats: MonthlyStats;
  initialFilters: SavedFilter[];
  filterOptions?: FilterOptions;
  urlFilters?: UrlFilters;
  pagination?: PaginationInfo;
  hasUrlFilters?: boolean;
  selectedMonth?: string;
  availablePeriods?: PeriodInfo[];
}

export function InteractiveDealbook({
  startups,
  stats,
  initialFilters,
  filterOptions,
  urlFilters,
  pagination,
  hasUrlFilters = false,
  selectedMonth,
  availablePeriods = [],
}: InteractiveDealbookProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeQuery, setActiveQuery] = useState<FilterQuery>({});
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(initialFilters);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);

  // Initialize activeQuery from URL filters
  useEffect(() => {
    if (urlFilters) {
      const query: FilterQuery = {};
      if (urlFilters.stage) query.stages = [urlFilters.stage];
      if (urlFilters.pattern) query.patterns = [urlFilters.pattern];
      if (urlFilters.continent) query.continents = [urlFilters.continent];
      if (urlFilters.minFunding) query.fundingMin = urlFilters.minFunding;
      if (urlFilters.maxFunding) query.fundingMax = urlFilters.maxFunding;
      if (urlFilters.usesGenai !== undefined) query.usesGenai = urlFilters.usesGenai;
      setActiveQuery(query);
    }
  }, [urlFilters]);

  // Use server-provided filter options (no client-side computation needed)
  const availablePatterns = useMemo(
    () => filterOptions?.patterns.map(p => p.name) || [],
    [filterOptions]
  );

  const availableStages = useMemo(
    () => filterOptions?.stages || [],
    [filterOptions]
  );

  const availableContinents = useMemo(
    () => filterOptions?.continents || [],
    [filterOptions]
  );

  // Calculate totals - use pagination total if available (server-side filtered)
  const filteredTotals = useMemo(() => {
    const total = pagination?.total ?? startups.length;
    const totalFunding = startups.reduce((sum, s) => sum + (s.funding_amount || 0), 0);
    const genaiCount = startups.filter(s => s.uses_genai).length;
    return {
      count: total,
      funding: totalFunding,
      genaiPct: startups.length > 0 ? (genaiCount / startups.length) * 100 : 0,
    };
  }, [startups, pagination]);

  // Update URL when filter changes (for client-side filtering)
  const updateUrlWithFilters = useCallback((query: FilterQuery) => {
    const params = new URLSearchParams();

    // Preserve the month parameter if it's set (non-default)
    const currentMonth = searchParams.get('month');
    if (currentMonth) params.set('month', currentMonth);

    if (query.stages?.length === 1) params.set('stage', query.stages[0]);
    if (query.patterns?.length === 1) params.set('pattern', query.patterns[0]);
    if (query.continents?.length === 1) params.set('continent', query.continents[0]);
    if (query.fundingMin) params.set('minFunding', query.fundingMin.toString());
    if (query.fundingMax) params.set('maxFunding', query.fundingMax.toString());
    if (query.usesGenai !== undefined) params.set('usesGenai', query.usesGenai.toString());

    const queryString = params.toString();
    router.push(queryString ? `/dealbook?${queryString}` : '/dealbook');
  }, [router, searchParams]);

  const handleFilterApply = useCallback((query: FilterQuery) => {
    setActiveQuery(query);
    // Update URL to reflect filters (enables bookmarking and sharing)
    updateUrlWithFilters(query);
  }, [updateUrlWithFilters]);

  const handleFilterSave = useCallback(async (name: string, query: FilterQuery, alertsEnabled: boolean) => {
    try {
      const response = await fetch('/api/filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, query, alertsEnabled }),
      });

      if (!response.ok) throw new Error('Failed to save filter');

      const data = await response.json();
      setSavedFilters(prev => [...prev, data.filter]);
    } catch (error) {
      console.error('Error saving filter:', error);
      throw error;
    }
  }, []);

  const handleFilterDelete = useCallback(async (filterId: string) => {
    try {
      const response = await fetch(`/api/filters/${filterId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete filter');

      setSavedFilters(prev => prev.filter(f => f.id !== filterId));
    } catch (error) {
      console.error('Error deleting filter:', error);
      throw error;
    }
  }, []);

  const handleFilterToggleAlerts = useCallback(async (filterId: string, enabled: boolean) => {
    try {
      const response = await fetch(`/api/filters/${filterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertsEnabled: enabled }),
      });

      if (!response.ok) throw new Error('Failed to update filter');

      setSavedFilters(prev =>
        prev.map(f => (f.id === filterId ? { ...f, alertsEnabled: enabled } : f))
      );
    } catch (error) {
      console.error('Error updating filter:', error);
      throw error;
    }
  }, []);

  const isFiltered = hasUrlFilters || Object.keys(activeQuery).some(
    key => {
      const val = activeQuery[key as keyof FilterQuery];
      return val !== undefined && (Array.isArray(val) ? val.length > 0 : true);
    }
  );

  // Count active filters for mobile badge
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (urlFilters?.stage) count++;
    if (urlFilters?.pattern) count++;
    if (urlFilters?.continent) count++;
    if (urlFilters?.minFunding || urlFilters?.maxFunding) count++;
    if (urlFilters?.usesGenai !== undefined) count++;
    return count;
  }, [urlFilters]);

  // Active filter badges for URL-based filters
  const activeFilterBadges = useMemo(() => {
    const badges: Array<{ label: string; value: string; param: string }> = [];
    if (urlFilters?.pattern) badges.push({ label: 'Pattern', value: urlFilters.pattern, param: 'pattern' });
    if (urlFilters?.stage) badges.push({ label: 'Stage', value: urlFilters.stage, param: 'stage' });
    if (urlFilters?.continent) badges.push({ label: 'Region', value: urlFilters.continent, param: 'continent' });
    if (urlFilters?.usesGenai !== undefined) badges.push({ label: 'GenAI', value: urlFilters.usesGenai ? 'Yes' : 'No', param: 'usesGenai' });
    return badges;
  }, [urlFilters]);

  // Build URL without a specific filter
  const buildUrlWithoutFilter = (paramToRemove: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(paramToRemove);
    params.delete('page'); // Reset to page 1 when filter changes
    const queryString = params.toString();
    return queryString ? `/dealbook?${queryString}` : '/dealbook';
  };

  return (
    <>
      {/* Page Header */}
      <header className="briefing-header">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <span className="briefing-date">Dealbook</span>
          {selectedMonth && availablePeriods.length > 0 && (
            <MonthSelector
              selectedMonth={selectedMonth}
              availablePeriods={availablePeriods}
            />
          )}
        </div>
        <h1 className="briefing-headline">
          {isFiltered
            ? `${filteredTotals.count} of ${stats.deal_summary.total_deals} deals match your filters`
            : `${stats.deal_summary.total_deals} deals tracked this period`}
        </h1>
      </header>

      {/* Stats Strip with month-over-month delta */}
      {selectedMonth && availablePeriods.length > 0 && (
        <StatsStrip
          stats={stats}
          selectedMonth={selectedMonth}
          availablePeriods={availablePeriods}
          isFiltered={isFiltered}
          filteredCount={filteredTotals.count}
          filteredFunding={filteredTotals.funding}
          className="mb-4"
        />
      )}

      {/* Toolbar with search and sort */}
      <DealbookToolbar
        onOpenFilters={() => setIsFilterSheetOpen(true)}
        activeFilterCount={activeFilterCount}
        className="mb-4"
      />

      {/* Active URL Filter Badges */}
      {activeFilterBadges.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {activeFilterBadges.map(({ label, value, param }) => (
            <Link
              key={param}
              href={buildUrlWithoutFilter(param)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-accent/25 bg-accent/10 text-accent text-sm hover:bg-accent/20 transition-colors"
            >
              <span className="text-muted-foreground">{label}:</span>
              <span className="font-medium">{value}</span>
              <X className="h-3.5 w-3.5" />
            </Link>
          ))}
          {activeFilterBadges.length > 1 && (
            <Link
              href={searchParams.get('month') ? `/dealbook?month=${searchParams.get('month')}` : '/dealbook'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/40 bg-muted/30 text-muted-foreground text-sm hover:bg-muted/50 transition-colors"
            >
              Clear all
            </Link>
          )}
        </div>
      )}

      {/* Filter Builder - Desktop */}
      <div className="hidden md:block">
        <FilterBuilder
          availablePatterns={availablePatterns}
          availableStages={availableStages}
          availableContinents={availableContinents}
          savedFilters={savedFilters}
          onFilterApply={handleFilterApply}
          onFilterSave={handleFilterSave}
          onFilterDelete={handleFilterDelete}
          onFilterToggleAlerts={handleFilterToggleAlerts}
          className="mb-6"
        />
      </div>

      {/* Filter Sheet - Mobile */}
      <Sheet open={isFilterSheetOpen} onOpenChange={setIsFilterSheetOpen}>
        <SheetHeader onClose={() => setIsFilterSheetOpen(false)}>
          Filters
        </SheetHeader>
        <SheetContent>
          <FilterBuilder
            availablePatterns={availablePatterns}
            availableStages={availableStages}
            availableContinents={availableContinents}
            savedFilters={savedFilters}
            onFilterApply={(query) => {
              handleFilterApply(query);
              setIsFilterSheetOpen(false);
            }}
            onFilterSave={handleFilterSave}
            onFilterDelete={handleFilterDelete}
            onFilterToggleAlerts={handleFilterToggleAlerts}
          />
        </SheetContent>
      </Sheet>

      {/* Company List */}
      <div className="space-y-0 rounded-xl border border-border/35 bg-card/35 backdrop-blur-[1px] overflow-hidden">
        {startups.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <p className="text-lg">No deals match your current filters</p>
            <p className="text-sm mt-2">Try adjusting your filter criteria</p>
          </div>
        ) : (
          startups.map((startup) => (
            <CompanyRow key={startup.company_slug} startup={startup} />
          ))
        )}
      </div>
    </>
  );
}
