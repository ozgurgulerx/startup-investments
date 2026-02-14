'use client';

import type { NewsItemCard } from '@startup-intelligence/shared';
import { StoryContext } from './story-context';

<<<<<<< Updated upstream
=======
interface SignalRailProps {
  trendingEntities: Array<[string, number]>;
  fundingSignal: { title: string; amount: string | null; url: string } | null;
  corroboratedStories: Array<{ id: string; title: string; sources: number }>;
  onSelectStory?: (id: string) => void;
}

function SignalRail({ trendingEntities, fundingSignal, corroboratedStories, onSelectStory }: SignalRailProps) {
  return (
    <div className="px-6 py-5 space-y-5">
      <div className="flex items-center gap-2 mb-1">
        <TrendingUp className="h-4 w-4 text-accent-info" />
        <h3 className="text-sm font-medium tracking-tight text-foreground">Live Signal Rail</h3>
      </div>

      {/* Trending entities */}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Trending entities</p>
        <div className="flex flex-wrap gap-1.5">
          {trendingEntities.slice(0, 6).map(([entity, count]) => (
            <span
              key={entity}
              className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              {entity}
              <span className="tabular-nums opacity-70">{count}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Funding signal */}
      <div className="rounded-lg border border-border/40 bg-background/60 p-3">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Biggest funding signal</p>
        {fundingSignal ? (
          <div className="space-y-1">
            <p className="text-sm text-foreground line-clamp-2">{fundingSignal.title}</p>
            <p className="text-xs text-accent-info">{fundingSignal.amount || 'Funding event detected'}</p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No high-confidence funding signal right now.</p>
        )}
      </div>

      {/* Corroborated stories */}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Corroborated stories</p>
        <div className="space-y-2">
          {corroboratedStories.length > 0 ? (
            corroboratedStories.map((story) => (
              <button
                key={story.id}
                type="button"
                onClick={() => onSelectStory?.(story.id)}
                className="w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <span className="text-foreground">{story.title}</span>{' '}
                <span className="opacity-70">({story.sources} sources)</span>
              </button>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">Waiting for multi-source confirmation.</p>
          )}
        </div>
      </div>
    </div>
  );
}

>>>>>>> Stashed changes
interface ContextPanelProps {
  selectedItem: NewsItemCard | null;
  allItems: NewsItemCard[];
  onClose: () => void;
<<<<<<< Updated upstream
  region?: 'global' | 'turkey';
}

function ContextEmptyState({ region = 'global' }: { region?: 'global' | 'turkey' }) {
  const l = region === 'turkey'
    ? {
      title: 'Bir sinyal secin',
      description: 'Bu alan baglam icindir. Kaynaklari, varliklari ve ilgili kapsami gormek icin bir sinyal secin.',
      keyboard: 'Klavye',
      search: 'Ara',
      navigate: 'Gezin',
      openArticle: 'Haberi ac',
      close: 'Kapat',
      or: 'veya',
    }
    : {
      title: 'Select a signal',
      description: 'This space is reserved for context. Pick a signal to open the detail view with sources, entities, and related coverage.',
      keyboard: 'Keyboard',
      search: 'Search',
      navigate: 'Navigate',
      openArticle: 'Open article',
      close: 'Close',
      or: 'or',
    };
  return (
    <div className="h-full px-6 py-6">
      <p className="text-sm font-medium tracking-tight text-foreground">{l.title}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground max-w-sm">
        {l.description}
      </p>

      <div className="mt-5 rounded-xl border border-border/35 bg-muted/15 p-4">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">{l.keyboard}</p>
        <div className="grid gap-2 text-xs text-muted-foreground">
          <div className="flex items-center justify-between gap-3">
            <span>{l.search}</span>
            <kbd className="rounded border border-border/50 bg-background/70 px-2 py-0.5 text-[10px] text-foreground">/</kbd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>{l.navigate}</span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded border border-border/50 bg-background/70 px-2 py-0.5 text-[10px] text-foreground">↑</kbd>
              <kbd className="rounded border border-border/50 bg-background/70 px-2 py-0.5 text-[10px] text-foreground">↓</kbd>
              <span className="text-[10px] opacity-70">{l.or}</span>
=======
  onSelectStory?: (id: string) => void;
  trendingEntities: Array<[string, number]>;
  fundingSignal: { title: string; amount: string | null; url: string } | null;
  corroboratedStories: Array<{ id: string; title: string; sources: number }>;
}

function ContextEmptyState() {
  return (
    <div className="h-full px-6 py-6">
      <p className="text-sm font-medium tracking-tight text-foreground">Select a story</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground max-w-sm">
        This space is reserved for context. Pick a story on the left to open the detail view with sources, entities, and related coverage.
      </p>

      <div className="mt-5 rounded-xl border border-border/35 bg-muted/15 p-4">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Keyboard</p>
        <div className="grid gap-2 text-xs text-muted-foreground">
          <div className="flex items-center justify-between gap-3">
            <span>Search</span>
            <kbd className="rounded border border-border/50 bg-background/70 px-2 py-0.5 text-[10px] text-foreground">/</kbd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>Navigate</span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded border border-border/50 bg-background/70 px-2 py-0.5 text-[10px] text-foreground">↑</kbd>
              <kbd className="rounded border border-border/50 bg-background/70 px-2 py-0.5 text-[10px] text-foreground">↓</kbd>
              <span className="text-[10px] opacity-70">or</span>
>>>>>>> Stashed changes
              <kbd className="rounded border border-border/50 bg-background/70 px-2 py-0.5 text-[10px] text-foreground">j</kbd>
              <kbd className="rounded border border-border/50 bg-background/70 px-2 py-0.5 text-[10px] text-foreground">k</kbd>
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
<<<<<<< Updated upstream
            <span>{l.openArticle}</span>
            <kbd className="rounded border border-border/50 bg-background/70 px-2 py-0.5 text-[10px] text-foreground">o</kbd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>{l.close}</span>
=======
            <span>Close</span>
>>>>>>> Stashed changes
            <kbd className="rounded border border-border/50 bg-background/70 px-2 py-0.5 text-[10px] text-foreground">Esc</kbd>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ContextPanel({
  selectedItem,
  allItems,
  onClose,
<<<<<<< Updated upstream
  region = 'global',
}: ContextPanelProps) {
  // Find related signals: same topic or overlapping entities
=======
  onSelectStory,
  trendingEntities,
  fundingSignal,
  corroboratedStories,
}: ContextPanelProps) {
  // Find related stories: same topic or overlapping entities
>>>>>>> Stashed changes
  const related = selectedItem
    ? allItems
      .filter((item) => {
        if (item.id === selectedItem.id) return false;
        const sharedTopics = item.topic_tags.some((t) =>
          selectedItem.topic_tags.includes(t)
        );
        const sharedEntities = item.entities.some((e) =>
          selectedItem.entities.includes(e)
        );
        return sharedTopics || sharedEntities;
      })
      .slice(0, 3)
    : [];

  return (
    <div className="h-full flex flex-col min-h-0">
<<<<<<< Updated upstream
=======
      {/* Always-visible rail */}
      <div className="shrink-0 border-b border-border/20 bg-card/25 backdrop-blur-sm">
        <SignalRail
          trendingEntities={trendingEntities}
          fundingSignal={fundingSignal}
          corroboratedStories={corroboratedStories}
          onSelectStory={onSelectStory}
        />
      </div>

      {/* Reserved detail space */}
>>>>>>> Stashed changes
      <div className="flex-1 min-h-0">
        {selectedItem ? (
          <StoryContext
            item={selectedItem}
            onClose={onClose}
<<<<<<< Updated upstream
            relatedSignals={related}
            region={region}
          />
        ) : (
          <ContextEmptyState region={region} />
=======
            relatedStories={related}
          />
        ) : (
          <ContextEmptyState />
>>>>>>> Stashed changes
        )}
      </div>
    </div>
  );
}
