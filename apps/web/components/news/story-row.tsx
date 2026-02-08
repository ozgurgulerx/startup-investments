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
  if (t === 'funding') return 'border-success/30 bg-success/10 text-success';
  if (t === 'mna') return 'border-delta/30 bg-delta/10 text-delta';
  if (t === 'regulation') return 'border-warning/30 bg-warning/10 text-warning';
  if (t === 'launch') return 'border-accent-info/30 bg-accent-info/10 text-accent-info';
  return 'border-border/40 bg-muted/10 text-muted-foreground';
}

interface StoryRowProps {
  item: NewsItemCard;
  isSelected: boolean;
  onSelect: (id: string) => void;
  isNew?: boolean;
}

export function StoryCard({ item, isSelected, onSelect, isNew }: StoryRowProps) {
  const summary = item.llm_summary || item.summary || item.rank_reason;
  const typeBadge = storyTypeBadge(item.story_type);
  const tags = item.topic_tags.slice(0, 2);

  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      data-story-id={item.id}
      aria-pressed={isSelected}
      className={`group w-full text-left rounded-xl border p-3 transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-info/60
        ${isSelected
          ? 'border-accent-info/45 bg-accent-info/10'
          : 'border-border/40 bg-card/30 hover:border-accent-info/30 hover:bg-muted/15'
        }
      `}
    >
      <div className="flex flex-wrap items-center gap-2">
        {isNew && (
          <span className="inline-flex rounded-full border border-success/25 bg-success/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-success">
            New
          </span>
        )}
        <TrustBadge trustScore={item.trust_score} sourceCount={item.source_count} />
        <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${typeBadge}`}>
          {item.story_type || 'news'}
        </span>
        {typeof item.llm_signal_score === 'number' && (
          <span className="inline-flex rounded-full border border-accent-info/35 bg-accent-info/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-accent-info">
            AI {Math.round(item.llm_signal_score * 100)}%
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground/70 tabular-nums whitespace-nowrap">
          {timeAgo(item.published_at)}
        </span>
      </div>

      <h3 className={`mt-2 text-sm font-medium leading-snug tracking-tight
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
        <p className="mt-2 text-[10px] text-accent-info/80 line-clamp-2 leading-relaxed">
          Builder: {item.builder_takeaway}
        </p>
      )}

      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

/** Pinned top-impact card variant for the first story */
export function PinnedStoryCard({ item, isSelected, onSelect, isNew }: StoryRowProps) {
  const summary = item.llm_summary || item.summary || item.rank_reason;
  const typeBadge = storyTypeBadge(item.story_type);

  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      data-story-id={item.id}
      className={`group w-full text-left rounded-xl border p-4 transition-all duration-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-info/60
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
        {isNew && (
          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-success/10 text-success border border-success/25">
            New
          </span>
        )}
        <TrustBadge trustScore={item.trust_score} sourceCount={item.source_count} />
        <span className={`hidden sm:inline-flex rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${typeBadge}`}>
          {item.story_type || 'news'}
        </span>
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
