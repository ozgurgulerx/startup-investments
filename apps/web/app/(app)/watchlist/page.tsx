'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useWatchlist } from '@/lib/watchlist';
import { Bookmark, Loader2, X, Bell, Settings, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

type Tab = 'alerts' | 'subscriptions' | 'digest';

interface UserAlert {
  id: string;
  severity: number;
  status: string;
  headline: string;
  delta_type: string;
  magnitude: number | null;
  startup_name: string | null;
  startup_slug: string | null;
  narrative: {
    one_liner?: string;
    why_it_matters?: string[];
    what_to_watch?: Array<{ metric: string; threshold: number; reason: string }>;
    links?: Array<{ label: string; url: string }>;
  } | null;
  created_at: string;
}

interface Subscription {
  object_type: string;
  object_id: string;
  created_at: string;
}

interface DigestThread {
  id: string;
  title: string;
  summary: string;
  themes: Array<{ theme: string; count: number; top_headlines: string[]; max_severity: number }>;
  alert_count: number;
  period_start: string;
  period_end: string;
  created_at: string;
}

const DELTA_TYPE_LABELS: Record<string, string> = {
  funding_round: 'Funding',
  stage_change: 'Stage',
  pattern_added: 'Pattern',
  pattern_removed: 'Pattern',
  signal_spike: 'Signal',
  score_change: 'Score',
  employee_change: 'Team',
  new_entry: 'New',
  gtm_shift: 'GTM',
  rank_jump: 'Rank',
};

function SeverityDots({ severity }: { severity: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <span
          key={i}
          className={`w-1 h-1 rounded-full ${
            i <= severity ? 'bg-foreground' : 'bg-muted-foreground/20'
          }`}
        />
      ))}
    </div>
  );
}

export default function WatchlistPage() {
  const { watchlist, isLoading: watchlistLoading, removeFromWatchlist, requiresAuth } = useWatchlist();
  const [activeTab, setActiveTab] = useState<Tab>('alerts');
  const [alerts, setAlerts] = useState<UserAlert[]>([]);
  const [alertsTotal, setAlertsTotal] = useState(0);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [digest, setDigest] = useState<DigestThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedAlerts, setExpandedAlerts] = useState<Set<string>>(new Set());
  const [alertFilter, setAlertFilter] = useState<'unread' | 'all'>('unread');

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [alertsRes, subsRes, digestRes] = await Promise.all([
          fetch(`/api/alerts?status=${alertFilter}&limit=50`).catch(() => null),
          fetch('/api/subscriptions').catch(() => null),
          fetch('/api/alerts/digest').catch(() => null),
        ]);
        if (alertsRes?.ok) {
          const data = await alertsRes.json();
          setAlerts(data.alerts || []);
          setAlertsTotal(data.total || 0);
        }
        if (subsRes?.ok) {
          const data = await subsRes.json();
          setSubscriptions(Array.isArray(data) ? data : []);
        }
        if (digestRes?.ok) {
          const data = await digestRes.json();
          setDigest(data?.id ? data : null);
        }
      } catch (err) {
        console.error('Failed to load watchlist data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [alertFilter]);

  const handleMarkRead = async (alertId: string) => {
    try {
      await fetch(`/api/alerts/${alertId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'read' }),
      });
      setAlerts(prev => prev.filter(a => a.id !== alertId));
    } catch { /* ignore */ }
  };

  const handleMarkAllRead = async () => {
    const ids = alerts.filter(a => a.status === 'unread').map(a => a.id);
    if (ids.length === 0) return;
    try {
      await fetch('/api/alerts/batch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, status: 'read' }),
      });
      setAlerts(prev => prev.filter(a => a.status !== 'unread'));
    } catch { /* ignore */ }
  };

  const toggleExpanded = (id: string) => {
    setExpandedAlerts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const watchlistItems = watchlist?.items || [];
  const groupedSubs = useMemo(() => {
    const groups: Record<string, Subscription[]> = {};
    for (const sub of subscriptions) {
      groups[sub.object_type] = groups[sub.object_type] || [];
      groups[sub.object_type].push(sub);
    }
    return groups;
  }, [subscriptions]);

  if (watchlistLoading) {
    return (
      <>
        <div className="briefing-header">
          <span className="briefing-date">Watchlist</span>
          <h1 className="briefing-headline">Intelligence Center</h1>
        </div>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </>
    );
  }

  if (requiresAuth) {
    return (
      <>
        <div className="briefing-header">
          <span className="briefing-date">Watchlist</span>
          <h1 className="briefing-headline">Intelligence Center</h1>
        </div>
        <div className="text-center py-16 border border-border/30 rounded-lg">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-accent-info/10 flex items-center justify-center">
            <Bookmark className="w-6 h-6 text-accent-info" />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">Sign in to use watchlists</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
            Create a free account to track companies, get alerts, and receive weekly digests.
          </p>
          <Link href="/login" className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors">
            Sign In
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="briefing-header">
        <span className="briefing-date">Watchlist</span>
        <h1 className="briefing-headline">Intelligence Center</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {watchlistItems.length} companies tracked · {alertsTotal} alerts
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mt-4 mb-6 border-b border-border/30">
        {([
          { key: 'alerts' as Tab, label: 'Alerts', icon: Bell, count: alertsTotal },
          { key: 'subscriptions' as Tab, label: 'Subscriptions', icon: Settings, count: watchlistItems.length + subscriptions.length },
          { key: 'digest' as Tab, label: 'Digest', icon: FileText },
        ]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 transition-colors -mb-px ${
              activeTab === tab.key
                ? 'border-accent-info text-accent-info'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
            {tab.count != null && tab.count > 0 && (
              <span className="text-[10px] bg-muted/30 px-1.5 py-0.5 rounded">{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* ALERTS TAB */}
          {activeTab === 'alerts' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  {(['unread', 'all'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setAlertFilter(f)}
                      className={`px-2.5 py-1 text-xs rounded transition-colors ${
                        alertFilter === f ? 'bg-accent-info/15 text-accent-info' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {f === 'unread' ? 'Unread' : 'All'}
                    </button>
                  ))}
                </div>
                {alerts.some(a => a.status === 'unread') && (
                  <button
                    onClick={handleMarkAllRead}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Mark all read
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {alerts.map(alert => (
                  <div key={alert.id} className="p-3 border border-border/30 rounded-lg">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="px-1.5 py-0.5 text-[10px] bg-muted/20 text-muted-foreground rounded">
                            {DELTA_TYPE_LABELS[alert.delta_type] || alert.delta_type}
                          </span>
                          <SeverityDots severity={alert.severity} />
                        </div>
                        <p className="text-sm text-foreground">{alert.headline}</p>
                        {alert.startup_name && (
                          <Link href={`/company/${alert.startup_slug}`} className="text-xs text-muted-foreground hover:text-accent-info transition-colors mt-0.5 inline-block">
                            {alert.startup_name}
                          </Link>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => toggleExpanded(alert.id)}
                          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {expandedAlerts.has(alert.id) ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                        {alert.status === 'unread' && (
                          <button
                            onClick={() => handleMarkRead(alert.id)}
                            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Mark read
                          </button>
                        )}
                      </div>
                    </div>
                    {expandedAlerts.has(alert.id) && alert.narrative && (
                      <div className="mt-3 pt-3 border-t border-border/20 space-y-2">
                        {alert.narrative.one_liner && (
                          <p className="text-xs text-foreground/80">{alert.narrative.one_liner}</p>
                        )}
                        {alert.narrative.why_it_matters && alert.narrative.why_it_matters.length > 0 && (
                          <div>
                            <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Why it matters</h4>
                            <ul className="space-y-0.5">
                              {alert.narrative.why_it_matters.map((item, i) => (
                                <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                                  <span className="text-accent-info shrink-0">-</span>
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {alert.narrative.links && alert.narrative.links.length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {alert.narrative.links.map((link, i) => (
                              <Link key={i} href={link.url} className="text-[10px] text-accent-info hover:underline">
                                {link.label}
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {alerts.length === 0 && (
                  <div className="text-center py-16 text-sm text-muted-foreground">
                    {alertFilter === 'unread' ? 'No unread alerts' : 'No alerts yet — subscribe to companies, patterns, or investors to start receiving alerts'}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SUBSCRIPTIONS TAB */}
          {activeTab === 'subscriptions' && (
            <div className="space-y-6">
              {/* Watchlist items as startup subscriptions */}
              <div>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Tracked Companies ({watchlistItems.length})
                </h3>
                <div className="space-y-1.5">
                  {watchlistItems.map(item => (
                    <div key={item.companySlug} className="flex items-center justify-between p-2.5 border border-border/30 rounded-lg">
                      <Link href={`/company/${item.companySlug}`} className="text-sm text-foreground hover:text-accent-info transition-colors">
                        {item.companyName}
                      </Link>
                      <button
                        onClick={() => removeFromWatchlist(item.companySlug)}
                        className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {watchlistItems.length === 0 && (
                    <p className="text-xs text-muted-foreground py-4 text-center">
                      No companies tracked. <Link href="/dealbook" className="text-accent-info hover:underline">Browse dealbook</Link>
                    </p>
                  )}
                </div>
              </div>

              {/* Grouped subscriptions */}
              {Object.entries(groupedSubs).map(([type, subs]) => (
                <div key={type}>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    {type} Subscriptions ({subs.length})
                  </h3>
                  <div className="space-y-1.5">
                    {subs.map(sub => (
                      <div key={`${sub.object_type}-${sub.object_id}`} className="flex items-center justify-between p-2.5 border border-border/30 rounded-lg">
                        <span className="text-sm text-foreground">{sub.object_id}</span>
                        <span className="text-[10px] text-muted-foreground/60">
                          {new Date(sub.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* DIGEST TAB */}
          {activeTab === 'digest' && (
            <div>
              {digest ? (
                <div className="space-y-4">
                  <div className="p-4 border border-border/30 rounded-lg">
                    <h3 className="text-sm font-medium text-foreground">{digest.title}</h3>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span>{digest.period_start} to {digest.period_end}</span>
                      <span>{digest.alert_count} alerts</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-3">{digest.summary}</p>
                  </div>

                  {digest.themes.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Themes</h3>
                      {digest.themes.map((theme, i) => (
                        <div key={i} className="p-3 border border-border/30 rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-foreground capitalize">{theme.theme}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">{theme.count} alerts</span>
                              <SeverityDots severity={theme.max_severity} />
                            </div>
                          </div>
                          <ul className="space-y-0.5">
                            {theme.top_headlines.map((h, j) => (
                              <li key={j} className="text-xs text-muted-foreground flex items-start gap-1.5">
                                <span className="text-accent-info shrink-0">-</span>
                                {h}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-16 text-sm text-muted-foreground">
                  No digest available yet — digests are generated weekly on Mondays
                </div>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
