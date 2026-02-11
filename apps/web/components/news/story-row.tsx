'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import type { NewsItemCard } from '@startup-intelligence/shared';
import { timeAgo, storyTypeBadgeClass, aiSignalLabel } from '@/lib/news-utils';
import { TrustBadge } from './trust-badge';
import { ReactionBar } from './reaction-bar';
import { ImpactBox } from './impact-box';
import { DecisionHeader } from './decision-header';
import { ContextBar } from './context-bar';
import type { ViewMode } from './view-toggle';

interface StoryCardProps {
  item: NewsItemCard;
  isSelected: boolean;
  onSelect: (id: string) => void;
  isNew?: boolean;
  onHide?: (id: string) => void;
  region?: 'global' | 'turkey';
  viewMode?: ViewMode;
}

export function StoryCard({ item, isSelected, onSelect, isNew, onHide, region = 'global', viewMode }: StoryCardProps) {
  const summary = item.llm_summary || item.summary || item.rank_reason;
  const typeBadge = storyTypeBadgeClass(item.story_type);
  const tags = item.topic_tags.slice(0, 2);
  const imageUrl = item.image_url && /^https?:\/\//i.test(item.image_url) ? item.image_url : null;
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(item.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(item.id); } }}
      data-story-id={item.id}
      aria-pressed={isSelected}
      className={`group w-full text-left rounded-xl border p-3 transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-info/60
        ${isSelected
          ? 'border-accent-info/45 bg-accent-info/10'
          : 'border-border/40 bg-card hover:border-accent-info/30 hover:bg-muted/15'
        }
      `}
    >
      {imageUrl && !imageFailed && (
        <div className="mb-3 overflow-hidden rounded-lg border border-border/35 bg-muted/10">
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-28 w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.02]"
            onError={() => setImageFailed(true)}
          />
        </div>
      )}

      {viewMode && <DecisionHeader item={item} region={region} />}

      <div className="flex flex-wrap items-center gap-2">
        {isNew && (
          <span className="inline-flex rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-success">
            {region === 'turkey' ? 'Yeni' : 'New'}
          </span>
        )}
        <TrustBadge trustScore={item.trust_score} sourceCount={item.source_count} />
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${typeBadge}`}>
          {item.story_type || 'news'}
        </span>
        {typeof item.llm_signal_score === 'number' && (
          <span className="inline-flex rounded-full border border-accent-info/35 bg-accent-info/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent-info">
            {aiSignalLabel(item.llm_signal_score)}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground/70 tabular-nums whitespace-nowrap">
          {timeAgo(item.published_at)}
        </span>
      </div>

      <h3 className="mt-2 text-sm font-medium leading-snug tracking-tight">
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`hover:underline ${isSelected ? 'text-accent-info' : 'text-foreground group-hover:text-accent-info'}`}
          >
            {item.title}
            <ExternalLink className="inline h-3 w-3 ml-1 opacity-50 -translate-y-px" />
          </a>
        ) : (
          <span className={isSelected ? 'text-accent-info' : 'text-foreground group-hover:text-accent-info'}>
            {item.title}
          </span>
        )}
      </h3>
      {item.primary_source && (
        <p className="mt-1 text-[10px] text-muted-foreground/60">{item.primary_source}</p>
      )}

      {summary && (
        <p className="mt-2 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
          {summary}
        </p>
      )}

      <ImpactBox item={item} compact region={region} viewMode={viewMode} />

      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Link
              key={tag}
              href={`/topics/${encodeURIComponent(tag)}`}
              onClick={(e) => e.stopPropagation()}
              className="rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:border-accent-info/40 hover:text-accent-info transition-colors"
            >
              {tag}
            </Link>
          ))}
        </div>
      )}

      {viewMode && <ContextBar item={item} region={region} />}

      <div className="mt-3 pt-2 border-t border-border/20">
        <ReactionBar clusterId={item.id} compact onHide={onHide} />
      </div>
    </div>
  );
}

export function PinnedStoryCard({ item, isSelected, onSelect, isNew, onHide, region = 'global', viewMode }: StoryCardProps) {
  const summary = item.llm_summary || item.summary || item.rank_reason;
  const typeBadge = storyTypeBadgeClass(item.story_type);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(item.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(item.id); } }}
      data-story-id={item.id}
      className={`group w-full text-left rounded-xl border p-4 transition-all duration-200 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-info/60
        ${isSelected
          ? 'border-accent-info/40 bg-accent-info/10'
          : 'border-accent-info/25 bg-gradient-to-br from-accent-info/10 via-card/80 to-card/50 hover:border-accent-info/40'
        }
      `}
    >
      {viewMode && <DecisionHeader item={item} region={region} />}

      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-accent-info/15 text-accent-info border border-accent-info/25">
          {region === 'turkey' ? 'En Önemli' : 'Top Impact'}
        </span>
        {isNew && (
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-success/10 text-success border border-success/25">
            {region === 'turkey' ? 'Yeni' : 'New'}
          </span>
        )}
        <TrustBadge trustScore={item.trust_score} sourceCount={item.source_count} />
        <span className={`hidden sm:inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${typeBadge}`}>
          {item.story_type || 'news'}
        </span>
        <span className="text-[10px] text-muted-foreground/70 tabular-nums">
          {timeAgo(item.published_at)}
        </span>
      </div>

      <h3 className="text-base font-medium leading-snug tracking-tight">
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`hover:underline ${isSelected ? 'text-accent-info' : 'text-foreground group-hover:text-accent-info'}`}
          >
            {item.title}
            <ExternalLink className="inline h-3 w-3 ml-1 opacity-50 -translate-y-px" />
          </a>
        ) : (
          <span className={isSelected ? 'text-accent-info' : 'text-foreground group-hover:text-accent-info'}>
            {item.title}
          </span>
        )}
      </h3>
      {item.primary_source && (
        <p className="mt-1 text-[10px] text-muted-foreground/60">{item.primary_source}</p>
      )}

      {summary && (
        <p className="mt-2 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
          {summary}
        </p>
      )}

      <ImpactBox item={item} compact region={region} viewMode={viewMode} />

      {viewMode && <ContextBar item={item} region={region} />}

      <div className="mt-3 pt-2 border-t border-border/20">
        <ReactionBar clusterId={item.id} compact onHide={onHide} />
      </div>
    </div>
  );
}
