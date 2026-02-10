'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useWatchlist } from '@/lib/watchlist';
import { Bookmark, Loader2, X, Download, ChevronDown, ChevronUp } from 'lucide-react';
import { WatchlistChanges } from '@/components/features/watchlist-changes';
import { WatchlistComparison } from '@/components/features/watchlist-comparison';
import { generateWatchlistMemo, downloadMemo } from '@/lib/export-memo';
import { getWatchlistChanges } from '@/lib/data/signals';
import { formatCurrency } from '@/lib/utils';
import type { StartupAnalysis, MonthlyStats } from '@startup-intelligence/shared';

export default function WatchlistPage() {
  const { watchlist, isLoading, removeFromWatchlist, requiresAuth } = useWatchlist();
  const [startups, setStartups] = useState<StartupAnalysis[]>([]);
  const [stats, setStats] = useState<MonthlyStats | null>(null);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [showChanges, setShowChanges] = useState(true);

  // Discover the latest available period dynamically
  const [currentPeriod, setCurrentPeriod] = useState<string | null>(null);

  useEffect(() => {
    async function discoverPeriod() {
      try {
        // Try to get available periods from the API-driven data loader
        const res = await fetch('/api/periods');
        if (res.ok) {
          const periods = await res.json();
          if (periods.length > 0) {
            setCurrentPeriod(periods[0].period);
            return;
          }
        }
      } catch {
        // Fallback: scan data directory structure
      }
      // Fallback: use current year-month format to find latest period
      const now = new Date();
      const candidates = [];
      for (let m = now.getMonth() + 1; m >= 1; m--) {
        candidates.push(`${now.getFullYear()}-${String(m).padStart(2, '0')}`);
      }
      for (const period of candidates) {
        try {
          const res = await fetch(`/data/${period}/output/analysis_store/index.json`, { method: 'HEAD' });
          if (res.ok) {
            setCurrentPeriod(period);
            return;
          }
        } catch {
          // Try next
        }
      }
      // Last resort fallback
      setCurrentPeriod(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    }
    discoverPeriod();
  }, []);

  // Load startup data for watchlisted companies
  useEffect(() => {
    if (!currentPeriod) return;

    async function loadData() {
      try {
        const slugs = watchlist?.items.map(i => i.companySlug) || [];
        const startupResults = await Promise.all(
          slugs.map(async (slug) => {
            try {
              const res = await fetch(
                `/data/${currentPeriod}/output/analysis_store/base_analyses/${slug}.json`
              );
              if (!res.ok) return null;
              return await res.json() as StartupAnalysis;
            } catch {
              return null;
            }
          })
        );
        setStartups(startupResults.filter((s): s is StartupAnalysis => s !== null));

        // Load stats
        const statsRes = await fetch(`/data/${currentPeriod}/output/monthly_stats.json`);
        if (statsRes.ok) {
          setStats(await statsRes.json());
        }
      } catch (err) {
        console.error('Failed to load watchlist data:', err);
      } finally {
        setIsDataLoading(false);
      }
    }

    if (watchlist?.items.length) {
      loadData();
    } else {
      setIsDataLoading(false);
    }
  }, [watchlist?.items, currentPeriod]);

  // Compute changes for watchlisted companies
  const changes = useMemo(() => {
    if (startups.length === 0 || !stats) return [];
    const slugs = watchlist?.items.map(i => i.companySlug) || [];
    return getWatchlistChanges(slugs, startups);
  }, [startups, stats, watchlist?.items]);

  // Calculate summary stats
  const summaryStats = useMemo(() => {
    const totalFunding = startups.reduce((sum, s) => sum + (s.funding_amount || 0), 0);
    const genaiCount = startups.filter(s => s.uses_genai).length;
    return { totalFunding, genaiCount };
  }, [startups]);

  const handleExportMemo = () => {
    const memo = generateWatchlistMemo(startups);
    downloadMemo(memo, `watchlist-${new Date().toISOString().split('T')[0]}.md`);
  };

  if (isLoading) {
    return (
      <>
        <div className="briefing-header">
          <span className="briefing-date">Watchlist</span>
          <h1 className="briefing-headline">Track companies you&apos;re interested in</h1>
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
          <h1 className="briefing-headline">Track companies you&apos;re interested in</h1>
        </div>

        <div className="text-center py-16 border border-border/30 rounded-lg">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-accent-info/10 flex items-center justify-center">
            <Bookmark className="w-6 h-6 text-accent-info" />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">
            Sign in to use watchlists
          </h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
            Create a free account to track companies, save filters, and get a
            personalized experience.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors"
          >
            Sign In
          </Link>
        </div>
      </>
    );
  }

  const items = watchlist?.items || [];

  return (
    <>
      {/* Page Header */}
      <div className="briefing-header">
        <span className="briefing-date">Watchlist</span>
        <h1 className="briefing-headline">Track companies you&apos;re interested in</h1>
      </div>

      {items.length > 0 ? (
        <>
          {/* Summary Bar */}
          <div className="mb-6 p-4 bg-muted/10 border border-border/30 rounded-lg">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-6">
                <span className="text-sm text-muted-foreground">
                  {items.length} {items.length === 1 ? 'company' : 'companies'}{' '}
                  tracked
                </span>
                {summaryStats.totalFunding > 0 && (
                  <span className="text-sm text-muted-foreground">
                    {formatCurrency(summaryStats.totalFunding, true)} total
                    funding
                  </span>
                )}
                {summaryStats.genaiCount > 0 && (
                  <span className="text-sm text-muted-foreground">
                    {summaryStats.genaiCount} GenAI
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleExportMemo}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border/30 rounded hover:bg-muted/20 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export Memo
                </button>
                <Link
                  href="/dealbook"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Browse dealbook
                </Link>
              </div>
            </div>
          </div>

          {/* What Changed Section */}
          {changes.length > 0 && (
            <div className="mb-6">
              <button
                onClick={() => setShowChanges(!showChanges)}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
              >
                {showChanges ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
                What Changed ({changes.length})
              </button>
              {showChanges && <WatchlistChanges events={changes} />}
            </div>
          )}

          {/* Comparison with baseline */}
          {stats && startups.length >= 2 && (
            <div className="mb-6">
              <WatchlistComparison
                watchedStartups={startups}
                allStats={stats}
              />
            </div>
          )}

          {/* Watchlist Items */}
          <div className="space-y-3">
            {items.map(item => {
              const startupData = startups.find(
                s => s.company_slug === item.companySlug
              );
              return (
                <WatchlistItem
                  key={item.companySlug}
                  item={item}
                  startupData={startupData}
                  onRemove={() => removeFromWatchlist(item.companySlug)}
                />
              );
            })}
          </div>
        </>
      ) : (
        <div className="text-center py-16 border border-border/30 rounded-lg">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-accent-info/10 flex items-center justify-center">
            <Bookmark className="w-6 h-6 text-accent-info" />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">
            No companies tracked
          </h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
            Add companies to your watchlist to track funding rounds, pattern
            changes, and news.
          </p>
          <Link
            href="/dealbook"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors"
          >
            Browse Dealbook
          </Link>
        </div>
      )}

      {/* Feature info */}
      <div className="mt-8 p-5 bg-card border border-border/40 rounded-xl">
        <h3 className="text-sm font-medium text-foreground mb-2">
          Watchlist Features
        </h3>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="text-accent-info">-</span>
            Track unlimited companies across all verticals
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent-info">-</span>
            See changes and updates for your tracked companies
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent-info">-</span>
            Compare your portfolio against market baseline
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent-info">-</span>
            Export your watchlist as a markdown memo
          </li>
        </ul>
      </div>
    </>
  );
}

function WatchlistItem({
  item,
  startupData,
  onRemove,
}: {
  item: { companySlug: string; companyName: string; addedAt: string };
  startupData?: StartupAnalysis;
  onRemove: () => void;
}) {
  return (
    <div className="p-4 border border-border/40 rounded-xl hover:-translate-y-0.5 hover:border-accent-info/35 transition-all duration-200">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Link
              href={`/company/${item.companySlug}`}
              className="text-sm font-medium text-foreground hover:text-accent-info transition-colors"
            >
              {item.companyName}
            </Link>
            {startupData?.uses_genai && (
              <span className="px-1.5 py-0.5 text-[10px] bg-accent-info/10 text-accent-info rounded">
                GenAI
              </span>
            )}
          </div>
          {startupData && (
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground/70">
              {startupData.funding_amount && (
                <span className="tabular-nums">
                  {formatCurrency(startupData.funding_amount, true)}
                </span>
              )}
              {startupData.funding_stage && (
                <span className="capitalize">
                  {startupData.funding_stage.replace(/_/g, ' ')}
                </span>
              )}
              {startupData.build_patterns && startupData.build_patterns.length > 0 && (
                <span className="truncate max-w-[200px]">
                  {startupData.build_patterns[0].name}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-4">
          <Link
            href={`/company/${item.companySlug}`}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            View profile
          </Link>
          <button
            onClick={onRemove}
            className="p-1.5 text-muted-foreground hover:text-destructive transition-colors rounded"
            title="Remove from watchlist"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="mt-2 text-xs text-muted-foreground/60">
        Added {new Date(item.addedAt).toLocaleDateString()}
      </div>
    </div>
  );
}
