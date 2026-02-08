'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FilterBuilder, type SavedFilter } from '@/components/features';
import type { FilterQuery } from '@/lib/data/filtering';
import type { StartupAnalysis, MonthlyStats, PeriodInfo } from '@startup-intelligence/shared';
import { CompanyRow } from './company-row';
import { Sheet, SheetHeader, SheetContent } from '@/components/ui';
import { MonthSelector, DealbookToolbar, StatsStrip } from '@/components/dealbook';
import { normalizeStageKey } from '@/lib/utils';
import { X } from 'lucide-react';
import Link from 'next/link';

/**
 * Resolve a URL slug value (e.g. "series_a") to the canonical display name
 * (e.g. "Series A") by matching against available filter options via normalizeStageKey.
 */
function resolveToCanonical(urlValue: string, availableOptions: string[]): string {
  const normalized = normalizeStageKey(urlValue);
  const match = availableOptions.find(opt => normalizeStageKey(opt) === normalized);
  return match || urlValue;
}

interface UrlFilters {
  stage?: string;
  pattern?: string;
  continent?: string;
  vertical?: string;
  verticalId?: string;
  subVerticalId?: string;
  leafId?: string;
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
  verticals: string[];
  vertical_taxonomy?: {
    verticals: Array<{ id: string; label: string; count: number }>;
    sub_verticals?: Array<{ id: string; label: string; count: number }>;
    leaves?: Array<{ id: string; label: string; count: number }>;
  };
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
  region?: string;
}

const REGION_LABELS: Record<string, string> = {
  global: 'Dealbook',
  turkey: 'Turkey Dealbook',
};

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
  region = 'global',
}: InteractiveDealbookProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeQuery, setActiveQuery] = useState<FilterQuery>({});
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(initialFilters);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);

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

  const availableVerticals = useMemo(
    () => filterOptions?.verticals || [],
    [filterOptions]
  );

  const taxonomyVerticals = useMemo(
    () => filterOptions?.vertical_taxonomy?.verticals || [],
    [filterOptions]
  );
  const taxonomySubVerticals = useMemo(
    () => filterOptions?.vertical_taxonomy?.sub_verticals || [],
    [filterOptions]
  );
  const taxonomyLeaves = useMemo(
    () => filterOptions?.vertical_taxonomy?.leaves || [],
    [filterOptions]
  );

  const taxonomyLabelFor = useCallback((id: string | undefined) => {
    if (!id) return undefined;
    const match =
      taxonomyLeaves.find(o => o.id === id) ||
      taxonomySubVerticals.find(o => o.id === id) ||
      taxonomyVerticals.find(o => o.id === id);
    return match?.label || id;
  }, [taxonomyLeaves, taxonomySubVerticals, taxonomyVerticals]);

  // Initialize activeQuery from URL filters, resolving slugs to canonical display names
  useEffect(() => {
    if (urlFilters) {
      const query: FilterQuery = {};
      if (urlFilters.stage) {
        query.stages = [resolveToCanonical(urlFilters.stage, availableStages)];
      }
      if (urlFilters.pattern) {
        query.patterns = [resolveToCanonical(urlFilters.pattern, availablePatterns)];
      }
      if (urlFilters.continent) {
        query.continents = [resolveToCanonical(urlFilters.continent, availableContinents)];
      }
      if (urlFilters.vertical) {
        query.verticals = [resolveToCanonical(urlFilters.vertical, availableVerticals)];
      }
      if (urlFilters.verticalId) query.verticalId = urlFilters.verticalId;
      if (urlFilters.subVerticalId) query.subVerticalId = urlFilters.subVerticalId;
      if (urlFilters.leafId) query.leafId = urlFilters.leafId;
      if (urlFilters.minFunding) query.fundingMin = urlFilters.minFunding;
      if (urlFilters.maxFunding) query.fundingMax = urlFilters.maxFunding;
      if (urlFilters.usesGenai !== undefined) query.usesGenai = urlFilters.usesGenai;
      setActiveQuery(query);
    }
  }, [urlFilters, availableStages, availablePatterns, availableContinents, availableVerticals]);

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
    // Start from current URL so we preserve non-filter params (search, sort, month, region, etc).
    const params = new URLSearchParams(searchParams.toString());

    // Always reflect the current region prop (single source of truth)
    if (region !== 'global') params.set('region', region);
    else params.delete('region');

    // Remove filter params we manage (we'll re-apply from `query`)
    for (const key of [
      'stage',
      'pattern',
      'continent',
      'vertical',
      'verticalId',
      'subVerticalId',
      'leafId',
      'minFunding',
      'maxFunding',
      'usesGenai',
    ]) {
      params.delete(key);
    }

    if (query.stages?.length === 1) params.set('stage', query.stages[0]);
    if (query.patterns?.length === 1) params.set('pattern', query.patterns[0]);
    if (query.continents?.length === 1) params.set('continent', query.continents[0]);
    if (query.verticals?.length === 1) params.set('vertical', query.verticals[0]);
    if (query.verticalId) params.set('verticalId', query.verticalId);
    if (query.subVerticalId) params.set('subVerticalId', query.subVerticalId);
    if (query.leafId) params.set('leafId', query.leafId);
    if (query.fundingMin) params.set('minFunding', query.fundingMin.toString());
    if (query.fundingMax) params.set('maxFunding', query.fundingMax.toString());
    if (query.usesGenai !== undefined) params.set('usesGenai', query.usesGenai.toString());

    const queryString = params.toString();
    router.push(queryString ? `/dealbook/?${queryString}` : '/dealbook/');
  }, [router, searchParams, region]);

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
    if (urlFilters?.vertical) count++;
    if (urlFilters?.verticalId) count++;
    if (urlFilters?.subVerticalId) count++;
    if (urlFilters?.leafId) count++;
    if (urlFilters?.minFunding || urlFilters?.maxFunding) count++;
    if (urlFilters?.usesGenai !== undefined) count++;
    return count;
  }, [urlFilters]);

  // Active filter badges for URL-based filters (resolved to canonical display names)
  const activeFilterBadges = useMemo(() => {
    const badges: Array<{ label: string; value: string; param: string }> = [];
    if (urlFilters?.search) badges.push({ label: 'Search', value: urlFilters.search, param: 'search' });
    if (urlFilters?.pattern) badges.push({ label: 'Pattern', value: resolveToCanonical(urlFilters.pattern, availablePatterns), param: 'pattern' });
    if (urlFilters?.stage) badges.push({ label: 'Stage', value: resolveToCanonical(urlFilters.stage, availableStages), param: 'stage' });
    if (urlFilters?.continent) badges.push({ label: 'Region', value: resolveToCanonical(urlFilters.continent, availableContinents), param: 'continent' });
    if (urlFilters?.vertical) badges.push({ label: 'Vertical', value: resolveToCanonical(urlFilters.vertical, availableVerticals), param: 'vertical' });
    if (urlFilters?.verticalId) badges.push({ label: 'Industry', value: taxonomyLabelFor(urlFilters.verticalId) || urlFilters.verticalId, param: 'verticalId' });
    if (urlFilters?.subVerticalId) badges.push({ label: 'Sub-vertical', value: taxonomyLabelFor(urlFilters.subVerticalId) || urlFilters.subVerticalId, param: 'subVerticalId' });
    if (urlFilters?.leafId) badges.push({ label: 'Category', value: taxonomyLabelFor(urlFilters.leafId) || urlFilters.leafId, param: 'leafId' });
    if (urlFilters?.usesGenai !== undefined) badges.push({ label: 'GenAI', value: urlFilters.usesGenai ? 'Yes' : 'No', param: 'usesGenai' });
    return badges;
  }, [urlFilters, availablePatterns, availableStages, availableContinents, availableVerticals, taxonomyLabelFor]);

  // Build URL without a specific filter
  const buildUrlWithoutFilter = (paramToRemove: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(paramToRemove);
    params.delete('page'); // Reset to page 1 when filter changes
    const queryString = params.toString();
    return queryString ? `/dealbook/?${queryString}` : '/dealbook/';
  };

  return (
    <>
      {/* Page Header */}
      <header className="briefing-header">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <span className="briefing-date">{REGION_LABELS[region] || 'Dealbook'}</span>
          {selectedMonth && availablePeriods.length > 0 && (
            <MonthSelector
              selectedMonth={selectedMonth}
              availablePeriods={availablePeriods}
            />
          )}
        </div>
        <h1 className="briefing-headline">
          {selectedMonth === 'all'
            ? (isFiltered
              ? `${filteredTotals.count} deals match your filters (all-time)`
              : `${filteredTotals.count} deals in the all-time archive`)
            : (isFiltered
              ? `${filteredTotals.count} of ${stats.deal_summary.total_deals} deals match your filters`
              : `${stats.deal_summary.total_deals} deals tracked this period`)}
        </h1>
      </header>

      {/* Stats Strip with month-over-month delta */}
      {selectedMonth && selectedMonth !== 'all' && availablePeriods.length > 0 && (
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-accent-info/25 bg-accent-info/10 text-accent-info text-sm hover:bg-accent-info/20 transition-colors"
            >
              <span className="text-muted-foreground">{label}:</span>
              <span className="font-medium">{value}</span>
              <X className="h-3.5 w-3.5" />
            </Link>
          ))}
          {activeFilterBadges.length > 1 && (
            <Link
              href={(() => {
                const p = new URLSearchParams();
                if (region !== 'global') p.set('region', region);
                const m = searchParams.get('month');
                if (m) p.set('month', m);
                const qs = p.toString();
                return qs ? `/dealbook/?${qs}` : '/dealbook/';
              })()}
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
          initialQuery={activeQuery}
          availablePatterns={availablePatterns}
          availableStages={availableStages}
          availableContinents={availableContinents}
          availableVerticals={availableVerticals}
          taxonomyVerticals={taxonomyVerticals}
          taxonomySubVerticals={taxonomySubVerticals}
          taxonomyLeaves={taxonomyLeaves}
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
            initialQuery={activeQuery}
            availablePatterns={availablePatterns}
            availableStages={availableStages}
            availableContinents={availableContinents}
            availableVerticals={availableVerticals}
            taxonomyVerticals={taxonomyVerticals}
            taxonomySubVerticals={taxonomySubVerticals}
            taxonomyLeaves={taxonomyLeaves}
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
