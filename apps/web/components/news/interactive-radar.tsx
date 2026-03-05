'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Activity, RefreshCcw, Sparkles, ArrowUpRight, Newspaper } from 'lucide-react';
import type { NewsEdition } from '@startup-intelligence/shared';
import { safeDate } from '@/lib/safe-date';
import { PageContainer } from '@/components/layout/page-container';
import { CommandBar, type SortMode, type TimeWindow } from './command-bar';
import { DailyBriefCard } from './daily-brief-card';
import { KpiStrip } from './kpi-strip';
import { StoryCard } from './story-row';
import { ContextPanel } from './context-panel';
import { NewsSubscriptionCard } from './news-subscription-card';
import { PeriodicBriefPreview, type PeriodicBriefPreviewProps } from './periodic-brief-preview';
import { SignalsProvider } from './signals-provider';
import { isDecisionCardsEnabled } from '@/lib/radar-flags';
import type { ViewMode } from './view-toggle';

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

function scrollStoryIntoView(id: string) {
  const selectorId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id;
  const el = document.querySelector<HTMLElement>(`[data-story-id="${selectorId}"]`);
  el?.scrollIntoView({ block: 'center', behavior: 'auto' });
}

function countNewSignals(current: NewsEdition | null, incoming: NewsEdition): number {
  if (!current) return incoming.items.length;
  const seen = new Set(current.items.map((item) => item.id));
  let count = 0;
  for (const item of incoming.items) {
    if (!seen.has(item.id)) count += 1;
  }
  return count;
}

interface InteractiveRadarProps {
  initialEdition: NewsEdition;
  initialTopics: Array<{ topic: string; count: number }>;
  /** When true, disables live polling (e.g. archive pages). */
  isArchive?: boolean;
  /** Region partition for the edition (global|turkey). */
  region?: 'global' | 'turkey';
  /** Latest weekly/monthly brief previews (server-fetched). */
  periodicBriefs?: Pick<PeriodicBriefPreviewProps, 'weeklyBrief' | 'monthlyBrief'>;
}

export function InteractiveRadar({ initialEdition, initialTopics, isArchive, region = 'global', periodicBriefs }: InteractiveRadarProps) {
  const l = region === 'turkey'
    ? {
      unsubscribed: 'Abonelikten ciktiniz. Artik ozet e-postasi almayacaksiniz.',
      unsubscribedInvalid: 'Abonelikten cikis linki gecersiz veya zaten kullanildi.',
      confirmed: 'Abonelik onaylandi. Artik abonesiniz.',
      alreadyConfirmed: 'Zaten onayli. Abonelik aktif.',
      confirmExpired: 'Onay linki suresi dolmus veya gecersiz. Yeni link icin tekrar abone olun.',
      dismiss: 'Kapat',
      newReadySingle: 'yeni sinyal hazir.',
      newReadyPlural: 'yeni sinyal hazir.',
      editionUpdated: 'Signal Feed guncellendi.',
      refreshFeed: 'Akisi yenile',
      showBriefing: 'Ozeti goster',
      live: 'Canli',
      updated: 'Guncellendi',
      updateReady: 'guncelleme hazir',
      noSignals: 'Filtrelerinize uygun sinyal bulunamadi.',
    }
    : {
      unsubscribed: 'Unsubscribed. You will no longer receive digest emails.',
      unsubscribedInvalid: 'Unsubscribe link was invalid or already used.',
      confirmed: 'Subscription confirmed. You are now subscribed.',
      alreadyConfirmed: 'Already confirmed. You are subscribed.',
      confirmExpired: 'Confirmation link expired or invalid. Subscribe again to receive a new link.',
      dismiss: 'Dismiss',
      newReadySingle: 'new signal ready.',
      newReadyPlural: 'new signals ready.',
      editionUpdated: 'Signal Feed updated.',
      refreshFeed: 'Refresh feed',
      showBriefing: 'Show briefing',
      live: 'Live',
      updated: 'Updated',
      updateReady: 'update ready',
      noSignals: 'No signals match your filters.',
    };
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('story') || null;
  const confirmed = searchParams.get('confirmed');
  const unsubscribed = searchParams.get('unsubscribed');

  const [edition, setEdition] = useState<NewsEdition>(initialEdition);
  const [topics, setTopics] = useState(initialTopics);
  const [pendingEdition, setPendingEdition] = useState<NewsEdition | null>(null);
  const [newSignalCount, setNewStoryCount] = useState(0);
  const [isPolling, setIsPolling] = useState(false);
  const editionRef = useRef<NewsEdition>(initialEdition);
  const isPollingRef = useRef(false);
  const lastFocusRefreshAtRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const clearNewStoryIdsTimeoutRef = useRef<number | null>(null);
  const [newStoryIds, setNewStoryIds] = useState<Set<string>>(() => new Set());

  const [sortMode, setSortMode] = useState<SortMode>('impact');
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('all');
  const [activeTopic, setActiveTopic] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [hideLowTrust, setHideLowTrust] = useState(false);

  // Decision cards feature flag + view mode
  const [decisionCardsEnabled] = useState(() => isDecisionCardsEnabled());
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('buildatlas:radar-view-mode') as ViewMode) || 'strategy';
    }
    return 'strategy';
  });
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('buildatlas:radar-view-mode', mode);
  }, []);

  const handleHideStory = useCallback((id: string) => {
    setHiddenIds((prev) => new Set(prev).add(id));
  }, []);

  // Brief dismiss state (persisted in localStorage)
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

  // Polling
  const applyEdition = useCallback((data: NewsEdition) => {
    const current = editionRef.current;
    if (current.generated_at === data.generated_at) {
      editionRef.current = data;
      setEdition(data);
      return;
    }
    setPendingEdition(data);
    setNewStoryCount(countNewSignals(current, data));
  }, []);

  const refreshLatest = useCallback(async () => {
    if (isArchive) return;
    if (isPollingRef.current) return;

    isPollingRef.current = true;
    setIsPolling(true);
    try {
      const regionParam = region === 'turkey' ? '?region=turkey' : '';
      const [editionRes, topicsRes] = await Promise.all([
        fetch(`/api/news/latest${regionParam}`, { cache: 'no-store' }),
        fetch(`/api/news/topics${regionParam}`, { cache: 'no-store' }),
      ]);
      if (editionRes.ok) {
        applyEdition(await editionRes.json());
      }
      if (topicsRes.ok) {
        setTopics(await topicsRes.json());
      }
    } catch {
      // Silent refresh failure
    } finally {
      isPollingRef.current = false;
      setIsPolling(false);
    }
  }, [applyEdition, isArchive, region]);

  useEffect(() => {
    if (isArchive) return;
    const poll = window.setInterval(() => {
      void refreshLatest();
    }, 5 * 60 * 1000);
    return () => window.clearInterval(poll);
  }, [isArchive, refreshLatest]);

  useEffect(() => {
    if (isArchive) return;

    const maybeRefresh = () => {
      if (document.visibilityState !== 'visible') return;

      const now = Date.now();
      if (now - lastFocusRefreshAtRef.current < 15_000) return;
      lastFocusRefreshAtRef.current = now;

      void refreshLatest();
    };

    window.addEventListener('focus', maybeRefresh);
    document.addEventListener('visibilitychange', maybeRefresh);
    return () => {
      window.removeEventListener('focus', maybeRefresh);
      document.removeEventListener('visibilitychange', maybeRefresh);
    };
  }, [isArchive, refreshLatest]);

  // URL-driven story selection
  const selectStory = useCallback((id: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id) {
      params.set('story', id);
    } else {
      params.delete('story');
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const handleSelectStory = useCallback((id: string | null) => {
    if (id && newStoryIds.has(id)) {
      setNewStoryIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
    selectStory(id);
  }, [newStoryIds, selectStory]);

  useEffect(() => {
    return () => {
      if (clearNewStoryIdsTimeoutRef.current) {
        window.clearTimeout(clearNewStoryIdsTimeoutRef.current);
      }
    };
  }, []);

  // Filter + sort
  const filteredItems = useMemo(() => {
    let items = [...edition.items];

    // Hidden filter (client-side)
    if (hiddenIds.size > 0) {
      items = items.filter((item) => !hiddenIds.has(item.id));
    }

    // Hide low-trust filter
    if (hideLowTrust) {
      items = items.filter((item) => item.trust_score >= 0.4);
    }

    // Time window filter
    if (timeWindow !== 'all') {
      const now = Date.now();
      const windowMs = timeWindow === '6h' ? 6 * 60 * 60 * 1000
        : timeWindow === '24h' ? 24 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000;
      items = items.filter((item) => {
        const t = safeDate(item.published_at).getTime();
        return t > 0 && now - t <= windowMs;
      });
    }

    // Topic filter
    if (activeTopic !== 'all') {
      items = items.filter((item) =>
        item.topic_tags.some((tag) => tag.toLowerCase() === activeTopic.toLowerCase())
      );
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter((item) =>
        item.title.toLowerCase().includes(q) ||
        (item.ba_title || '').toLowerCase().includes(q) ||
        (item.summary || '').toLowerCase().includes(q) ||
        item.entities.some((e) => e.toLowerCase().includes(q))
      );
    }

    // Sort
    if (sortMode === 'latest') {
      items.sort((a, b) =>
        safeDate(b.published_at).getTime() - safeDate(a.published_at).getTime()
      );
    } else if (sortMode === 'trust') {
      items.sort((a, b) => b.trust_score - a.trust_score);
    } else if (sortMode === 'signal') {
      items.sort((a, b) => (b.llm_signal_score ?? 0) - (a.llm_signal_score ?? 0));
    } else {
      items.sort((a, b) => {
        const impactA = a.rank_score * 0.72 + a.trust_score * 0.28;
        const impactB = b.rank_score * 0.72 + b.trust_score * 0.28;
        return impactB - impactA;
      });
    }

    return items;
  }, [edition.items, timeWindow, activeTopic, searchQuery, sortMode, hiddenIds, hideLowTrust]);

  const totalEntities = useMemo(() => {
    const set = new Set<string>();
    for (const item of edition.items) {
      for (const e of item.entities) set.add(e);
    }
    return set.size;
  }, [edition.items]);

  const crossSourceCount = edition.items.filter((item) => item.source_count >= 2).length;
  const selectedItem = selectedId ? filteredItems.find((item) => item.id === selectedId) || null : null;

  const allClusterIds = useMemo(() => edition.items.map((item) => item.id), [edition.items]);
  const initialUpvoteCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of edition.items) {
      if (item.upvote_count != null && item.upvote_count > 0) {
        counts[item.id] = item.upvote_count;
      }
    }
    return counts;
  }, [edition.items]);

  const orderedIds = useMemo(() => filteredItems.map((item) => item.id), [filteredItems]);

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null): boolean {
      if (!target) return false;
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return target.isContentEditable;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const typing = isTypingTarget(e.target);

      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (e.key === 'Escape') {
        if (selectedId) {
          e.preventDefault();
          handleSelectStory(null);
        }
        return;
      }

      if (e.key === 'o' && !typing && selectedId) {
        const item = filteredItems.find((i) => i.id === selectedId);
        if (item?.url) {
          e.preventDefault();
          window.open(item.url, '_blank', 'noopener,noreferrer');
          return;
        }
      }

      const isNext = e.key === 'j' || e.key === 'ArrowDown';
      const isPrev = e.key === 'k' || e.key === 'ArrowUp';
      if ((!isNext && !isPrev) || typing) return;

      if (orderedIds.length === 0) return;
      e.preventDefault();

      const currentIndex = selectedId ? orderedIds.indexOf(selectedId) : -1;
      const nextIndex = currentIndex === -1
        ? 0
        : isNext
          ? Math.min(orderedIds.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);
      const nextId = orderedIds[nextIndex];
      if (!nextId) return;
      handleSelectStory(nextId);
      requestAnimationFrame(() => scrollStoryIntoView(nextId));
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [filteredItems, handleSelectStory, orderedIds, selectedId]);

  // Auto-scroll to deep-linked signal on initial load
  useEffect(() => {
    if (!selectedId) return;
    const timer = setTimeout(() => {
      scrollStoryIntoView(selectedId);
    }, 300);
    return () => clearTimeout(timer);
  }, [selectedId]);

  const statusBanner = (() => {
    if (unsubscribed === '1') {
      return { tone: 'success' as const, text: l.unsubscribed };
    }
    if (unsubscribed === '0') {
      return { tone: 'warn' as const, text: l.unsubscribedInvalid };
    }
    if (confirmed === '1') {
      return { tone: 'success' as const, text: l.confirmed };
    }
    if (confirmed === 'already') {
      return { tone: 'success' as const, text: l.alreadyConfirmed };
    }
    if (confirmed === 'expired') {
      return { tone: 'warn' as const, text: l.confirmExpired };
    }
    return null;
  })();

  const dismissStatusBanner = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('confirmed');
    params.delete('unsubscribed');
    router.replace(params.toString() ? `?${params.toString()}` : '?', { scroll: false });
  }, [router, searchParams]);

	  return (
	    <SignalsProvider clusterIds={allClusterIds} initialUpvoteCounts={initialUpvoteCounts}>
	    <div className="flex flex-col flex-1 min-h-0">
	      {/* Confirmation/unsubscribe banner */}
	      {statusBanner && (
	        <PageContainer className="pt-2">
	          <div className={`rounded-xl border px-4 py-2.5 text-sm text-foreground ${
	            statusBanner.tone === 'success'
	              ? 'border-success/35 bg-success/10'
	              : 'border-warning/35 bg-warning/10'
	          }`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{statusBanner.text}</span>
              <button
                type="button"
                onClick={dismissStatusBanner}
                className="inline-flex items-center rounded-full border border-border/40 px-3 py-1 text-xs uppercase tracking-wider text-muted-foreground hover:bg-muted/20 hover:text-foreground"
              >
                {l.dismiss}
              </button>
            </div>
	          </div>
	        </PageContainer>
	      )}
	
	      {/* Pending update banner */}
	      {pendingEdition && (
	        <PageContainer className="pt-2">
	          <div className="rounded-xl border border-accent-info/35 bg-accent-info/10 px-4 py-2.5 text-sm text-foreground">
	            <div className="flex flex-wrap items-center justify-between gap-3">
	              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent-info" />
                {newSignalCount > 0 ? (
                  <span><strong>{newSignalCount}</strong> {newSignalCount === 1 ? l.newReadySingle : l.newReadyPlural}</span>
                ) : (
                  <span>{l.editionUpdated}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  const nextEdition = pendingEdition;
                  if (!nextEdition) return;

                  const current = editionRef.current;
                  const seen = new Set(current.items.map((item) => item.id));
                  const incoming = nextEdition.items.map((item) => item.id).filter((id) => !seen.has(id));

                  setNewStoryIds(new Set(incoming));
                  if (clearNewStoryIdsTimeoutRef.current) {
                    window.clearTimeout(clearNewStoryIdsTimeoutRef.current);
                  }
                  clearNewStoryIdsTimeoutRef.current = window.setTimeout(() => {
                    setNewStoryIds(new Set());
                  }, 10 * 60 * 1000);

                  editionRef.current = nextEdition;
                  setEdition(nextEdition);
                  setPendingEdition(null);
                  setNewStoryCount(0);
                }}
                className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs uppercase tracking-wider text-accent hover:bg-accent/15"
              >
                {l.refreshFeed}
                <ArrowUpRight className="h-3 w-3" />
	              </button>
	            </div>
	          </div>
	        </PageContainer>
	      )}

      {/* Command Bar */}
      <CommandBar
        sortMode={sortMode}
        onSortChange={setSortMode}
        timeWindow={timeWindow}
        onTimeWindowChange={setTimeWindow}
        activeTopic={activeTopic}
        onTopicChange={setActiveTopic}
        topics={topics}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchInputRef={searchInputRef}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        showViewToggle={decisionCardsEnabled}
        hideLowTrust={hideLowTrust}
        onHideLowTrustChange={setHideLowTrust}
        region={region}
      />

	      {/* KPI Strip + status */}
	      <div className="border-b border-border/20">
	        <PageContainer className="flex items-center justify-between py-2">
	          <KpiStrip
	            totalStories={filteredItems.length}
	            crossSourceCount={crossSourceCount}
	            totalEntities={totalEntities}
            totalClusters={edition.stats.total_clusters}
            region={region}
          />
          <div className="flex items-center gap-2">
            {briefDismissed && edition.brief && activeTopic === 'all' && !searchQuery.trim() && (
              <button
                onClick={handleRestoreBrief}
                className="inline-flex items-center gap-1 text-[10px] text-accent-info/60 transition-colors hover:text-accent-info"
              >
                <Newspaper className="h-3 w-3" />
                {l.showBriefing}
              </button>
            )}
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              <Activity className="h-3 w-3 text-success" />
              {l.live}
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70">
              <RefreshCcw className={`h-3 w-3 ${isPolling ? 'animate-spin text-accent-info' : ''}`} />
              {l.updated} {formatTimestamp(edition.generated_at, region)}
              {pendingEdition ? <span className="text-accent-info/70">· {l.updateReady}</span> : null}
	            </span>
	          </div>
	        </PageContainer>
	      </div>

      {/* LLM daily brief */}
	      {edition.brief && activeTopic === 'all' && !searchQuery.trim() && !briefDismissed && (
	        <div className="border-b border-border/20">
	          <PageContainer>
	            <DailyBriefCard brief={edition.brief} onDismiss={handleDismissBrief} region={region} />
	          </PageContainer>
	        </div>
	      )}

      {/* Periodic brief previews (weekly / monthly) */}
	      {activeTopic === 'all' && !searchQuery.trim() && periodicBriefs && (periodicBriefs.weeklyBrief || periodicBriefs.monthlyBrief) && (
	        <div className="border-b border-border/20">
	          <PageContainer className="py-3">
	            <PeriodicBriefPreview
	              region={region}
	              weeklyBrief={periodicBriefs.weeklyBrief}
	              monthlyBrief={periodicBriefs.monthlyBrief}
	            />
	          </PageContainer>
	        </div>
	      )}

	      {/* Feed + context */}
	      <div className="flex-1 min-h-0">
	        <PageContainer className="h-full min-h-0 px-0">
	          {/* Feed */}
	          <div className="h-full min-h-0 overflow-y-auto">
	            {/* Story cards */}
	            {filteredItems.length > 0 ? (
	              <div className="px-6 py-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredItems.map((item) => (
                    <StoryCard
                      key={item.id}
                      item={item}
                      isSelected={selectedId === item.id}
                      onSelect={(id) => handleSelectStory(id)}
                      isNew={newStoryIds.has(item.id)}
                      onHide={handleHideStory}
                      region={region}
                      viewMode={decisionCardsEnabled ? viewMode : undefined}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                {l.noSignals}
              </div>
            )}

            {/* Subscribe CTA */}
	            <div className="px-6 py-8 border-t border-border/20 bg-background/40">
	              <div className="mx-auto max-w-2xl">
	                <NewsSubscriptionCard region={region} />
	              </div>
	            </div>
	          </div>
	        </PageContainer>
	      </div>

      {/* Story context drawer (overlay) */}
      {selectedItem && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => handleSelectStory(null)}
          />
          <div className="absolute inset-x-0 bottom-0 top-16 bg-card border-t border-border/30 rounded-t-2xl overflow-hidden animate-fade-up lg:inset-y-0 lg:right-0 lg:left-auto lg:top-0 lg:bottom-0 lg:w-[520px] lg:rounded-none lg:border-t-0 lg:border-l lg:animate-slide-in-right">
            <ContextPanel
              selectedItem={selectedItem}
              allItems={filteredItems}
              onClose={() => handleSelectStory(null)}
              region={region}
            />
          </div>
        </div>
      )}
    </div>
    </SignalsProvider>
  );
}
