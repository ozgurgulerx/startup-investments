'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Activity, RefreshCcw, Sparkles, ArrowUpRight } from 'lucide-react';
import type { NewsEdition, NewsItemCard } from '@startup-intelligence/shared';
import { CommandBar, type SortMode, type TimeWindow } from './command-bar';
import { KpiStrip } from './kpi-strip';
import { StoryRow, PinnedStoryCard } from './story-row';
import { ContextPanel } from './context-panel';
import { NewsSubscriptionCard } from './news-subscription-card';

function extractFundingSignal(text: string): string | null {
  const match = text.match(/([$€£]\s?\d+(?:\.\d+)?\s?(?:[mb]|million|billion)?)/i);
  return match?.[1] || null;
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function countNewStories(current: NewsEdition | null, incoming: NewsEdition): number {
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
}

export function InteractiveRadar({ initialEdition, initialTopics, isArchive }: InteractiveRadarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('story') || null;
  const confirmed = searchParams.get('confirmed');
  const unsubscribed = searchParams.get('unsubscribed');

  const [edition, setEdition] = useState<NewsEdition>(initialEdition);
  const [topics, setTopics] = useState(initialTopics);
  const [pendingEdition, setPendingEdition] = useState<NewsEdition | null>(null);
  const [newStoryCount, setNewStoryCount] = useState(0);
  const [isPolling, setIsPolling] = useState(false);
  const editionRef = useRef<NewsEdition>(initialEdition);
  const isPollingRef = useRef(false);

  const [sortMode, setSortMode] = useState<SortMode>('impact');
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('all');
  const [activeTopic, setActiveTopic] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Polling
  const applyEdition = useCallback((data: NewsEdition) => {
    const current = editionRef.current;
    if (current.generated_at === data.generated_at) {
      editionRef.current = data;
      setEdition(data);
      return;
    }
    setPendingEdition(data);
    setNewStoryCount(Math.max(1, countNewStories(current, data)));
  }, []);

  useEffect(() => {
    if (isArchive) return;
    const poll = window.setInterval(async () => {
      if (isPollingRef.current) return;
      isPollingRef.current = true;
      setIsPolling(true);
      try {
        const [editionRes, topicsRes] = await Promise.all([
          fetch('/api/news/latest', { cache: 'no-store' }),
          fetch('/api/news/topics', { cache: 'no-store' }),
        ]);
        if (editionRes.ok) {
          applyEdition(await editionRes.json());
        }
        if (topicsRes.ok) {
          setTopics(await topicsRes.json());
        }
      } catch {
        // Silent polling failure
      } finally {
        isPollingRef.current = false;
        setIsPolling(false);
      }
    }, 5 * 60 * 1000);
    return () => window.clearInterval(poll);
  }, [applyEdition, isArchive]);

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

  // Filter + sort
  const filteredItems = useMemo(() => {
    let items = [...edition.items];

    // Time window filter
    if (timeWindow !== 'all') {
      const now = Date.now();
      const windowMs = timeWindow === '6h' ? 6 * 60 * 60 * 1000
        : timeWindow === '24h' ? 24 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000;
      items = items.filter((item) => {
        const t = new Date(item.published_at).getTime();
        return Number.isFinite(t) && now - t <= windowMs;
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
        (item.summary || '').toLowerCase().includes(q) ||
        item.entities.some((e) => e.toLowerCase().includes(q))
      );
    }

    // Sort
    if (sortMode === 'latest') {
      items.sort((a, b) =>
        new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
      );
    } else {
      items.sort((a, b) => {
        const impactA = a.rank_score * 0.72 + a.trust_score * 0.28;
        const impactB = b.rank_score * 0.72 + b.trust_score * 0.28;
        return impactB - impactA;
      });
    }

    return items;
  }, [edition.items, timeWindow, activeTopic, searchQuery, sortMode]);

  // Derived data for context panel
  const trendingEntities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of filteredItems.slice(0, 20)) {
      for (const entity of item.entities || []) {
        const normalized = entity.trim();
        if (normalized.length < 3) continue;
        counts.set(normalized, (counts.get(normalized) || 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [filteredItems]);

  const fundingSignal = useMemo(() => {
    const item = filteredItems.find((entry) =>
      entry.topic_tags.some((tag) => tag.toLowerCase() === 'funding')
    );
    if (!item) return null;
    return {
      title: item.title,
      amount: extractFundingSignal(`${item.title} ${item.summary}`),
      url: item.url,
    };
  }, [filteredItems]);

  const corroboratedStories = useMemo(
    () =>
      filteredItems
        .filter((item) => item.source_count >= 3)
        .slice(0, 3)
        .map((item) => ({ id: item.id, title: item.title, sources: item.source_count })),
    [filteredItems]
  );

  const totalEntities = useMemo(() => {
    const set = new Set<string>();
    for (const item of edition.items) {
      for (const e of item.entities) set.add(e);
    }
    return set.size;
  }, [edition.items]);

  const crossSourceCount = edition.items.filter((item) => item.source_count >= 2).length;
  const selectedItem = selectedId ? filteredItems.find((item) => item.id === selectedId) || null : null;

  // Pinned story = first item in impact sort
  const pinnedItem = filteredItems[0];
  const feedItems = filteredItems.slice(1);

  const statusBanner = (() => {
    if (unsubscribed === '1') {
      return { tone: 'success' as const, text: 'Unsubscribed. You will no longer receive digest emails.' };
    }
    if (unsubscribed === '0') {
      return { tone: 'warn' as const, text: 'Unsubscribe link was invalid or already used.' };
    }
    if (confirmed === '1') {
      return { tone: 'success' as const, text: 'Subscription confirmed. You are now subscribed.' };
    }
    if (confirmed === 'already') {
      return { tone: 'success' as const, text: 'Already confirmed. You are subscribed.' };
    }
    if (confirmed === 'expired') {
      return { tone: 'warn' as const, text: 'Confirmation link expired or invalid. Subscribe again to receive a new link.' };
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
    <div className="flex flex-col h-full">
      {/* Confirmation/unsubscribe banner */}
      {statusBanner && (
        <div className={`mx-4 mt-2 rounded-xl border px-4 py-2.5 text-sm text-foreground ${
          statusBanner.tone === 'success'
            ? 'border-success/35 bg-success/10'
            : 'border-amber-400/35 bg-amber-400/10'
        }`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{statusBanner.text}</span>
            <button
              type="button"
              onClick={dismissStatusBanner}
              className="inline-flex items-center rounded-full border border-border/40 px-3 py-1 text-xs uppercase tracking-wider text-muted-foreground hover:bg-muted/20 hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Pending update banner */}
      {pendingEdition && (
        <div className="mx-4 mt-2 mb-0 rounded-xl border border-accent-info/35 bg-accent-info/10 px-4 py-2.5 text-sm text-foreground">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent-info" />
              <span><strong>{newStoryCount}</strong> new {newStoryCount === 1 ? 'story' : 'stories'} ready.</span>
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
      />

      {/* KPI Strip + status */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/20">
        <KpiStrip
          totalStories={filteredItems.length}
          crossSourceCount={crossSourceCount}
          totalEntities={totalEntities}
          totalClusters={edition.stats.total_clusters}
        />
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            <Activity className="h-3 w-3 text-success" />
            Live
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70">
            <RefreshCcw className={`h-3 w-3 ${isPolling ? 'animate-spin text-accent-info' : ''}`} />
            {formatTimestamp(edition.generated_at)}
          </span>
        </div>
      </div>

      {/* Master-detail grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0">
        {/* Feed (left) */}
        <div className="lg:col-span-8 overflow-y-auto border-r border-border/20">
          {/* Pinned top impact */}
          {pinnedItem && (
            <div className="p-4 border-b border-border/20">
              <PinnedStoryCard
                item={pinnedItem}
                isSelected={selectedId === pinnedItem.id}
                onSelect={selectStory}
                isPinned
              />
            </div>
          )}

          {/* Story rows */}
          {feedItems.length > 0 ? (
            feedItems.map((item) => (
              <StoryRow
                key={item.id}
                item={item}
                isSelected={selectedId === item.id}
                onSelect={selectStory}
              />
            ))
          ) : (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              No stories match your filters.
            </div>
          )}

          {/* Subscribe CTA */}
          <div className="p-4 border-t border-border/20 bg-background/40">
            <NewsSubscriptionCard region="global" />
          </div>
        </div>

        {/* Context panel (right) */}
        <aside className="lg:col-span-4 overflow-y-auto hidden lg:block border-l border-border/20 bg-card/30">
          <ContextPanel
            selectedItem={selectedItem}
            allItems={filteredItems}
            onClose={() => selectStory(null)}
            trendingEntities={trendingEntities}
            fundingSignal={fundingSignal}
            corroboratedStories={corroboratedStories}
          />
        </aside>
      </div>

      {/* Mobile: Story context as sheet overlay */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => selectStory(null)}
          />
          <div className="absolute inset-x-0 bottom-0 top-16 bg-card border-t border-border/30 rounded-t-2xl overflow-y-auto animate-slide-in-right">
            <ContextPanel
              selectedItem={selectedItem}
              allItems={filteredItems}
              onClose={() => selectStory(null)}
              trendingEntities={trendingEntities}
              fundingSignal={fundingSignal}
              corroboratedStories={corroboratedStories}
            />
          </div>
        </div>
      )}
    </div>
  );
}
