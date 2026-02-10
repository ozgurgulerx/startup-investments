'use client';

import type { NewsItemCard } from '@startup-intelligence/shared';
import { StoryContext } from './story-context';

interface ContextPanelProps {
  selectedItem: NewsItemCard | null;
  allItems: NewsItemCard[];
  onClose: () => void;
  region?: 'global' | 'turkey';
}

function ContextEmptyState() {
  return (
    <div className="h-full px-6 py-6">
      <p className="text-sm font-medium tracking-tight text-foreground">Select a story</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground max-w-sm">
        This space is reserved for context. Pick a story to open the detail view with sources, entities, and related coverage.
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
              <kbd className="rounded border border-border/50 bg-background/70 px-2 py-0.5 text-[10px] text-foreground">j</kbd>
              <kbd className="rounded border border-border/50 bg-background/70 px-2 py-0.5 text-[10px] text-foreground">k</kbd>
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>Open article</span>
            <kbd className="rounded border border-border/50 bg-background/70 px-2 py-0.5 text-[10px] text-foreground">o</kbd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>Close</span>
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
  region = 'global',
}: ContextPanelProps) {
  // Find related stories: same topic or overlapping entities
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
      <div className="flex-1 min-h-0">
        {selectedItem ? (
          <StoryContext
            item={selectedItem}
            onClose={onClose}
            relatedStories={related}
            region={region}
          />
        ) : (
          <ContextEmptyState />
        )}
      </div>
    </div>
  );
}
