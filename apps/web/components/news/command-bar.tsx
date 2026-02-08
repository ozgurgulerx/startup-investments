'use client';

import { useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';

export type SortMode = 'impact' | 'latest';
export type TimeWindow = '6h' | '24h' | '7d' | 'all';

interface CommandBarProps {
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
  timeWindow: TimeWindow;
  onTimeWindowChange: (window: TimeWindow) => void;
  activeTopic: string;
  onTopicChange: (topic: string) => void;
  topics: Array<{ topic: string; count: number }>;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchInputRef?: React.RefObject<HTMLInputElement>;
}

function PillButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wider transition-colors
        ${active
          ? 'border-accent/55 bg-accent/15 text-accent'
          : 'border-border/40 bg-muted/20 text-muted-foreground hover:border-accent/35 hover:text-foreground'
        }
      `}
    >
      {children}
    </button>
  );
}

export function CommandBar({
  sortMode,
  onSortChange,
  timeWindow,
  onTimeWindowChange,
  activeTopic,
  onTopicChange,
  topics,
  searchQuery,
  onSearchChange,
  searchInputRef,
}: CommandBarProps) {
  const [showTopics, setShowTopics] = useState(false);

  return (
    <div className="sticky top-14 z-20 border-b border-border/30 bg-background/95 backdrop-blur-md">
      <div className="mx-auto flex flex-wrap items-center gap-2 max-w-6xl px-6 py-2.5">
        {/* Search */}
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search stories..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full h-7 pl-8 pr-3 text-xs bg-muted/25 border border-border/40 rounded-md
              placeholder:text-muted-foreground/50 text-foreground
              focus:outline-none focus:border-accent-info/55 focus:bg-muted/45
              transition-colors"
          />
        </div>

        {/* Divider */}
        <div className="h-4 w-px bg-border/40" />

        {/* Sort */}
        <div className="flex items-center gap-1">
          <PillButton active={sortMode === 'impact'} onClick={() => onSortChange('impact')}>
            Impact
          </PillButton>
          <PillButton active={sortMode === 'latest'} onClick={() => onSortChange('latest')}>
            Latest
          </PillButton>
        </div>

        {/* Divider */}
        <div className="h-4 w-px bg-border/40" />

        {/* Time window */}
        <div className="flex items-center gap-1">
          {(['6h', '24h', '7d', 'all'] as TimeWindow[]).map((tw) => (
            <PillButton key={tw} active={timeWindow === tw} onClick={() => onTimeWindowChange(tw)}>
              {tw === 'all' ? 'All' : tw}
            </PillButton>
          ))}
        </div>

        {/* Divider */}
        <div className="h-4 w-px bg-border/40" />

        {/* Topic dropdown toggle */}
        <button
          type="button"
          onClick={() => setShowTopics(!showTopics)}
          className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wider transition-colors
            ${activeTopic !== 'all'
              ? 'border-accent/55 bg-accent/15 text-accent'
              : 'border-border/40 bg-muted/20 text-muted-foreground hover:border-accent/35 hover:text-foreground'
            }
          `}
        >
          <SlidersHorizontal className="h-3 w-3" />
          {activeTopic === 'all' ? 'Topics' : activeTopic}
        </button>
      </div>

      {/* Topic chips row (collapsible) */}
      {showTopics && (
        <div className="overflow-x-auto border-t border-border/20">
          <div className="mx-auto max-w-6xl px-6 py-2">
            <div className="flex min-w-max items-center gap-1.5">
              <PillButton active={activeTopic === 'all'} onClick={() => { onTopicChange('all'); setShowTopics(false); }}>
                All
              </PillButton>
              {topics.slice(0, 12).map((t) => (
                <PillButton
                  key={t.topic}
                  active={activeTopic.toLowerCase() === t.topic.toLowerCase()}
                  onClick={() => { onTopicChange(t.topic); setShowTopics(false); }}
                >
                  {t.topic} <span className="opacity-60 tabular-nums ml-0.5">{t.count}</span>
                </PillButton>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
