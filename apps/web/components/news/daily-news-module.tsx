'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Activity, ArrowUpRight, Newspaper, RefreshCcw, Sparkles } from 'lucide-react';
import type { NewsEdition } from '@startup-intelligence/shared';
import { safeDate } from '@/lib/safe-date';
import { sectionNewsItems } from '@/lib/news/section-items';
import { PageContainer } from '@/components/layout/page-container';
import { SectionHeader } from './section-header';
import { NewsCard } from './news-card';
import { DailyBriefCard } from './daily-brief-card';
import { NewsSubscriptionCard } from './news-subscription-card';

interface DailyNewsModuleProps {
  className?: string;
}

type SortMode = 'impact' | 'latest';

const CORROBORATED_MIN_SOURCES = 2;
const CONFIRMED_MIN_SOURCES = 3;

const compactCountFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function countNewStories(current: NewsEdition | null, incoming: NewsEdition): number {
  if (!current) return incoming.items.length;
  const seen = new Set(current.items.map((item) => item.id));
  let count = 0;
  for (const item of incoming.items) {
    if (!seen.has(item.id)) count += 1;
  }
  return count;
}

function formatTimestamp(value: string): string {
  const parsed = safeDate(value);
  if (parsed.getTime() === 0) return value;
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatCompactCount(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return compactCountFormatter.format(value);
}

export function DailyNewsModule({ className }: DailyNewsModuleProps) {
  const [edition, setEdition] = useState<NewsEdition | null>(null);
  const [topics, setTopics] = useState<Array<{ topic: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [pendingEdition, setPendingEdition] = useState<NewsEdition | null>(null);
  const [newStoryCount, setNewStoryCount] = useState(0);
  const [activeTopic, setActiveTopic] = useState<string>('all');
  const [sortMode, setSortMode] = useState<SortMode>('impact');
  const [isPolling, setIsPolling] = useState(false);
  const [turkeyStoryCount, setTurkeyStoryCount] = useState<number | null>(null);
  const editionRef = useRef<NewsEdition | null>(null);
  const isPollingRef = useRef(false);
  const lastFocusRefreshAtRef = useRef(0);

  // Brief dismiss state (shared with interactive-radar via same localStorage key)
  const [briefDismissed, setBriefDismissed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('buildatlas:brief-state') === 'dismissed';
    }
    return false;
  });
  const handleDismissBrief = useCallback(() => {
    setBriefDismissed(true);
    localStorage.setItem('buildatlas:brief-state', 'dismissed');
  }, []);
  const handleRestoreBrief = useCallback(() => {
    setBriefDismissed(false);
    localStorage.removeItem('buildatlas:brief-state');
  }, []);

  const applyEdition = useCallback((data: NewsEdition) => {
    const current = editionRef.current;
    if (!current || current.generated_at === data.generated_at) {
      editionRef.current = data;
      setEdition(data);
      return;
    }
    setPendingEdition(data);
    setNewStoryCount(Math.max(1, countNewStories(current, data)));
  }, []);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const [editionRes, topicsRes, turkeyRes] = await Promise.all([
        fetch('/api/news/latest', { cache: 'no-store' }),
        fetch('/api/news/topics', { cache: 'no-store' }),
        fetch('/api/news/latest?region=turkey', { cache: 'no-store' }),
      ]);

      if (editionRes.ok) {
        const data = (await editionRes.json()) as NewsEdition;
        applyEdition(data);
      }

      if (topicsRes.ok) {
        const data = (await topicsRes.json()) as Array<{ topic: string; count: number }>;
        setTopics(data);
      }

      if (turkeyRes.ok) {
        const data = (await turkeyRes.json()) as NewsEdition;
        setTurkeyStoryCount(data.items.length);
      }
    } catch (error) {
      console.error('Failed to load daily news module', error);
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [applyEdition]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    if (isPollingRef.current) return;

    isPollingRef.current = true;
    setIsPolling(true);
    try {
      await load({ silent: true });
    } finally {
      isPollingRef.current = false;
      setIsPolling(false);
    }
  }, [load]);

  useEffect(() => {
    const poll = window.setInterval(() => {
      void refresh();
    }, 5 * 60 * 1000);

    return () => {
      window.clearInterval(poll);
    };
  }, [refresh]);

  useEffect(() => {
    const maybeRefresh = () => {
      if (document.visibilityState !== 'visible') return;

      const now = Date.now();
      if (now - lastFocusRefreshAtRef.current < 15_000) return;
      lastFocusRefreshAtRef.current = now;

      void refresh();
    };

    window.addEventListener('focus', maybeRefresh);
    document.addEventListener('visibilitychange', maybeRefresh);
    return () => {
      window.removeEventListener('focus', maybeRefresh);
      document.removeEventListener('visibilitychange', maybeRefresh);
    };
  }, [refresh]);

  const sortedItems = useMemo(() => {
    const source = edition?.items || [];
    const filtered =
      activeTopic === 'all'
        ? source
        : source.filter((item) =>
            item.topic_tags.some((tag) => tag.toLowerCase() === activeTopic.toLowerCase())
          );
    const list = [...filtered];

    if (sortMode === 'latest') {
      list.sort(
        (a, b) =>
          safeDate(b.published_at).getTime() - safeDate(a.published_at).getTime()
      );
      return list;
    }

    list.sort((a, b) => {
      const impactA = a.rank_score * 0.72 + a.trust_score * 0.28;
      const impactB = b.rank_score * 0.72 + b.trust_score * 0.28;
      return impactB - impactA;
    });
    return list;
  }, [activeTopic, edition, sortMode]);

  const sections = useMemo(() => {
    if (!edition) return null;
    return sectionNewsItems(sortedItems, edition.generated_at, {
      topStoriesCount: 3,
      maxBreaking: 6,
      maxDeepReads: 3,
    });
  }, [sortedItems, edition]);

  const crossSourceCount = useMemo(
    () => edition?.items.filter((item) => item.source_count >= CORROBORATED_MIN_SOURCES).length || 0,
    [edition?.items]
  );

  if (loading) {
    return (
      <section className={`py-16 ${className || ''}`}>
        <PageContainer>
          <div className="animate-pulse space-y-5">
            <div className="h-4 w-44 rounded bg-muted" />
            <div className="h-12 w-96 rounded bg-muted" />
            <div className="h-16 rounded-xl bg-muted" />
            <div className="grid gap-4 lg:grid-cols-5">
              <div className="h-72 rounded-xl bg-muted lg:col-span-3" />
              <div className="grid gap-4 lg:col-span-2">
                <div className="h-32 rounded-xl bg-muted" />
                <div className="h-32 rounded-xl bg-muted" />
              </div>
            </div>
          </div>
        </PageContainer>
      </section>
    );
  }

  if (!edition || !sections || !sections.topStories.length) {
    return (
      <section className={`relative py-16 ${className || ''}`}>
        <PageContainer>
          <div className="rounded-2xl border border-accent-info/25 bg-gradient-to-br from-accent-info/10 via-card/80 to-card/40 p-8 text-center">
            <p className="label-xs text-accent-info">Signal Feed</p>
            <h2 className="mt-3 text-2xl font-light tracking-tight text-foreground">
              Startup News Intelligence
            </h2>
            <p className="mt-3 text-sm text-muted-foreground max-w-lg mx-auto">
              High-signal startup news clustered across global sources, ranked by freshness,
              trust score, and cross-source corroboration.
            </p>
            <Link
              href="/news"
              className="mt-6 inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90"
            >
              Open Signal Feed
              <ArrowUpRight className="h-3.5 w-3.5" />
	            </Link>
	          </div>
	        </PageContainer>
	      </section>
	    );
	  }

  return (
    <section className={`relative overflow-hidden py-16 ${className || ''}`}>
      <PageContainer className="relative">
        {pendingEdition ? (
          <div className="mb-4 rounded-xl border border-accent-info/35 bg-accent-info/10 px-4 py-3 text-sm text-foreground">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent-info" />
                <span>
                  <strong>{newStoryCount}</strong> new signal{newStoryCount === 1 ? '' : 's'} ready.
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  editionRef.current = pendingEdition;
                  setEdition(pendingEdition);
                  setPendingEdition(null);
                  setNewStoryCount(0);
                }}
                className="inline-flex items-center gap-1 rounded-full border border-accent-info/40 px-3 py-1 text-xs uppercase tracking-wider text-accent-info hover:bg-accent-info/15"
              >
                Refresh feed
                <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        ) : null}

        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="label-xs text-accent-info">Today&apos;s Briefing</div>
            <div className="mt-2 flex items-center gap-3">
              <h2 className="text-4xl font-light tracking-tight text-foreground">Signal Feed</h2>
              <div className="flex items-center gap-1">
                <span className="rounded-full border border-accent-info/25 bg-accent-info/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-accent-info">
                  Signal Feed
                </span>
                <Link
                  href="/news"
                  className="rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted/25 hover:text-foreground"
                >
                  Radar
                </Link>
              </div>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Live startup signals ranked by impact, trust, and corroboration.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {briefDismissed && edition.brief && activeTopic === 'all' && (
              <button
                onClick={handleRestoreBrief}
                className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-muted/20 px-3 py-1 text-[11px] uppercase tracking-wider text-accent-info/60 transition-colors hover:text-accent-info"
              >
                <Newspaper className="h-3 w-3" />
                Show briefing
              </button>
            )}
            <span className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-muted/20 px-3 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
              <Activity className="h-3 w-3 text-success" />
              Live
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-muted/20 px-3 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
              <RefreshCcw className={`h-3 w-3 ${isPolling ? 'animate-spin text-accent-info' : ''}`} />
              Updated {formatTimestamp(edition.generated_at)}
            </span>
            {crossSourceCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-success/25 bg-success/10 px-3 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                {crossSourceCount} corroborated
              </span>
            )}
          </div>
        </div>

        {/* Radar preview card */}
        <Link
          href="/news"
          className="group mb-6 flex flex-col gap-3 rounded-xl border border-accent-info/25 bg-gradient-to-br from-accent-info/8 via-card/80 to-card/50 px-5 py-4 transition-all hover:border-accent-info/40 hover:shadow-[0_0_24px_rgba(59,130,246,0.06)] sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="text-muted-foreground">
              <span className="font-medium text-foreground tabular-nums">{edition.items.length}</span> signals today
            </span>
            <span className="text-muted-foreground">
              Turkey: <span className="font-medium text-foreground tabular-nums">{turkeyStoryCount ?? '—'}</span> signals
            </span>
            {topics.length > 0 && (
              <span className="hidden text-muted-foreground sm:inline">
                Top: {topics.slice(0, 3).map((t) => t.topic).join(', ')}
              </span>
            )}
          </div>
          <span className="inline-flex items-center gap-1 text-sm text-accent-info transition-colors group-hover:text-accent-info/80">
            Open Radar
            <ArrowUpRight className="h-3.5 w-3.5" />
          </span>
        </Link>

        {/* Sort + topic filters */}
        <div className="mb-6 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSortMode('impact')}
              className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-wider transition-colors ${sortMode === 'impact' ? 'border-accent-info/55 bg-accent-info/15 text-accent-info' : 'border-border/40 bg-muted/20 text-muted-foreground hover:border-accent-info/35 hover:text-foreground'}`}
            >
              Rank: Impact
            </button>
            <button
              type="button"
              onClick={() => setSortMode('latest')}
              className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-wider transition-colors ${sortMode === 'latest' ? 'border-accent-info/55 bg-accent-info/15 text-accent-info' : 'border-border/40 bg-muted/20 text-muted-foreground hover:border-accent-info/35 hover:text-foreground'}`}
            >
              Rank: Latest
            </button>
          </div>
          <div className="overflow-x-auto pb-1">
            <div className="flex min-w-max items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTopic('all')}
                className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-wider transition-colors ${activeTopic === 'all' ? 'border-accent-info/55 bg-accent-info/15 text-accent-info' : 'border-border/40 bg-muted/20 text-muted-foreground hover:border-accent-info/35 hover:text-foreground'}`}
              >
                All topics
              </button>
              {topics.map((topic) => {
                const isActive = activeTopic.toLowerCase() === topic.topic.toLowerCase();
                return (
                  <button
                    key={topic.topic}
                    type="button"
                    onClick={() => setActiveTopic(topic.topic)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] uppercase tracking-wider transition-colors ${isActive ? 'border-accent-info/55 bg-accent-info/15 text-accent-info' : 'border-border/40 bg-muted/20 text-muted-foreground hover:border-accent-info/35 hover:text-foreground'}`}
                  >
                    <span>{topic.topic}</span>
                    <span className="tabular-nums opacity-70">{topic.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Daily brief */}
        {edition.brief && activeTopic === 'all' && !briefDismissed && (
          <div className="mb-6">
            <DailyBriefCard brief={edition.brief} onDismiss={handleDismissBrief} />
          </div>
        )}

        {/* Main content */}
        <div className="space-y-7">
          <div className="space-y-7">
            {/* Top Stories */}
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {sections.topStories.map((item, i) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.35, delay: 0.07 * i }}
                  className={i === 0 ? 'rounded-xl ring-1 ring-accent-info/30' : ''}
                >
                  <NewsCard item={item} featured={i === 0} />
                </motion.div>
              ))}
            </div>

            {/* Breaking strip */}
            {sections.breaking.length > 0 && (
              <div>
                <SectionHeader label="Breaking" indicator="pulse" count={sections.breaking.length} />
                <div className="mt-3 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {sections.breaking.map((item) => (
                    <NewsCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}

            {/* Deep Reads spotlight */}
            {sections.deepReads.length > 0 && (
              <div>
                <SectionHeader label="Deep Reads" indicator="signal" count={sections.deepReads.length} />
                <div className="mt-3 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {sections.deepReads.map((item) => (
                    <NewsCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}

            {/* Remaining items */}
            {sections.remaining.length > 0 && (
              <div>
                <SectionHeader label="More Signals" count={sections.remaining.length} />
                <div className="mt-3 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {sections.remaining.slice(0, 6).map((item) => (
                    <NewsCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer bar */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/40 bg-card/50 px-4 py-3 text-sm">
          <p className="text-muted-foreground">
            Showing <span className="text-foreground tabular-nums">{sortedItems.length}</span>{' '}
            signals
            {activeTopic !== 'all' ? (
              <>
                {' '}for <span className="text-foreground">{activeTopic}</span>
              </>
            ) : null}
            .
          </p>
          <Link href="/news" className="inline-flex items-center gap-1 text-accent-info hover:text-accent-info/80">
            Open full radar
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="mt-4 grid items-start gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <NewsSubscriptionCard region="global" />
          </div>
          <div className="rounded-2xl border border-border/40 bg-card/60 p-4">
            <p className="label-xs text-accent-info">Archive</p>
            <h3 className="mt-2 text-lg font-medium tracking-tight text-foreground">Scroll back by day</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Browse every generated daily edition to see how startup narratives shifted over time.
            </p>
            <Link
              href="/news/archive"
              className="mt-4 inline-flex items-center gap-1 text-sm text-accent-info hover:text-accent-info/80"
            >
              Open archive timeline
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </PageContainer>
      </section>
    );
  }
