'use client';

import { useState, useMemo, useCallback } from 'react';
import { FilterBuilder, type SavedFilter } from '@/components/features';
import { filterStartups, computeFilterStats, type FilterQuery } from '@/lib/data/filtering';
import type { StartupAnalysis, MonthlyStats } from '@startup-intelligence/shared';
import { CompanyRow } from './company-row';
import { formatCurrency } from '@/lib/utils';

interface InteractiveDealbookProps {
  startups: StartupAnalysis[];
  stats: MonthlyStats;
  initialFilters: SavedFilter[];
}

export function InteractiveDealbook({
  startups,
  stats,
  initialFilters,
}: InteractiveDealbookProps) {
  const [activeQuery, setActiveQuery] = useState<FilterQuery>({});
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(initialFilters);

  // Compute available filter options
  const filterStats = useMemo(() => computeFilterStats(startups), [startups]);

  const availablePatterns = useMemo(
    () => Object.keys(filterStats.byPattern).sort((a, b) => filterStats.byPattern[b] - filterStats.byPattern[a]),
    [filterStats.byPattern]
  );

  const availableStages = useMemo(
    () => Object.keys(filterStats.byStage).sort((a, b) => filterStats.byStage[b] - filterStats.byStage[a]),
    [filterStats.byStage]
  );

  const availableContinents = useMemo(
    () => Object.keys(filterStats.byContinent).sort((a, b) => filterStats.byContinent[b] - filterStats.byContinent[a]),
    [filterStats.byContinent]
  );

  // Filter startups based on active query
  const filteredStartups = useMemo(() => {
    const hasFilters = Object.keys(activeQuery).some(
      key => {
        const val = activeQuery[key as keyof FilterQuery];
        return val !== undefined && (Array.isArray(val) ? val.length > 0 : true);
      }
    );

    if (!hasFilters) {
      return [...startups].sort((a, b) => (b.funding_amount || 0) - (a.funding_amount || 0));
    }

    return filterStartups(startups, activeQuery).sort(
      (a, b) => (b.funding_amount || 0) - (a.funding_amount || 0)
    );
  }, [startups, activeQuery]);

  // Calculate filtered totals
  const filteredTotals = useMemo(() => {
    const totalFunding = filteredStartups.reduce((sum, s) => sum + (s.funding_amount || 0), 0);
    const genaiCount = filteredStartups.filter(s => s.uses_genai).length;
    return {
      count: filteredStartups.length,
      funding: totalFunding,
      genaiPct: filteredStartups.length > 0 ? (genaiCount / filteredStartups.length) * 100 : 0,
    };
  }, [filteredStartups]);

  const handleFilterApply = useCallback((query: FilterQuery) => {
    setActiveQuery(query);
  }, []);

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

  const isFiltered = Object.keys(activeQuery).some(
    key => {
      const val = activeQuery[key as keyof FilterQuery];
      return val !== undefined && (Array.isArray(val) ? val.length > 0 : true);
    }
  );

  return (
    <>
      {/* Page Header */}
      <header className="briefing-header">
        <span className="briefing-date">Dealbook</span>
        <h1 className="briefing-headline">
          {isFiltered
            ? `${filteredTotals.count} of ${stats.deal_summary.total_deals} deals match your filters`
            : `${stats.deal_summary.total_deals} deals tracked this period`}
        </h1>
        <p className="briefing-subhead">
          {isFiltered
            ? `${formatCurrency(filteredTotals.funding, true)} across ${filteredTotals.count} matching rounds`
            : `${formatCurrency(stats.deal_summary.total_funding_usd, true)} total capital deployed across ${stats.deal_summary.total_deals} rounds.`}
        </p>
      </header>

      {/* Filter Builder */}
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

      {/* Company List */}
      <div className="space-y-0">
        {filteredStartups.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <p className="text-lg">No deals match your current filters</p>
            <p className="text-sm mt-2">Try adjusting your filter criteria</p>
          </div>
        ) : (
          filteredStartups.map((startup) => (
            <CompanyRow key={startup.company_slug} startup={startup} />
          ))
        )}
      </div>
    </>
  );
}
