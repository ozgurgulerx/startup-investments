'use client';

import type { NewsItemCard } from '@startup-intelligence/shared';
import { TrustBadge } from './trust-badge';

function timeAgo(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'just now';
  const diff = Math.max(0, now - then);
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function storyTypeBadge(type: string): string {
  const t = (type || '').toLowerCase();
  if (t === 'funding') return 'border-emerald-400/30 text-emerald-400';
  if (t === 'mna') return 'border-sky-400/30 text-sky-400';
  if (t === 'regulation') return 'border-violet-400/28 text-violet-400';
  if (t === 'launch') return 'border-amber-400/28 text-amber-400';
  return 'border-border/40 text-muted-foreground';
}

interface StoryRowProps {
  item: NewsItemCard;
  isSelected: boolean;
  onSelect: (id: string) => void;
  isPinned?: boolean;
}

export function StoryRow({ item, isSelected, onSelect, isPinned }: StoryRowProps) {
  const summary = item.llm_summary || item.summary || item.rank_reason;
  const typeBadge = storyTypeBadge(item.story_type);

  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      className={`group w-full text-left px-4 py-3 border-b border-border/20 transition-colors duration-150
        ${isSelected
          ? 'bg-accent-info/10 border-l-2 border-l-accent-info'
          : 'hover:bg-muted/20 border-l-2 border-l-transparent'
        }
        ${isPinned ? 'bg-accent-info/5' : ''}
      `}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left: title + summary */}
        <div className="flex-1 min-w-0">
          <h3 className={`text-sm font-medium leading-snug tracking-tight truncate
            ${isSelected ? 'text-accent-info' : 'text-foreground group-hover:text-accent-info'}
          `}>
            {isPinned && (
              <span className="inline-block mr-1.5 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent-info/15 text-accent-info border border-accent-info/25">
                Top
              </span>
            )}
            {item.title}
          </h3>
          {summary && (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-1">
              {summary}
            </p>
          )}
        </div>

        {/* Right: badges + time */}
        <div className="flex items-center gap-2 shrink-0">
          <TrustBadge trustScore={item.trust_score} sourceCount={item.source_count} />
          <span className={`hidden sm:inline-flex rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${typeBadge}`}>
            {item.story_type || 'news'}
          </span>
          {typeof item.llm_signal_score === 'number' && (
            <span className="hidden md:inline-flex rounded-full border border-accent-info/35 bg-accent-info/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-accent-info">
              AI {Math.round(item.llm_signal_score * 100)}%
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/70 tabular-nums whitespace-nowrap">
            {timeAgo(item.published_at)}
          </span>
        </div>
      </div>
    </button>
  );
}

/** Pinned top-impact card variant for the first story */
export function PinnedStoryCard({ item, isSelected, onSelect }: StoryRowProps) {
  const summary = item.llm_summary || item.summary || item.rank_reason;

  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      className={`group w-full text-left rounded-xl border p-4 transition-all duration-200
        ${isSelected
          ? 'border-accent-info/40 bg-accent-info/10'
          : 'border-accent-info/25 bg-gradient-to-br from-accent-info/10 via-card/80 to-card/50 hover:border-accent-info/40'
        }
      `}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent-info/15 text-accent-info border border-accent-info/25">
          Top Impact
        </span>
        <TrustBadge trustScore={item.trust_score} sourceCount={item.source_count} />
        <span className="text-[10px] text-muted-foreground/70 tabular-nums">
          {timeAgo(item.published_at)}
        </span>
      </div>
      <h3 className={`text-base font-medium leading-snug tracking-tight
        ${isSelected ? 'text-accent-info' : 'text-foreground group-hover:text-accent-info'}
      `}>
        {item.title}
      </h3>
      {summary && (
        <p className="mt-2 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
          {summary}
        </p>
      )}
      {item.builder_takeaway && (
        <p className="mt-2 text-[10px] text-accent-info/80 line-clamp-1">
          Builder: {item.builder_takeaway}
        </p>
      )}
    </button>
  );
}
