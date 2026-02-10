'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { RefreshCw } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SourceRow {
  source_key: string;
  display_name: string;
  source_type: string;
  base_url: string | null;
  region: string;
  is_active: boolean;
  consecutive_failures: number;
  total_fetches: number;
  total_successes: number;
  last_items_fetched: number;
  last_fetch_duration_ms: number | null;
  last_fetch_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
}

interface SourcesData {
  summary: { total: number; healthy: number; degraded: number; down: number };
  sources: SourceRow[];
  lastRun: {
    started_at: string;
    completed_at: string | null;
    status: string;
    sources_attempted: number;
    items_fetched: number;
    items_kept: number;
    clusters_built: number;
  } | null;
}

interface DomainRow {
  domain: string;
  blocked: boolean;
  block_rate: number;
  consecutive_blocks: number;
  proxy_tier: string;
  render_required: boolean;
  error_rate: number | null;
  consecutive_errors: number | null;
  avg_response_ms: number | null;
  total_requests: number | null;
  successful_requests: number | null;
  stats_last_error_at: string | null;
  stats_updated_at: string | null;
}

interface FrontierData {
  summary: { totalDomains: number; blocked: number; highBlockRate: number; totalUrls: number };
  domains: DomainRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function statusColor(failures: number): string {
  if (failures === 0) return 'text-emerald-400';
  if (failures < 5) return 'text-amber-400';
  return 'text-red-400';
}

function statusDot(failures: number): string {
  if (failures === 0) return 'bg-emerald-400';
  if (failures < 5) return 'bg-amber-400';
  return 'bg-red-400';
}

function statusLabel(failures: number): string {
  if (failures === 0) return 'Healthy';
  if (failures < 5) return 'Degraded';
  return 'Down';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type SortField = 'status' | 'name' | 'type' | 'region' | 'lastFetch' | 'items' | 'duration' | 'failures';

export default function MonitoringPage() {
  const [tab, setTab] = useState<'sources' | 'frontier'>('sources');
  const [sourcesData, setSourcesData] = useState<SourcesData | null>(null);
  const [frontierData, setFrontierData] = useState<FrontierData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [sortField, setSortField] = useState<SortField>('failures');
  const [sortAsc, setSortAsc] = useState(false);

  const fetchData = useCallback(async (type: 'sources' | 'frontier') => {
    try {
      const res = await fetch(`/api/monitoring?type=${type}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e: any) {
      throw new Error(e.message || 'Network error');
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, f] = await Promise.all([fetchData('sources'), fetchData('frontier')]);
      setSourcesData(s);
      setFrontierData(f);
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [fetchData]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(field === 'name');
    }
  };

  const sortedSources = sourcesData?.sources.slice().sort((a, b) => {
    const dir = sortAsc ? 1 : -1;
    switch (sortField) {
      case 'status': return (a.consecutive_failures - b.consecutive_failures) * dir;
      case 'name': return a.display_name.localeCompare(b.display_name) * dir;
      case 'type': return a.source_type.localeCompare(b.source_type) * dir;
      case 'region': return a.region.localeCompare(b.region) * dir;
      case 'lastFetch': return ((a.last_fetch_at || '') > (b.last_fetch_at || '') ? 1 : -1) * dir;
      case 'items': return (a.last_items_fetched - b.last_items_fetched) * dir;
      case 'duration': return ((a.last_fetch_duration_ms || 0) - (b.last_fetch_duration_ms || 0)) * dir;
      case 'failures': return (a.consecutive_failures - b.consecutive_failures) * dir;
      default: return 0;
    }
  });

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border/30">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Crawl Monitoring</h1>
          <p className="text-sm text-muted-foreground">
            Per-source health and frontier domain status
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground/60">
            Updated {relativeTime(lastRefresh.toISOString())}
          </span>
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md
                       bg-card border border-border/40 text-muted-foreground
                       hover:text-foreground hover:border-border transition-colors
                       disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          Failed to load monitoring data: {error}
        </div>
      )}

      {/* Summary Cards */}
      {sourcesData && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="p-4 bg-card border-border/40">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Healthy</div>
            <div className="text-2xl font-bold text-emerald-400 mt-1">{sourcesData.summary.healthy}</div>
            <div className="text-xs text-muted-foreground/60 mt-0.5">0 failures</div>
          </Card>
          <Card className="p-4 bg-card border-border/40">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Degraded</div>
            <div className="text-2xl font-bold text-amber-400 mt-1">{sourcesData.summary.degraded}</div>
            <div className="text-xs text-muted-foreground/60 mt-0.5">1–4 failures</div>
          </Card>
          <Card className="p-4 bg-card border-border/40">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Down</div>
            <div className="text-2xl font-bold text-red-400 mt-1">{sourcesData.summary.down}</div>
            <div className="text-xs text-muted-foreground/60 mt-0.5">5+ failures</div>
          </Card>
          <Card className="p-4 bg-card border-border/40">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Last Ingestion</div>
            <div className="text-lg font-bold text-foreground mt-1">
              {sourcesData.lastRun ? relativeTime(sourcesData.lastRun.started_at) : '—'}
            </div>
            {sourcesData.lastRun && (
              <div className="text-xs text-muted-foreground/60 mt-0.5">
                {sourcesData.lastRun.items_fetched} items / {sourcesData.lastRun.clusters_built} clusters
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border/30">
        <button
          onClick={() => setTab('sources')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'sources'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          News Sources{sourcesData ? ` (${sourcesData.summary.total})` : ''}
        </button>
        <button
          onClick={() => setTab('frontier')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'frontier'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Frontier Domains{frontierData ? ` (${frontierData.summary.totalDomains})` : ''}
        </button>
      </div>

      {/* Sources Tab */}
      {tab === 'sources' && sortedSources && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/30 text-muted-foreground text-xs uppercase tracking-wider">
                <SortHeader field="status" label="Status" current={sortField} asc={sortAsc} onSort={handleSort} />
                <SortHeader field="name" label="Source" current={sortField} asc={sortAsc} onSort={handleSort} />
                <SortHeader field="type" label="Type" current={sortField} asc={sortAsc} onSort={handleSort} />
                <SortHeader field="region" label="Region" current={sortField} asc={sortAsc} onSort={handleSort} />
                <SortHeader field="lastFetch" label="Last Fetch" current={sortField} asc={sortAsc} onSort={handleSort} />
                <SortHeader field="items" label="Items" current={sortField} asc={sortAsc} onSort={handleSort} />
                <SortHeader field="duration" label="Duration" current={sortField} asc={sortAsc} onSort={handleSort} />
                <SortHeader field="failures" label="Failures" current={sortField} asc={sortAsc} onSort={handleSort} />
                <th className="text-left py-2 px-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {sortedSources.map((s) => (
                <tr key={s.source_key} className="border-b border-border/20 hover:bg-card/50">
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${statusDot(s.consecutive_failures)}`} />
                      <span className={`text-xs ${statusColor(s.consecutive_failures)}`}>
                        {statusLabel(s.consecutive_failures)}
                      </span>
                    </div>
                  </td>
                  <td className="py-2 px-2">
                    <div className="font-medium text-foreground">{s.display_name}</div>
                    <div className="text-xs text-muted-foreground/60">{s.source_key}</div>
                  </td>
                  <td className="py-2 px-2">
                    <span className="px-1.5 py-0.5 text-xs rounded bg-muted/50 text-muted-foreground">
                      {s.source_type}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-muted-foreground">{s.region}</td>
                  <td className="py-2 px-2 text-muted-foreground">{relativeTime(s.last_fetch_at)}</td>
                  <td className="py-2 px-2 text-muted-foreground tabular-nums">{s.last_items_fetched}</td>
                  <td className="py-2 px-2 text-muted-foreground tabular-nums">
                    {s.last_fetch_duration_ms != null ? `${(s.last_fetch_duration_ms / 1000).toFixed(1)}s` : '—'}
                  </td>
                  <td className="py-2 px-2">
                    <span className={`tabular-nums font-medium ${statusColor(s.consecutive_failures)}`}>
                      {s.consecutive_failures}
                    </span>
                    {s.total_fetches > 0 && (
                      <span className="text-xs text-muted-foreground/50 ml-1">
                        ({Math.round((s.total_successes / s.total_fetches) * 100)}%)
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2 max-w-[200px]">
                    {s.last_error && (
                      <span className="text-xs text-muted-foreground/60 line-clamp-1" title={s.last_error}>
                        {s.last_error.slice(0, 80)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Frontier Tab */}
      {tab === 'frontier' && frontierData && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4 bg-card border-border/40">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Domains</div>
              <div className="text-2xl font-bold text-foreground mt-1">{frontierData.summary.totalDomains}</div>
            </Card>
            <Card className="p-4 bg-card border-border/40">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Blocked</div>
              <div className="text-2xl font-bold text-red-400 mt-1">{frontierData.summary.blocked}</div>
            </Card>
            <Card className="p-4 bg-card border-border/40">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">High Block Rate</div>
              <div className="text-2xl font-bold text-amber-400 mt-1">{frontierData.summary.highBlockRate}</div>
              <div className="text-xs text-muted-foreground/60 mt-0.5">&gt;50% blocked</div>
            </Card>
            <Card className="p-4 bg-card border-border/40">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Total URLs</div>
              <div className="text-2xl font-bold text-foreground mt-1">
                {frontierData.summary.totalUrls.toLocaleString()}
              </div>
            </Card>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/30 text-muted-foreground text-xs uppercase tracking-wider">
                  <th className="text-left py-2 px-2">Domain</th>
                  <th className="text-left py-2 px-2">Status</th>
                  <th className="text-left py-2 px-2">Block Rate</th>
                  <th className="text-left py-2 px-2">Error Rate</th>
                  <th className="text-right py-2 px-2">Requests</th>
                  <th className="text-right py-2 px-2">Avg Response</th>
                  <th className="text-left py-2 px-2">Proxy</th>
                </tr>
              </thead>
              <tbody>
                {frontierData.domains.map((d) => (
                  <tr key={d.domain} className="border-b border-border/20 hover:bg-card/50">
                    <td className="py-2 px-2 font-medium text-foreground">
                      {d.domain}
                      {d.render_required && (
                        <span className="ml-1 text-xs text-muted-foreground/50">JS</span>
                      )}
                    </td>
                    <td className="py-2 px-2">
                      {d.blocked ? (
                        <span className="px-1.5 py-0.5 text-xs rounded bg-red-500/15 text-red-400">blocked</span>
                      ) : d.block_rate > 0.5 ? (
                        <span className="px-1.5 py-0.5 text-xs rounded bg-amber-500/15 text-amber-400">degraded</span>
                      ) : (
                        <span className="px-1.5 py-0.5 text-xs rounded bg-emerald-500/15 text-emerald-400">ok</span>
                      )}
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              d.block_rate > 0.5 ? 'bg-red-400' : d.block_rate > 0.2 ? 'bg-amber-400' : 'bg-emerald-400'
                            }`}
                            style={{ width: `${Math.min(d.block_rate * 100, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {(d.block_rate * 100).toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-2 px-2 text-muted-foreground tabular-nums">
                      {d.error_rate != null ? `${(d.error_rate * 100).toFixed(0)}%` : '—'}
                    </td>
                    <td className="py-2 px-2 text-right text-muted-foreground tabular-nums">
                      {d.total_requests ?? 0}
                    </td>
                    <td className="py-2 px-2 text-right text-muted-foreground tabular-nums">
                      {d.avg_response_ms != null ? `${d.avg_response_ms}ms` : '—'}
                    </td>
                    <td className="py-2 px-2">
                      <span className="px-1.5 py-0.5 text-xs rounded bg-muted/50 text-muted-foreground">
                        {d.proxy_tier}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Loading state for initial load */}
      {loading && !sourcesData && !error && (
        <div className="animate-pulse space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 bg-muted rounded" />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sort header component
// ---------------------------------------------------------------------------

function SortHeader({
  field,
  label,
  current,
  asc,
  onSort,
}: {
  field: SortField;
  label: string;
  current: SortField;
  asc: boolean;
  onSort: (f: SortField) => void;
}) {
  const active = current === field;
  return (
    <th
      className="text-left py-2 px-2 cursor-pointer select-none hover:text-foreground transition-colors"
      onClick={() => onSort(field)}
    >
      {label}
      {active && <span className="ml-0.5">{asc ? '↑' : '↓'}</span>}
    </th>
  );
}
