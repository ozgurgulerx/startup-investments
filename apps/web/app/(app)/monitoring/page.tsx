'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { RefreshCw, X } from 'lucide-react';

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
  summary: {
    totalDomains: number;
    blocked: number;
    highBlockRate: number;
    totalUrls: number;
    totalQueue?: number;
    dueQueue?: number;
    leasedQueue?: number;
    staleLeases?: number;
    dueAgeP50Minutes?: number;
    dueAgeP95Minutes?: number;
    runSuccessRate24h?: number;
    crawledUrls?: number;
    neverCrawled?: number;
    crawledPct?: number;
    minsSinceLatestCrawl?: number | null;
  };
  queue?: {
    total: number;
    due: number;
    leased: number;
    staleLeases: number;
    dueAgeP50Seconds: number;
    dueAgeP95Seconds: number;
  };
  urls?: {
    total: number;
    crawled: number;
    neverCrawled: number;
    crawledPct: number;
    minsSinceLatestCrawl: number | null;
    hoursSinceOldestCrawl: number | null;
  };
  runs24h?: {
    mode: 'crawl_logs' | 'frontier_urls';
    totalAttempts: number;
    success: number;
    failed: number;
    blocked: number;
    successRatePct: number;
    avgDurationMs: number;
    p95DurationMs: number;
  };
  http24h?: {
    status2xx: number;
    status304: number;
    status4xx: number;
    status5xx: number;
  };
  domains: DomainRow[];
}

interface ReviewCluster {
  id: string;
  cluster_key: string;
  title: string;
  summary: string | null;
  story_type: string | null;
  topic_tags: string[];
  entities: string[];
  rank_score: number;
  trust_score: number;
  published_at: string;
  region: string;
  gating_decision: string | null;
  composite_score: number | null;
  decision_reason: string | null;
  upvote_count: number | null;
  save_count: number | null;
  not_useful_count: number | null;
  editorial_action: string | null;
  reason_category: string | null;
  action_at: string | null;
  source_key: string | null;
  source_name: string | null;
}

interface EditorialRule {
  id: string;
  rule_type: string;
  region: string;
  rule_value: string;
  rule_weight: number;
  is_active: boolean;
  is_auto_generated: boolean;
  supporting_action_count: number;
  confidence: number | null;
  approved_at: string | null;
  expires_at: string | null;
  created_at: string;
  notes: string | null;
}

interface EditorialStats {
  period_days: number;
  total_reviewed: number;
  actions: Record<string, number>;
  rejection_rate: number;
  total_clusters: number;
  pending_rules: number;
  active_rules: number;
  by_reason: { reason_category: string; cnt: number }[];
  by_source: { source_key: string; cnt: number }[];
}

const REASON_CATEGORIES = [
  'irrelevant_topic', 'not_startup', 'consumer_noise', 'duplicate',
  'low_quality_source', 'spam', 'off_region', 'big_tech_noise',
  'domain_chatter', 'other',
] as const;

const RULE_TYPES = [
  'keyword_exclude', 'domain_exclude', 'source_downweight',
  'topic_exclude', 'entity_exclude', 'title_pattern_exclude',
] as const;

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
  if (failures === 0) return 'text-success';
  if (failures < 5) return 'text-warning';
  return 'text-destructive';
}

function statusDot(failures: number): string {
  if (failures === 0) return 'bg-success';
  if (failures < 5) return 'bg-warning';
  return 'bg-destructive';
}

function statusLabel(failures: number): string {
  if (failures === 0) return 'Healthy';
  if (failures < 5) return 'Degraded';
  return 'Down';
}

function gatingBadge(decision: string | null) {
  if (!decision) return null;
  const colors: Record<string, string> = {
    publish: 'bg-success/15 text-success',
    borderline: 'bg-warning/15 text-warning',
    watchlist: 'bg-accent-info/15 text-accent-info',
    accumulate: 'bg-muted/50 text-muted-foreground',
    drop: 'bg-destructive/15 text-destructive',
  };
  return (
    <span className={`px-1.5 py-0.5 text-xs rounded ${colors[decision] || 'bg-muted/50 text-muted-foreground'}`}>
      {decision}
    </span>
  );
}

function extractKeywordsFromTitle(title: string): string[] {
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'it', 'its', 'as', 'not', 'no', 'new', 'how', 'why', 'what', 'who', 'when', 'where']);
  return title.toLowerCase().split(/\s+/)
    .map(w => w.replace(/[^a-z0-9-]/g, ''))
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 10);
}

function formatMinutes(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (value < 60) return `${value.toFixed(0)}m`;
  const hours = value / 60;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type SortField = 'status' | 'name' | 'type' | 'region' | 'lastFetch' | 'items' | 'duration' | 'failures';

export default function MonitoringPage() {
  const [tab, setTab] = useState<'sources' | 'frontier' | 'editorial'>('sources');
  const [sourcesData, setSourcesData] = useState<SourcesData | null>(null);
  const [frontierData, setFrontierData] = useState<FrontierData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [sortField, setSortField] = useState<SortField>('failures');
  const [sortAsc, setSortAsc] = useState(false);

  // Editorial state
  const [reviewClusters, setReviewClusters] = useState<ReviewCluster[]>([]);
  const [editorialRules, setEditorialRules] = useState<EditorialRule[]>([]);
  const [editorialStats, setEditorialStats] = useState<EditorialStats | null>(null);
  const [editorialLoading, setEditorialLoading] = useState(false);
  const [editorialRegion, setEditorialRegion] = useState<'global' | 'turkey'>('global');
  const [showRules, setShowRules] = useState(false);

  // Reject modal state
  const [rejectTarget, setRejectTarget] = useState<ReviewCluster | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('irrelevant_topic');
  const [rejectText, setRejectText] = useState('');
  const [rejectKeywords, setRejectKeywords] = useState<string[]>([]);
  const [actionLoading, setActionLoading] = useState(false);

  // Add rule modal state
  const [showAddRule, setShowAddRule] = useState(false);
  const [newRuleType, setNewRuleType] = useState<string>('keyword_exclude');
  const [newRuleValue, setNewRuleValue] = useState('');
  const [newRuleWeight, setNewRuleWeight] = useState('1.0');
  const [newRuleNotes, setNewRuleNotes] = useState('');

  const fetchData = useCallback(async (type: 'sources' | 'frontier') => {
    try {
      const res = await fetch(`/api/monitoring?type=${type}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e: any) {
      throw new Error(e.message || 'Network error');
    }
  }, []);

  const fetchEditorial = useCallback(async (region: string) => {
    setEditorialLoading(true);
    try {
      const [reviewRes, rulesRes, statsRes] = await Promise.all([
        fetch(`/api/editorial?path=review&region=${region}`),
        fetch(`/api/editorial?path=rules&region=${region}&include_pending=true`),
        fetch(`/api/editorial?path=stats&region=${region}&days=7`),
      ]);
      if (reviewRes.ok) {
        const data = await reviewRes.json();
        setReviewClusters(data.clusters || []);
      }
      if (rulesRes.ok) {
        const data = await rulesRes.json();
        setEditorialRules(data.rules || []);
      }
      if (statsRes.ok) {
        setEditorialStats(await statsRes.json());
      }
    } catch (e: any) {
      console.error('Editorial fetch error:', e);
    } finally {
      setEditorialLoading(false);
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

  useEffect(() => {
    if (tab === 'editorial') {
      fetchEditorial(editorialRegion);
    }
  }, [tab, editorialRegion, fetchEditorial]);

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

  // --- Editorial actions ---

  const openRejectModal = (cluster: ReviewCluster) => {
    setRejectTarget(cluster);
    setRejectReason('irrelevant_topic');
    setRejectText('');
    setRejectKeywords(extractKeywordsFromTitle(cluster.title || ''));
  };

  const submitAction = async (clusterId: string, action: string, extra?: {
    reason_category?: string;
    reason_text?: string;
    title_keywords?: string[];
  }) => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/editorial?path=actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cluster_id: clusterId, action, ...extra }),
      });
      if (res.ok) {
        // Update local state
        setReviewClusters(prev => prev.map(c =>
          c.id === clusterId ? { ...c, editorial_action: action, reason_category: extra?.reason_category || null } : c
        ));
        setRejectTarget(null);
      }
    } catch (e) {
      console.error('Action error:', e);
    } finally {
      setActionLoading(false);
    }
  };

  const approveRule = async (ruleId: string) => {
    try {
      const res = await fetch('/api/editorial?path=rules/' + ruleId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved_at: 'now' }),
      });
      if (res.ok) {
        setEditorialRules(prev => prev.map(r =>
          r.id === ruleId ? { ...r, approved_at: new Date().toISOString() } : r
        ));
      }
    } catch (e) {
      console.error('Approve rule error:', e);
    }
  };

  const deactivateRule = async (ruleId: string) => {
    try {
      const res = await fetch('/api/editorial?path=rules/' + ruleId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false }),
      });
      if (res.ok) {
        setEditorialRules(prev => prev.filter(r => r.id !== ruleId));
      }
    } catch (e) {
      console.error('Deactivate rule error:', e);
    }
  };

  const submitNewRule = async () => {
    try {
      const res = await fetch('/api/editorial?path=rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule_type: newRuleType,
          region: editorialRegion,
          rule_value: newRuleValue,
          rule_weight: parseFloat(newRuleWeight),
          notes: newRuleNotes || undefined,
        }),
      });
      if (res.ok) {
        setShowAddRule(false);
        setNewRuleValue('');
        setNewRuleNotes('');
        fetchEditorial(editorialRegion);
      }
    } catch (e) {
      console.error('Add rule error:', e);
    }
  };

  const removeKeyword = (kw: string) => setRejectKeywords(prev => prev.filter(k => k !== kw));
  const addKeyword = (kw: string) => {
    if (kw && !rejectKeywords.includes(kw)) setRejectKeywords(prev => [...prev, kw]);
  };

  const pendingRulesCount = editorialRules.filter(r => r.is_auto_generated && !r.approved_at).length;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border/30">
        <div>
          <p className="label-xs text-accent-info">Crawl Monitoring</p>
          <h1 className="headline-lg">Per-source health and frontier domain status</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground/60">
            Updated {relativeTime(lastRefresh.toISOString())}
          </span>
          <button
            onClick={() => { refresh(); if (tab === 'editorial') fetchEditorial(editorialRegion); }}
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
        <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          Failed to load monitoring data: {error}
        </div>
      )}

      {/* Summary Cards */}
      {sourcesData && tab !== 'editorial' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="p-4 bg-card border-border/40">
            <div className="label-xs">Healthy</div>
            <div className="text-2xl font-light text-success mt-1">{sourcesData.summary.healthy}</div>
            <div className="text-xs text-muted-foreground/60 mt-0.5">0 failures</div>
          </Card>
          <Card className="p-4 bg-card border-border/40">
            <div className="label-xs">Degraded</div>
            <div className="text-2xl font-light text-warning mt-1">{sourcesData.summary.degraded}</div>
            <div className="text-xs text-muted-foreground/60 mt-0.5">1–4 failures</div>
          </Card>
          <Card className="p-4 bg-card border-border/40">
            <div className="label-xs">Down</div>
            <div className="text-2xl font-light text-destructive mt-1">{sourcesData.summary.down}</div>
            <div className="text-xs text-muted-foreground/60 mt-0.5">5+ failures</div>
          </Card>
          <Card className="p-4 bg-card border-border/40">
            <div className="label-xs">Last Ingestion</div>
            <div className="text-lg font-light text-foreground mt-1">
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
      <div className="flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/15 p-0.5 w-fit">
        <button
          onClick={() => setTab('sources')}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === 'sources'
              ? 'text-accent-info bg-accent-info/10 border border-accent-info/25'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/25 border border-transparent'
          }`}
        >
          News Sources{sourcesData ? ` (${sourcesData.summary.total})` : ''}
        </button>
        <button
          onClick={() => setTab('frontier')}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === 'frontier'
              ? 'text-accent-info bg-accent-info/10 border border-accent-info/25'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/25 border border-transparent'
          }`}
        >
          Frontier Domains{frontierData ? ` (${frontierData.summary.totalDomains})` : ''}
        </button>
        <button
          onClick={() => setTab('editorial')}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors relative ${
            tab === 'editorial'
              ? 'text-accent-info bg-accent-info/10 border border-accent-info/25'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/25 border border-transparent'
          }`}
        >
          Editorial
          {pendingRulesCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 text-[10px] flex items-center justify-center rounded-full bg-warning text-warning-foreground">
              {pendingRulesCount}
            </span>
          )}
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
              <div className="label-xs">Domains</div>
              <div className="text-2xl font-light text-foreground mt-1">{frontierData.summary.totalDomains}</div>
            </Card>
            <Card className="p-4 bg-card border-border/40">
              <div className="label-xs">Blocked</div>
              <div className="text-2xl font-light text-destructive mt-1">{frontierData.summary.blocked}</div>
            </Card>
            <Card className="p-4 bg-card border-border/40">
              <div className="label-xs">High Block Rate</div>
              <div className="text-2xl font-light text-warning mt-1">{frontierData.summary.highBlockRate}</div>
              <div className="text-xs text-muted-foreground/60 mt-0.5">&gt;50% blocked</div>
            </Card>
            <Card className="p-4 bg-card border-border/40">
              <div className="label-xs">Queue Due</div>
              <div className="text-2xl font-light text-foreground mt-1">
                {(frontierData.summary.dueQueue ?? frontierData.queue?.due ?? 0).toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground/60 mt-0.5">
                total {(frontierData.summary.totalQueue ?? frontierData.queue?.total ?? 0).toLocaleString()}
                {frontierData.queue ? ` • stale ${frontierData.queue.staleLeases}` : ''}
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4 bg-card border-border/40">
              <div className="label-xs">Total URLs</div>
              <div className="text-2xl font-light text-foreground mt-1">
                {(frontierData.urls?.total ?? frontierData.summary.totalUrls ?? 0).toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground/60 mt-0.5">
                never crawled {(frontierData.urls?.neverCrawled ?? frontierData.summary.neverCrawled ?? 0).toLocaleString()}
              </div>
            </Card>
            <Card className="p-4 bg-card border-border/40">
              <div className="label-xs">Crawled %</div>
              <div className="text-2xl font-light text-accent-info mt-1">
                {((frontierData.urls?.crawledPct ?? frontierData.summary.crawledPct ?? 0)).toFixed(1)}%
              </div>
              <div className="text-xs text-muted-foreground/60 mt-0.5">
                {(() => {
                  const latest = formatMinutes(frontierData.urls?.minsSinceLatestCrawl ?? frontierData.summary.minsSinceLatestCrawl);
                  return latest === '—' ? 'latest —' : `latest ${latest} ago`;
                })()}
              </div>
            </Card>
            <Card className="p-4 bg-card border-border/40">
              <div className="label-xs">Due Age (p95)</div>
              <div className="text-2xl font-light text-foreground mt-1">
                {formatMinutes(frontierData.summary.dueAgeP95Minutes)}
              </div>
              <div className="text-xs text-muted-foreground/60 mt-0.5">
                p50 {formatMinutes(frontierData.summary.dueAgeP50Minutes)}
              </div>
            </Card>
            <Card className="p-4 bg-card border-border/40">
              <div className="label-xs">Runs (24h)</div>
              <div className="text-2xl font-light text-success mt-1">
                {frontierData.runs24h ? `${frontierData.runs24h.successRatePct.toFixed(1)}%` : '—'}
              </div>
              {frontierData.runs24h && (
                <div className="text-xs text-muted-foreground/60 mt-0.5">
                  {frontierData.runs24h.success}/{frontierData.runs24h.totalAttempts} success
                  {frontierData.runs24h.blocked > 0 ? ` • ${frontierData.runs24h.blocked} blocked` : ''}
                  {frontierData.runs24h.mode ? ` • ${frontierData.runs24h.mode}` : ''}
                </div>
              )}
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
                        <span className="px-1.5 py-0.5 text-xs rounded bg-destructive/15 text-destructive">blocked</span>
                      ) : d.block_rate > 0.5 ? (
                        <span className="px-1.5 py-0.5 text-xs rounded bg-warning/15 text-warning">degraded</span>
                      ) : (
                        <span className="px-1.5 py-0.5 text-xs rounded bg-success/15 text-success">ok</span>
                      )}
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              d.block_rate > 0.5 ? 'bg-destructive' : d.block_rate > 0.2 ? 'bg-warning' : 'bg-success'
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

      {/* Editorial Tab */}
      {tab === 'editorial' && (
        <>
          {/* Region toggle */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 rounded-full border border-border/40 bg-muted/15 p-0.5">
              {(['global', 'turkey'] as const).map(r => (
                <button
                  key={r}
                  onClick={() => setEditorialRegion(r)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    editorialRegion === r
                      ? 'text-accent-info bg-accent-info/10 border border-accent-info/25'
                      : 'text-muted-foreground hover:text-foreground border border-transparent'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            {editorialLoading && <span className="text-xs text-muted-foreground/60">Loading...</span>}
          </div>

          {/* Stats strip */}
          {editorialStats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="p-4 bg-card border-border/40">
                <div className="label-xs">Reviewed (7d)</div>
                <div className="text-2xl font-light text-foreground mt-1">{editorialStats.total_reviewed}</div>
              </Card>
              <Card className="p-4 bg-card border-border/40">
                <div className="label-xs">Rejection Rate</div>
                <div className="text-2xl font-light text-warning mt-1">{editorialStats.rejection_rate}%</div>
              </Card>
              <Card className="p-4 bg-card border-border/40">
                <div className="label-xs">Pending Rules</div>
                <div className="text-2xl font-light text-accent-info mt-1">{editorialStats.pending_rules}</div>
              </Card>
              <Card className="p-4 bg-card border-border/40">
                <div className="label-xs">Active Rules</div>
                <div className="text-2xl font-light text-foreground mt-1">{editorialStats.active_rules}</div>
              </Card>
            </div>
          )}

          {/* Review queue */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/30 text-muted-foreground text-xs uppercase tracking-wider">
                  <th className="text-left py-2 px-2 w-8"></th>
                  <th className="text-left py-2 px-2">Title</th>
                  <th className="text-left py-2 px-2">Source</th>
                  <th className="text-left py-2 px-2">Gating</th>
                  <th className="text-right py-2 px-2">Score</th>
                  <th className="text-right py-2 px-2">Signals</th>
                  <th className="text-left py-2 px-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reviewClusters.map((c) => (
                  <tr key={c.id} className={`border-b border-border/20 hover:bg-card/50 ${
                    c.editorial_action === 'reject' ? 'opacity-50' : ''
                  }`}>
                    <td className="py-2 px-2">
                      <div className={`w-2 h-2 rounded-full ${
                        c.editorial_action === 'reject' ? 'bg-destructive' :
                        c.editorial_action === 'approve' ? 'bg-success' :
                        c.editorial_action === 'flag' ? 'bg-warning' :
                        'bg-muted'
                      }`} />
                    </td>
                    <td className="py-2 px-2 max-w-[300px]">
                      <div className="font-medium text-foreground line-clamp-1" title={c.title}>
                        {c.title}
                      </div>
                      <div className="text-xs text-muted-foreground/60">{relativeTime(c.published_at)}</div>
                    </td>
                    <td className="py-2 px-2">
                      <span className="text-xs text-muted-foreground">{c.source_name || c.source_key || '—'}</span>
                    </td>
                    <td className="py-2 px-2">
                      {gatingBadge(c.gating_decision)}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">
                      {c.rank_score?.toFixed(2)}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <span className="text-xs tabular-nums">
                        {c.upvote_count ? <span className="text-success">{c.upvote_count}+</span> : null}
                        {c.not_useful_count ? <span className="text-destructive ml-1">{c.not_useful_count}-</span> : null}
                        {!c.upvote_count && !c.not_useful_count && <span className="text-muted-foreground/40">—</span>}
                      </span>
                    </td>
                    <td className="py-2 px-2">
                      {c.editorial_action ? (
                        <span className={`px-1.5 py-0.5 text-xs rounded ${
                          c.editorial_action === 'reject' ? 'bg-destructive/15 text-destructive' :
                          c.editorial_action === 'approve' ? 'bg-success/15 text-success' :
                          'bg-warning/15 text-warning'
                        }`}>{c.editorial_action}</span>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openRejectModal(c)}
                            className="px-2 py-0.5 text-xs rounded bg-destructive/10 text-destructive
                                       hover:bg-destructive/20 transition-colors"
                          >
                            Reject
                          </button>
                          <button
                            onClick={() => submitAction(c.id, 'approve')}
                            disabled={actionLoading}
                            className="px-2 py-0.5 text-xs rounded bg-success/10 text-success
                                       hover:bg-success/20 transition-colors disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => submitAction(c.id, 'flag')}
                            disabled={actionLoading}
                            className="px-2 py-0.5 text-xs rounded bg-warning/10 text-warning
                                       hover:bg-warning/20 transition-colors disabled:opacity-50"
                          >
                            Flag
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {reviewClusters.length === 0 && !editorialLoading && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground/60 text-sm">
                      No clusters in the last 48 hours
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Active rules section (collapsible) */}
          <div className="border border-border/30 rounded-lg">
            <button
              onClick={() => setShowRules(!showRules)}
              className="w-full flex items-center justify-between p-4 text-sm font-medium text-foreground
                         hover:bg-card/50 transition-colors"
            >
              <span>
                Active Rules ({editorialRules.length})
                {pendingRulesCount > 0 && (
                  <span className="ml-2 px-1.5 py-0.5 text-xs rounded bg-warning/15 text-warning">
                    {pendingRulesCount} pending
                  </span>
                )}
              </span>
              <span className="text-muted-foreground">{showRules ? '−' : '+'}</span>
            </button>

            {showRules && (
              <div className="border-t border-border/30 p-4 space-y-4">
                <div className="flex justify-end">
                  <button
                    onClick={() => setShowAddRule(!showAddRule)}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-card border border-border/40
                               text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showAddRule ? 'Cancel' : 'Add manual rule'}
                  </button>
                </div>

                {/* Add rule form */}
                {showAddRule && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 bg-muted/10 rounded-md border border-border/20">
                    <select
                      value={newRuleType}
                      onChange={e => setNewRuleType(e.target.value)}
                      className="bg-background border border-border/40 rounded px-2 py-1.5 text-xs"
                    >
                      {RULE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input
                      type="text"
                      value={newRuleValue}
                      onChange={e => setNewRuleValue(e.target.value)}
                      placeholder="Rule value (keyword, domain, etc.)"
                      className="bg-background border border-border/40 rounded px-2 py-1.5 text-xs"
                    />
                    {newRuleType === 'source_downweight' && (
                      <input
                        type="number"
                        value={newRuleWeight}
                        onChange={e => setNewRuleWeight(e.target.value)}
                        step="0.1" min="0" max="1"
                        placeholder="Weight (0-1)"
                        className="bg-background border border-border/40 rounded px-2 py-1.5 text-xs"
                      />
                    )}
                    <button
                      onClick={submitNewRule}
                      disabled={!newRuleValue.trim()}
                      className="px-3 py-1.5 text-xs font-medium rounded bg-accent-info/10 text-accent-info
                                 border border-accent-info/25 hover:bg-accent-info/20 transition-colors
                                 disabled:opacity-50"
                    >
                      Create
                    </button>
                  </div>
                )}

                {/* Rules table */}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/30 text-muted-foreground text-xs uppercase tracking-wider">
                      <th className="text-left py-2 px-2">Type</th>
                      <th className="text-left py-2 px-2">Value</th>
                      <th className="text-left py-2 px-2">Region</th>
                      <th className="text-right py-2 px-2">Support</th>
                      <th className="text-left py-2 px-2">Status</th>
                      <th className="text-left py-2 px-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editorialRules.map((r) => (
                      <tr key={r.id} className="border-b border-border/20 hover:bg-card/50">
                        <td className="py-2 px-2">
                          <span className="px-1.5 py-0.5 text-xs rounded bg-muted/50 text-muted-foreground">
                            {r.rule_type}
                          </span>
                        </td>
                        <td className="py-2 px-2 font-medium text-foreground">
                          {r.rule_value}
                          {r.rule_type === 'source_downweight' && (
                            <span className="ml-1 text-xs text-muted-foreground/60">({r.rule_weight}x)</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-muted-foreground text-xs">{r.region}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">
                          {r.supporting_action_count}
                        </td>
                        <td className="py-2 px-2">
                          {r.approved_at ? (
                            <span className="px-1.5 py-0.5 text-xs rounded bg-success/15 text-success">active</span>
                          ) : (
                            <span className="px-1.5 py-0.5 text-xs rounded bg-warning/15 text-warning">pending</span>
                          )}
                          {r.is_auto_generated && (
                            <span className="ml-1 text-xs text-muted-foreground/50">auto</span>
                          )}
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-1">
                            {!r.approved_at && (
                              <button
                                onClick={() => approveRule(r.id)}
                                className="px-2 py-0.5 text-xs rounded bg-success/10 text-success
                                           hover:bg-success/20 transition-colors"
                              >
                                Approve
                              </button>
                            )}
                            <button
                              onClick={() => deactivateRule(r.id)}
                              className="px-2 py-0.5 text-xs rounded bg-destructive/10 text-destructive
                                         hover:bg-destructive/20 transition-colors"
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {editorialRules.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-muted-foreground/60 text-sm">
                          No rules configured
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
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

      {/* Reject Modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="bg-card border border-border/40 rounded-lg shadow-xl w-full max-w-md mx-4 p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-medium text-foreground">Reject Story</h3>
                <p className="text-xs text-muted-foreground/60 mt-1 line-clamp-2">{rejectTarget.title}</p>
              </div>
              <button onClick={() => setRejectTarget(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Reason category */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Reason</label>
              <select
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                className="w-full bg-background border border-border/40 rounded px-2 py-1.5 text-sm"
              >
                {REASON_CATEGORIES.map(r => (
                  <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>

            {/* Reason text */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Notes (optional)</label>
              <textarea
                value={rejectText}
                onChange={e => setRejectText(e.target.value)}
                rows={2}
                placeholder="Why is this irrelevant?"
                className="w-full bg-background border border-border/40 rounded px-2 py-1.5 text-sm resize-none"
              />
            </div>

            {/* Keyword tags */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Keywords</label>
              <div className="flex flex-wrap gap-1 mb-2">
                {rejectKeywords.map(kw => (
                  <span
                    key={kw}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded
                               bg-muted/50 text-muted-foreground"
                  >
                    {kw}
                    <button onClick={() => removeKeyword(kw)} className="hover:text-foreground">
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>
              <input
                type="text"
                placeholder="Add keyword and press Enter"
                className="w-full bg-background border border-border/40 rounded px-2 py-1.5 text-xs"
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val) { addKeyword(val); (e.target as HTMLInputElement).value = ''; }
                  }
                }}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setRejectTarget(null)}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-border/40
                           text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => submitAction(rejectTarget.id, 'reject', {
                  reason_category: rejectReason,
                  reason_text: rejectText || undefined,
                  title_keywords: rejectKeywords.length > 0 ? rejectKeywords : undefined,
                })}
                disabled={actionLoading}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-destructive/15 text-destructive
                           border border-destructive/25 hover:bg-destructive/25 transition-colors
                           disabled:opacity-50"
              >
                {actionLoading ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          </div>
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
