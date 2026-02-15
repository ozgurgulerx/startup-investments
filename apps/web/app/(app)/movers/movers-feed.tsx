'use client';

import { useState, useCallback } from 'react';
import type { MoversSummaryResponse, DeltaFeedResponse } from '@/lib/api/types';
import { DeltaCard } from './delta-card';
import { MoversFilters } from './movers-filters';
import { SectorFilter } from '@/components/features/sector-filter';

interface Props {
  initialSummary: MoversSummaryResponse;
  initialFeed: DeltaFeedResponse;
  region: string;
}

async function fetchDeltaFeed(params: {
  region: string;
  delta_type?: string;
  domain?: string;
  sector?: string;
  period?: string;
  limit?: number;
  offset?: number;
}): Promise<DeltaFeedResponse> {
  const qs = new URLSearchParams();
  qs.set('region', params.region);
  if (params.delta_type) qs.set('delta_type', params.delta_type);
  if (params.domain) qs.set('domain', params.domain);
  if (params.sector) qs.set('sector', params.sector);
  if (params.period) qs.set('period', params.period);
  if (params.limit != null) qs.set('limit', String(params.limit));
  if (params.offset != null) qs.set('offset', String(params.offset));

  const res = await fetch(`/api/movers?${qs.toString()}`, { cache: 'no-store' });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(detail || `API returned ${res.status}`);
  }
  return res.json();
}

export function MoversFeed({ initialSummary, initialFeed, region }: Props) {
  const [events, setEvents] = useState(initialFeed.events);
  const [total, setTotal] = useState(initialFeed.total);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<{
    delta_type?: string;
    domain?: string;
    sector?: string;
    period?: string;
  }>({});
  const [loading, setLoading] = useState(false);

  const loadMore = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDeltaFeed({
        region,
        ...filters,
        offset: events.length,
        limit: 25,
      });
      setEvents((prev) => [...prev, ...result.events]);
      setTotal(result.total);
    } catch (err) {
      console.error('Failed to load more movers:', err);
      setError('Failed to load more events.');
    } finally {
      setLoading(false);
    }
  }, [region, filters, events.length]);

  const applyFilters = useCallback(
    async (newFilters: Omit<typeof filters, 'sector'>) => {
      const merged = { ...filters, ...newFilters };
      setFilters(merged);
      setLoading(true);
      setError(null);
      try {
        const result = await fetchDeltaFeed({
          region,
          ...merged,
          offset: 0,
          limit: 25,
        });
        setEvents(result.events);
        setTotal(result.total);
      } catch (err) {
        console.error('Failed to apply movers filters:', err);
        setError('Failed to apply filters.');
      } finally {
        setLoading(false);
      }
    },
    [region, filters],
  );

  const handleSectorChange = useCallback(
    async (sectorId: string | null) => {
      const merged = { ...filters, sector: sectorId || undefined };
      setFilters(merged);
      setLoading(true);
      setError(null);
      try {
        const result = await fetchDeltaFeed({
          region,
          ...merged,
          offset: 0,
          limit: 25,
        });
        setEvents(result.events);
        setTotal(result.total);
      } catch (err) {
        console.error('Failed to apply movers sector filter:', err);
        setError('Failed to apply sector filter.');
      } finally {
        setLoading(false);
      }
    },
    [region, filters],
  );

  return (
    <div>
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="rounded-lg border border-border/40 p-3">
          <div className="text-xs text-muted-foreground">Total Events</div>
          <div className="text-lg font-semibold mt-1">{initialSummary.total}</div>
        </div>
        {Object.entries(initialSummary.by_type)
          .slice(0, 3)
          .map(([type, count]) => (
            <div key={type} className="rounded-lg border border-border/40 p-3">
              <div className="text-xs text-muted-foreground capitalize">
                {type.replace(/_/g, ' ')}
              </div>
              <div className="text-lg font-semibold mt-1">{count}</div>
            </div>
          ))}
      </div>

      {/* Filters */}
      <MoversFilters byType={initialSummary.by_type} onFilter={applyFilters} />
      <div className="mt-2">
        <SectorFilter region={region} value={filters.sector || null} onChange={handleSectorChange} />
      </div>

      {/* Events feed */}
      {error && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="space-y-3 mt-4">
        {events.length === 0 && !loading && (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No events match the current filters.
          </div>
        )}
        {events.map((ev) => (
          <DeltaCard key={ev.id} event={ev} />
        ))}
      </div>

      {/* Load more */}
      {events.length < total && (
        <div className="mt-6 text-center">
          <button
            onClick={loadMore}
            disabled={loading}
            className="px-4 py-2 text-sm border border-border/50 rounded-md hover:bg-muted/30 transition-colors disabled:opacity-50"
          >
            {loading ? 'Loading...' : `Load more (${events.length} of ${total})`}
          </button>
        </div>
      )}
    </div>
  );
}
