'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Activity, ArrowUpRight, Newspaper, RefreshCcw, Sparkles } from 'lucide-react';
import type { NewsEdition } from '@startup-intelligence/shared';
import { safeDate } from '@/lib/safe-date';
import { sectionNewsItems } from '@/lib/news/section-items';
import { PageContainer } from '@/components/layout/page-container';
import { SectionHeader } from './section-header';
import { StoryCard } from './story-row';
import { DailyBriefCard } from './daily-brief-card';
import { NewsSubscriptionCard } from './news-subscription-card';
import { ContextPanel } from './context-panel';
import { SignalsProvider } from './signals-provider';

interface DailyNewsModuleProps {
  className?: string;
  region?: 'global' | 'turkey';
}

type SortMode = 'impact' | 'latest';

const CORROBORATED_MIN_SOURCES = 2;

const compactCountFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function countNewSignals(current: NewsEdition | null, incoming: NewsEdition): number {
  if (!current) return incoming.items.length;
  const seen = new Set(current.items.map((item) => item.id));
  let count = 0;
  for (const item of incoming.items) {
    if (!seen.has(item.id)) count += 1;
  }
  return count;
}

function formatTimestamp(value: string, region: 'global' | 'turkey'): string {
  const parsed = safeDate(value);
  if (parsed.getTime() === 0) return value;
  return parsed.toLocaleString(region === 'turkey' ? 'tr-TR' : 'en-US', {
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

export function DailyNewsModule({ className, region = 'global' }: DailyNewsModuleProps) {
  const l = region === 'turkey'
    ? {
      signalFeed: 'Signal Feed',
      startupNewsIntelligence: 'Startup News Intelligence',
      emptyStateDescription: 'Yuksek sinyal startup haberleri kaynaklar arasi dogrulama, guven ve guncellik ile siralanir.',
      openSignalFeed: 'Signal Feed Ac',
      newReadySingle: 'yeni sinyal hazir.',
      newReadyPlural: 'yeni sinyal hazir.',
      refreshFeed: 'Akisi yenile',
      todaysBriefing: "Bugunun Ozeti",
      radar: 'Signal Feed',
      rankedBy: 'Canli startup sinyalleri etki, guven ve dogrulama skoruna gore siralanir.',
      showBriefing: 'Ozeti goster',
      live: 'Canli',
      updated: 'Guncellendi',
      corroborated: 'dogrulandi',
      signalsToday: 'bugun sinyal',
      counterpartLabel: 'Global',
      topTopics: 'Ust',
      openRadar: 'Signal Feedi ac',
      rankImpact: 'Sira: Etki',
      rankLatest: 'Sira: En yeni',
      allTopics: 'Tum konular',
      breaking: 'Breaking',
      deepReads: 'Deep Reads',
      moreSignals: 'Daha fazla sinyal',
      showing: 'Gosterilen',
      signals: 'sinyal',
      forTopic: 'konu',
      openFullRadar: 'Tam Signal Feedi ac',
      archive: 'Arsiv',
      scrollBack: 'Gun gun geriye git',
      browseEditions: 'Signal Feed edisyonlarini zaman icinde karsilastirarak anlatidaki degisimi inceleyin.',
      openArchive: 'Arsivi ac',
    }
    : {
      signalFeed: 'Signal Feed',
      startupNewsIntelligence: 'Startup News Intelligence',
      emptyStateDescription: 'High-signal startup news clustered across global sources, ranked by freshness, trust score, and cross-source corroboration.',
      openSignalFeed: 'Open Signal Feed',
      newReadySingle: 'new signal ready.',
      newReadyPlural: 'new signals ready.',
      refreshFeed: 'Refresh feed',
      todaysBriefing: "Today\'s Briefing",
      radar: 'Signal Feed',
      rankedBy: 'Live startup signals ranked by impact, trust, and corroboration.',
      showBriefing: 'Show briefing',
      live: 'Live',
      updated: 'Updated',
      corroborated: 'corroborated',
      signalsToday: 'signals today',
      counterpartLabel: 'Turkey',
      topTopics: 'Top',
      openRadar: 'Open Signal Feed',
      rankImpact: 'Rank: Impact',
      rankLatest: 'Rank: Latest',
      allTopics: 'All topics',
      breaking: 'Breaking',
      deepReads: 'Deep Reads',
      moreSignals: 'More Signals',
      showing: 'Showing',
      signals: 'signals',
      forTopic: 'for',
      openFullRadar: 'Open full Signal Feed',
      archive: 'Archive',
      scrollBack: 'Scroll back by day',
      browseEditions: 'Browse every generated Signal Feed edition to see how startup narratives shifted over time.',
      openArchive: 'Open archive timeline',
    };

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedIdFromUrl = searchParams.get('story');
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(selectedIdFromUrl);

  const newsBasePath = region === 'turkey' ? '/news/turkey' : '/news';
  const archivePath = region === 'turkey' ? '/news/turkey/archive' : '/news/archive';

  const [edition, setEdition] = useState<NewsEdition | null>(null);
  const [topics, setTopics] = useState<Array<{ topic: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [pendingEdition, setPendingEdition] = useState<NewsEdition | null>(null);
  const [newSignalCount, setNewSignalCount] = useState(0);
  const [activeTopic, setActiveTopic] = useState<string>('all');
  const [sortMode, setSortMode] = useState<SortMode>('impact');
  const [isPolling, setIsPolling] = useState(false);
  const [counterpartStoryCount, setCounterpartStoryCount] = useState<number | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());

  const editionRef = useRef<NewsEdition | null>(null);
  const isPollingRef = useRef(false);
  const lastFocusRefreshAtRef = useRef(0);

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

  const handleHideStory = useCallback((id: string) => {
    setHiddenIds((prev) => new Set(prev).add(id));
  }, []);

  const selectStory = useCallback((id: string | null) => {
    setSelectedStoryId(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id) {
      params.set('story', id);
    } else {
      params.delete('story');
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    setSelectedStoryId(selectedIdFromUrl);
  }, [selectedIdFromUrl]);

  const applyEdition = useCallback((data: NewsEdition) => {
    const current = editionRef.current;
    if (!current || current.generated_at === data.generated_at) {
      editionRef.current = data;
      setEdition(data);
      return;
    }
    setPendingEdition(data);
    setNewSignalCount(Math.max(1, countNewSignals(current, data)));
  }, []);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }

    const regionParam = region === 'turkey' ? '?region=turkey' : '';
    const counterpartParam = region === 'turkey' ? '' : '?region=turkey';

    try {
      const [editionRes, topicsRes, counterpartRes] = await Promise.all([
        fetch(`/api/news/latest${regionParam}`, { cache: 'no-store' }),
        fetch(`/api/news/topics${regionParam}`, { cache: 'no-store' }),
        fetch(`/api/news/latest${counterpartParam}`, { cache: 'no-store' }),
      ]);

      if (editionRes.ok) {
        const data = (await editionRes.json()) as NewsEdition;
        applyEdition(data);
      }

      if (topicsRes.ok) {
        const data = (await topicsRes.json()) as Array<{ topic: string; count: number }>;
        setTopics(data);
      }

      if (counterpartRes.ok) {
        const data = (await counterpartRes.json()) as NewsEdition;
        setCounterpartStoryCount(data.items.length);
      }
    } catch (error) {
      console.error('Failed to load daily news module', error);
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [applyEdition, region]);

  useEffect(() => {
    void load();
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
    let filtered =
      activeTopic === 'all'
        ? source
        : source.filter((item) =>
            item.topic_tags.some((tag) => tag.toLowerCase() === activeTopic.toLowerCase())
          );

    if (hiddenIds.size > 0) {
      filtered = filtered.filter((item) => !hiddenIds.has(item.id));
    }

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
  }, [activeTopic, edition, hiddenIds, sortMode]);

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

  const allClusterIds = useMemo(() => edition?.items.map((item) => item.id) || [], [edition?.items]);

  const initialUpvoteCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!edition?.items) return counts;
    for (const item of edition.items) {
      if (item.upvote_count != null && item.upvote_count > 0) {
        counts[item.id] = item.upvote_count;
      }
    }
    return counts;
  }, [edition?.items]);

  const selectedItem = useMemo(
    () => (selectedStoryId ? sortedItems.find((item) => item.id === selectedStoryId) || null : null),
    [selectedStoryId, sortedItems]
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
            <p className="label-xs text-accent-info">{l.signalFeed}</p>
            <h2 className="mt-3 text-2xl font-light tracking-tight text-foreground">
              {l.startupNewsIntelligence}
            </h2>
            <p className="mt-3 text-sm text-muted-foreground max-w-lg mx-auto">
              {l.emptyStateDescription}
            </p>
            <Link
              href={newsBasePath}
              className="mt-6 inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90"
            >
              {l.openSignalFeed}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </PageContainer>
      </section>
    );
  }

  return (
    <SignalsProvider clusterIds={allClusterIds} initialUpvoteCounts={initialUpvoteCounts}>
      <section className={`relative overflow-hidden py-16 ${className || ''}`}>
        <PageContainer className="relative">
          {pendingEdition ? (
            <div className="mb-4 rounded-xl border border-accent-info/35 bg-accent-info/10 px-4 py-3 text-sm text-foreground">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-accent-info" />
                  <span>
                    <strong>{newSignalCount}</strong>{' '}
                    {newSignalCount === 1 ? l.newReadySingle : l.newReadyPlural}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    editionRef.current = pendingEdition;
                    setEdition(pendingEdition);
                    setPendingEdition(null);
                    setNewSignalCount(0);
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-accent-info/40 px-3 py-1 text-xs uppercase tracking-wider text-accent-info hover:bg-accent-info/15"
                >
                  {l.refreshFeed}
                  <ArrowUpRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          ) : null}

          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="label-xs text-accent-info">{l.todaysBriefing}</div>
              <div className="mt-2 flex items-center gap-3">
                <h2 className="text-4xl font-light tracking-tight text-foreground">{l.signalFeed}</h2>
                <div className="flex items-center gap-1">
                  <span className="rounded-full border border-accent-info/25 bg-accent-info/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-accent-info">
                    {l.signalFeed}
                  </span>
                  <Link
                    href={newsBasePath}
                    className="rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted/25 hover:text-foreground"
                  >
                    {l.radar}
                  </Link>
                </div>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {l.rankedBy}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {briefDismissed && edition.brief && activeTopic === 'all' && (
                <button
                  onClick={handleRestoreBrief}
                  className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-muted/20 px-3 py-1 text-[11px] uppercase tracking-wider text-accent-info/60 transition-colors hover:text-accent-info"
                >
                  <Newspaper className="h-3 w-3" />
                  {l.showBriefing}
                </button>
              )}
              <span className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-muted/20 px-3 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                <Activity className="h-3 w-3 text-success" />
                {l.live}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-muted/20 px-3 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                <RefreshCcw className={`h-3 w-3 ${isPolling ? 'animate-spin text-accent-info' : ''}`} />
                {l.updated} {formatTimestamp(edition.generated_at, region)}
              </span>
              {crossSourceCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-success/25 bg-success/10 px-3 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                  {crossSourceCount} {l.corroborated}
                </span>
              )}
            </div>
          </div>

          <Link
            href={newsBasePath}
            className="group mb-6 flex flex-col gap-3 rounded-xl border border-accent-info/25 bg-gradient-to-br from-accent-info/8 via-card/80 to-card/50 px-5 py-4 transition-all hover:border-accent-info/40 hover:shadow-[0_0_24px_rgba(59,130,246,0.06)] sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <span className="text-muted-foreground">
                <span className="font-medium text-foreground tabular-nums">{edition.items.length}</span> {l.signalsToday}
              </span>
              <span className="text-muted-foreground">
                {l.counterpartLabel}: <span className="font-medium text-foreground tabular-nums">{counterpartStoryCount ?? '—'}</span> {l.signals}
              </span>
              {topics.length > 0 && (
                <span className="hidden text-muted-foreground sm:inline">
                  {l.topTopics}: {topics.slice(0, 3).map((t) => t.topic).join(', ')}
                </span>
              )}
            </div>
            <span className="inline-flex items-center gap-1 text-sm text-accent-info transition-colors group-hover:text-accent-info/80">
              {l.openRadar}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </span>
          </Link>

          <div className="mb-6 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSortMode('impact')}
                className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-wider transition-colors ${sortMode === 'impact' ? 'border-accent-info/55 bg-accent-info/15 text-accent-info' : 'border-border/40 bg-muted/20 text-muted-foreground hover:border-accent-info/35 hover:text-foreground'}`}
              >
                {l.rankImpact}
              </button>
              <button
                type="button"
                onClick={() => setSortMode('latest')}
                className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-wider transition-colors ${sortMode === 'latest' ? 'border-accent-info/55 bg-accent-info/15 text-accent-info' : 'border-border/40 bg-muted/20 text-muted-foreground hover:border-accent-info/35 hover:text-foreground'}`}
              >
                {l.rankLatest}
              </button>
            </div>
            <div className="overflow-x-auto pb-1">
              <div className="flex min-w-max items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTopic('all')}
                  className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-wider transition-colors ${activeTopic === 'all' ? 'border-accent-info/55 bg-accent-info/15 text-accent-info' : 'border-border/40 bg-muted/20 text-muted-foreground hover:border-accent-info/35 hover:text-foreground'}`}
                >
                  {l.allTopics}
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

          {edition.brief && activeTopic === 'all' && !briefDismissed && (
            <div className="mb-6">
              <DailyBriefCard brief={edition.brief} onDismiss={handleDismissBrief} region={region} />
            </div>
          )}

          <div className="space-y-7">
            <div className="space-y-7">
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
                    <StoryCard
                      item={item}
                      isSelected={selectedStoryId === item.id}
                      onSelect={selectStory}
                      onHide={handleHideStory}
                      region={region}
                    />
                  </motion.div>
                ))}
              </div>

              {sections.breaking.length > 0 && (
                <div>
                  <SectionHeader label={l.breaking} indicator="pulse" count={sections.breaking.length} />
                  <div className="mt-3 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {sections.breaking.map((item) => (
                      <StoryCard
                        key={item.id}
                        item={item}
                        isSelected={selectedStoryId === item.id}
                        onSelect={selectStory}
                        onHide={handleHideStory}
                        region={region}
                      />
                    ))}
                  </div>
                </div>
              )}

              {sections.deepReads.length > 0 && (
                <div>
                  <SectionHeader label={l.deepReads} indicator="signal" count={sections.deepReads.length} />
                  <div className="mt-3 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {sections.deepReads.map((item) => (
                      <StoryCard
                        key={item.id}
                        item={item}
                        isSelected={selectedStoryId === item.id}
                        onSelect={selectStory}
                        onHide={handleHideStory}
                        region={region}
                      />
                    ))}
                  </div>
                </div>
              )}

              {sections.remaining.length > 0 && (
                <div>
                  <SectionHeader label={l.moreSignals} count={sections.remaining.length} />
                  <div className="mt-3 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {sections.remaining.slice(0, 6).map((item) => (
                      <StoryCard
                        key={item.id}
                        item={item}
                        isSelected={selectedStoryId === item.id}
                        onSelect={selectStory}
                        onHide={handleHideStory}
                        region={region}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/40 bg-card/50 px-4 py-3 text-sm">
            <p className="text-muted-foreground">
              {l.showing} <span className="text-foreground tabular-nums">{sortedItems.length}</span>{' '}
              {l.signals}
              {activeTopic !== 'all' ? (
                <>
                  {' '}{l.forTopic} <span className="text-foreground">{activeTopic}</span>
                </>
              ) : null}
              .
            </p>
            <Link href={newsBasePath} className="inline-flex items-center gap-1 text-accent-info hover:text-accent-info/80">
              {l.openFullRadar}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="mt-4 grid items-start gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <NewsSubscriptionCard region={region} />
            </div>
            <div className="rounded-2xl border border-border/40 bg-card/60 p-4">
              <p className="label-xs text-accent-info">{l.archive}</p>
              <h3 className="mt-2 text-lg font-medium tracking-tight text-foreground">{l.scrollBack}</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {l.browseEditions}
              </p>
              <Link
                href={archivePath}
                className="mt-4 inline-flex items-center gap-1 text-sm text-accent-info hover:text-accent-info/80"
              >
                {l.openArchive}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </PageContainer>
      </section>

      {selectedItem && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => selectStory(null)}
          />
          <div className="absolute inset-x-0 bottom-0 top-16 bg-card border-t border-border/30 rounded-t-2xl overflow-hidden animate-fade-up lg:inset-y-0 lg:right-0 lg:left-auto lg:top-0 lg:bottom-0 lg:w-[520px] lg:rounded-none lg:border-t-0 lg:border-l lg:animate-slide-in-right">
            <ContextPanel
              selectedItem={selectedItem}
              allItems={sortedItems}
              onClose={() => selectStory(null)}
              region={region}
            />
          </div>
        </div>
      )}
    </SignalsProvider>
  );
}
