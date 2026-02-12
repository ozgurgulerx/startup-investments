'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { timeAgo } from '@/lib/news-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimelineEvent {
  id: string;
  event_type: string;
  event_key: string;
  domain: string;
  display_name: string;
  confidence: number;
  effective_date: string;
  detected_at: string;
  event_title: string | null;
  event_content: string | null;
  cluster_id: string | null;
  metadata_json: Record<string, unknown> | null;
  source_type: string;
  region: string;
}

interface TimelineResponse {
  events: TimelineEvent[];
  next_cursor: string | null;
}

interface EventTimelineProps {
  slug: string;
  region?: string;
}

// ---------------------------------------------------------------------------
// Domain display config
// ---------------------------------------------------------------------------

const DOMAIN_LABELS: Record<string, string> = {
  capital: 'Capital',
  product: 'Product',
  architecture: 'Architecture',
  org: 'Organization',
  gtm: 'Go-to-Market',
};

const DOMAIN_COLORS: Record<string, string> = {
  capital: 'border-success/40 text-success',
  product: 'border-accent-info/40 text-accent-info',
  architecture: 'border-delta/40 text-delta',
  org: 'border-warning/40 text-warning',
  gtm: 'border-muted-foreground/40 text-muted-foreground',
};

const DOMAINS = ['capital', 'product', 'architecture', 'org', 'gtm'] as const;

function confidenceLabel(c: number): string {
  if (c >= 0.8) return 'high';
  if (c >= 0.5) return 'medium';
  return 'low';
}

function confidenceClass(c: number): string {
  if (c >= 0.8) return 'text-success';
  if (c >= 0.5) return 'text-warning';
  return 'text-muted-foreground';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EventTimeline({ slug, region }: EventTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounce search input → debouncedQuery
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(searchInput.trim());
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput]);

  const isSearching = debouncedQuery.length > 0;

  const fetchTimeline = useCallback(
    async (cursor?: string | null) => {
      const params = new URLSearchParams({ limit: '30' });
      if (cursor && !isSearching) params.set('cursor', cursor);
      if (domainFilter) params.set('domain', domainFilter);
      if (debouncedQuery) params.set('query', debouncedQuery);
      if (region) params.set('region', region);

      const res = await fetch(
        `/api/v1/startups/${encodeURIComponent(slug)}/timeline?${params}`
      );
      if (!res.ok) return null;
      return res.json() as Promise<TimelineResponse>;
    },
    [slug, region, domainFilter, debouncedQuery, isSearching]
  );

  useEffect(() => {
    setLoading(true);
    setEvents([]);
    setNextCursor(null);
    fetchTimeline()
      .then((data) => {
        if (data) {
          setEvents(data.events);
          setNextCursor(data.next_cursor);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [fetchTimeline]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore || isSearching) return;
    setLoadingMore(true);
    try {
      const data = await fetchTimeline(nextCursor);
      if (data) {
        setEvents((prev) => [...prev, ...data.events]);
        setNextCursor(data.next_cursor);
      }
    } catch { /* noop */ }
    setLoadingMore(false);
  };

  if (loading) {
    return (
      <section className="section">
        <div className="section-header">
          <span className="section-title">Event Timeline</span>
        </div>
        <div className="animate-pulse space-y-3 mt-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-muted/30 rounded" />
          ))}
        </div>
      </section>
    );
  }

  if (events.length === 0 && !loading && !isSearching) return null;

  // Group events by effective_date
  const grouped: Record<string, TimelineEvent[]> = {};
  for (const evt of events) {
    const key = evt.effective_date || 'Unknown';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(evt);
  }
  const dateKeys = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <section className="section">
      <div className="section-header">
        <span className="section-title">Event Timeline</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {isSearching
            ? `${events.length} result${events.length !== 1 ? 's' : ''}`
            : `${events.length} event${events.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Search input */}
      <div className="relative mt-3">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search events..."
          className="w-full rounded border border-border/40 bg-transparent px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-foreground/30 transition-colors"
        />
        {searchInput && (
          <button
            onClick={() => setSearchInput('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs transition-colors"
            aria-label="Clear search"
          >
            &times;
          </button>
        )}
      </div>

      {/* Domain filter chips */}
      <div className="flex flex-wrap gap-1.5 mt-3 mb-4">
        <button
          onClick={() => setDomainFilter(null)}
          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
            !domainFilter
              ? 'border-foreground/40 text-foreground bg-foreground/5'
              : 'border-border/40 text-muted-foreground hover:text-foreground'
          }`}
        >
          All
        </button>
        {DOMAINS.map((d) => (
          <button
            key={d}
            onClick={() => setDomainFilter(domainFilter === d ? null : d)}
            className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
              domainFilter === d
                ? `${DOMAIN_COLORS[d]} bg-current/5`
                : 'border-border/40 text-muted-foreground hover:text-foreground'
            }`}
          >
            {DOMAIN_LABELS[d]}
          </button>
        ))}
      </div>

      {/* Empty search state */}
      {isSearching && events.length === 0 && !loading && (
        <p className="text-xs text-muted-foreground/60 py-4">
          No events found for &ldquo;{debouncedQuery}&rdquo;
        </p>
      )}

      {/* Timeline */}
      <div className="relative pl-4 border-l border-border/30">
        {dateKeys.map((date) => (
          <div key={date} className="mb-4">
            <div className="flex items-center gap-2 mb-2 -ml-4">
              <div className="w-2 h-2 rounded-full bg-border shrink-0" />
              <span className="text-[11px] text-muted-foreground tabular-nums font-medium">
                {date}
              </span>
            </div>
            <div className="space-y-1.5 ml-2">
              {grouped[date].map((evt) => (
                <div
                  key={evt.id}
                  className="flex items-start gap-2 py-1.5 group"
                >
                  <span
                    className={`inline-flex shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${
                      DOMAIN_COLORS[evt.domain] || 'border-border/40 text-muted-foreground'
                    }`}
                  >
                    {DOMAIN_LABELS[evt.domain] || evt.domain}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="text-xs text-foreground/80">
                      {evt.display_name}
                    </span>
                    {evt.event_key && (
                      <span className="ml-1.5 text-[10px] text-muted-foreground">
                        {evt.event_key}
                      </span>
                    )}
                    {evt.event_title && evt.event_title !== evt.display_name && (
                      <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">
                        {evt.event_title}
                      </p>
                    )}
                  </div>
                  <span className={`shrink-0 text-[9px] tabular-nums ${confidenceClass(evt.confidence)}`}>
                    {confidenceLabel(evt.confidence)}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground/50 tabular-nums">
                    {timeAgo(evt.detected_at)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Load more (only in chronological mode) */}
      {nextCursor && !isSearching && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {loadingMore ? 'Loading...' : 'Load older events'}
        </button>
      )}
    </section>
  );
}
