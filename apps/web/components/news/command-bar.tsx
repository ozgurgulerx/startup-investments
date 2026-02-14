'use client';

<<<<<<< Updated upstream
import { useState } from 'react';
import { Search, SlidersHorizontal, ShieldCheck } from 'lucide-react';
import { PageContainer } from '@/components/layout/page-container';
import { ViewToggle, type ViewMode } from './view-toggle';

export type SortMode = 'impact' | 'latest' | 'trust' | 'signal';
export type TimeWindow = '6h' | '24h' | '7d' | 'all';

=======
import { useState, type RefObject } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';

export type SortMode = 'impact' | 'latest';
export type TimeWindow = '6h' | '24h' | '7d' | 'all';

>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
  searchInputRef?: React.RefObject<HTMLInputElement>;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  showViewToggle?: boolean;
  hideLowTrust?: boolean;
  onHideLowTrustChange?: (value: boolean) => void;
  region?: 'global' | 'turkey';
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

=======
  searchInputRef?: RefObject<HTMLInputElement>;
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
          ? 'border-accent-info/55 bg-accent-info/15 text-accent-info'
          : 'border-border/40 bg-muted/20 text-muted-foreground hover:border-accent-info/35 hover:text-foreground'
        }
      `}
    >
      {children}
    </button>
  );
}

>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
  viewMode,
  onViewModeChange,
  showViewToggle,
  hideLowTrust,
  onHideLowTrustChange,
  region = 'global',
}: CommandBarProps) {
  const [showTopics, setShowTopics] = useState(false);
  const l = region === 'turkey'
    ? {
      searchPlaceholder: 'Sinyal ara...',
      impact: 'Etki',
      latest: 'En yeni',
      trust: 'Guven',
      signal: 'Sinyal',
      all: 'Tum',
      highTrust: 'Yuksek guven',
      topics: 'Konular',
    }
    : {
      searchPlaceholder: 'Search signals...',
      impact: 'Impact',
      latest: 'Latest',
      trust: 'Trust',
      signal: 'Signal',
      all: 'All',
      highTrust: 'High trust',
      topics: 'Topics',
    };

  return (
    <div className="sticky top-14 z-20 border-b border-border/30 bg-background/95 backdrop-blur-md">
      <PageContainer className="flex flex-wrap items-center gap-2 py-2.5">
=======
}: CommandBarProps) {
  const [showTopics, setShowTopics] = useState(false);

  return (
    <div className="sticky top-14 z-20 border-b border-border/30 bg-background/95 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-2 px-6 py-2.5">
>>>>>>> Stashed changes
        {/* Search */}
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
          <input
            ref={searchInputRef}
            type="text"
<<<<<<< Updated upstream
            placeholder={l.searchPlaceholder}
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
            {l.impact}
          </PillButton>
          <PillButton active={sortMode === 'latest'} onClick={() => onSortChange('latest')}>
            {l.latest}
          </PillButton>
          <PillButton active={sortMode === 'trust'} onClick={() => onSortChange('trust')}>
            {l.trust}
          </PillButton>
          <PillButton active={sortMode === 'signal'} onClick={() => onSortChange('signal')}>
            {l.signal}
          </PillButton>
        </div>

        {/* Divider */}
        <div className="h-4 w-px bg-border/40" />

        {/* Time window */}
        <div className="flex items-center gap-1">
          {(['6h', '24h', '7d', 'all'] as TimeWindow[]).map((tw) => (
            <PillButton key={tw} active={timeWindow === tw} onClick={() => onTimeWindowChange(tw)}>
              {tw === 'all' ? l.all : tw}
            </PillButton>
          ))}
        </div>

        {/* Hide low-trust toggle */}
        {onHideLowTrustChange && (
          <>
            <div className="h-4 w-px bg-border/40" />
            <button
              type="button"
              onClick={() => onHideLowTrustChange(!hideLowTrust)}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wider transition-colors
                ${hideLowTrust
                  ? 'border-accent/55 bg-accent/15 text-accent'
                  : 'border-border/40 bg-muted/20 text-muted-foreground hover:border-accent/35 hover:text-foreground'
                }
              `}
            >
              <ShieldCheck className="h-3 w-3" />
              {l.highTrust}
            </button>
          </>
        )}

        {/* View mode toggle (gated by feature flag) */}
        {showViewToggle && viewMode && onViewModeChange && (
          <>
            <div className="h-4 w-px bg-border/40" />
            <ViewToggle viewMode={viewMode} onViewModeChange={onViewModeChange} region={region} />
          </>
        )}

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
          {activeTopic === 'all' ? l.topics : activeTopic}
        </button>
      </PageContainer>

      {/* Topic chips row (collapsible) */}
      {showTopics && (
        <div className="overflow-x-auto border-t border-border/20">
          <PageContainer className="py-2">
            <div className="flex min-w-max items-center gap-1.5">
              <PillButton active={activeTopic === 'all'} onClick={() => { onTopicChange('all'); setShowTopics(false); }}>
                {l.all}
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
          </PageContainer>
        </div>
      )}
    </div>
  );
}
=======
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
              ? 'border-accent-info/55 bg-accent-info/15 text-accent-info'
              : 'border-border/40 bg-muted/20 text-muted-foreground hover:border-accent-info/35 hover:text-foreground'
            }
          `}
        >
          <SlidersHorizontal className="h-3 w-3" />
          {activeTopic === 'all' ? 'Topics' : activeTopic}
        </button>
      </div>

      {/* Topic chips row (collapsible) */}
      {showTopics && (
        <div className="overflow-x-auto border-t border-border/20 px-6 py-2">
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
      )}
    </div>
  );
}
>>>>>>> Stashed changes
