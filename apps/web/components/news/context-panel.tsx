'use client';

import { TrendingUp } from 'lucide-react';
import type { NewsItemCard } from '@startup-intelligence/shared';
import { StoryContext } from './story-context';

interface SignalRailProps {
  trendingEntities: Array<[string, number]>;
  fundingSignal: { title: string; amount: string | null; url: string } | null;
  corroboratedStories: Array<{ id: string; title: string; sources: number }>;
}

function SignalRail({ trendingEntities, fundingSignal, corroboratedStories }: SignalRailProps) {
  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center gap-2 mb-1">
        <TrendingUp className="h-4 w-4 text-accent-info" />
        <h3 className="text-sm font-medium tracking-tight text-foreground">Signal Rail</h3>
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
              <p key={story.id} className="text-xs text-muted-foreground">
                <span className="text-foreground">{story.title}</span>{' '}
                <span className="opacity-70">({story.sources} sources)</span>
              </p>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">Waiting for multi-source confirmation.</p>
          )}
        </div>
      </div>
    </div>
  );
}

interface ContextPanelProps {
  selectedItem: NewsItemCard | null;
  allItems: NewsItemCard[];
  onClose: () => void;
  trendingEntities: Array<[string, number]>;
  fundingSignal: { title: string; amount: string | null; url: string } | null;
  corroboratedStories: Array<{ id: string; title: string; sources: number }>;
}

export function ContextPanel({
  selectedItem,
  allItems,
  onClose,
  trendingEntities,
  fundingSignal,
  corroboratedStories,
}: ContextPanelProps) {
  if (selectedItem) {
    // Find related stories: same topic or overlapping entities
    const related = allItems
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
      .slice(0, 3);

    return (
      <StoryContext
        item={selectedItem}
        onClose={onClose}
        relatedStories={related}
      />
    );
  }

  return (
    <SignalRail
      trendingEntities={trendingEntities}
      fundingSignal={fundingSignal}
      corroboratedStories={corroboratedStories}
    />
  );
}
