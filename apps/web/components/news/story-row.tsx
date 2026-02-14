'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import type { NewsItemCard, EvidenceItem } from '@startup-intelligence/shared';
import { timeAgo, storyTypeBadgeClass, aiSignalLabel, storyTypeLabel } from '@/lib/news-utils';
import { safeHref } from '@/lib/url';
import { TrustBadge } from './trust-badge';
<<<<<<< Updated upstream
import { ReactionBar } from './reaction-bar';
import { ImpactBox } from './impact-box';
import { DecisionHeader } from './decision-header';
import { ContextBar } from './context-bar';
import { EvidenceExpander } from './evidence-expander';
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

const EN_COPY = {
  multiSource: 'Multi-source',
  singleSource: 'Single-source',
  whyItMatters: 'Why it matters',
  openSource: 'Open source',
  topImpact: 'Top Impact',
  new: 'New',
};

const TR_COPY = {
  multiSource: 'Coklu kaynak',
  singleSource: 'Tek kaynak',
  whyItMatters: 'Neden onemli',
  openSource: 'Kaynagi ac',
  topImpact: 'En yuksek etki',
  new: 'Yeni',
};

/** Build fallback evidence from legacy sources + url fields when evidence_json is not yet populated. */
function buildFallbackEvidence(item: NewsItemCard): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];
  if (item.sources && item.sources.length > 0) {
    for (const source of item.sources) {
      evidence.push({
        publisher: source,
        url: source === item.primary_source ? item.url : '',
        published_at: item.published_at,
      });
    }
  } else if (item.primary_source) {
    evidence.push({
      publisher: item.primary_source,
      url: item.url,
      published_at: item.published_at,
    });
  }
  return evidence;
}

export function StoryCard({ item, isSelected, onSelect, isNew, onHide, region = 'global', viewMode }: StoryCardProps) {
  const l = region === 'turkey' ? TR_COPY : EN_COPY;
  const typeBadge = storyTypeBadgeClass(item.story_type);
  const tags = item.topic_tags.slice(0, 2);
  const imageUrl = item.image_url && /^https?:\/\//i.test(item.image_url) ? item.image_url : null;
  const [imageFailed, setImageFailed] = useState(false);

  const displayTitle = item.ba_title || item.title;
  const evidence = item.evidence && item.evidence.length > 0
    ? item.evidence
    : buildFallbackEvidence(item);
  const whyItMatters = item.why_it_matters || item.builder_takeaway;

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

      {/* A. Header row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${typeBadge}`}>
          {storyTypeLabel(item.story_type, region)}
        </span>
        <TrustBadge trustScore={item.trust_score} sourceCount={item.source_count} region={region} />
        <span className="inline-flex rounded-full border border-border/30 bg-muted/15 px-2 py-0.5 text-[10px] text-muted-foreground">
          {item.source_count >= 2 ? l.multiSource : l.singleSource}
        </span>
        {isNew && (
          <span className="inline-flex rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-success">
            {l.new}
          </span>
        )}
        {typeof item.llm_signal_score === 'number' && (
          <span className="ml-auto inline-flex rounded-full border border-accent-info/35 bg-accent-info/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent-info">
            {aiSignalLabel(item.llm_signal_score)}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground/70 tabular-nums whitespace-nowrap">
          {timeAgo(item.published_at, region)}
        </span>
      </div>

      {/* B. Hero block — ba_title as primary, plain text (not a link) */}
      <h3 className={`mt-2 text-sm font-medium leading-snug tracking-tight line-clamp-2 ${isSelected ? 'text-accent-info' : 'text-foreground group-hover:text-accent-info'}`}>
        {displayTitle}
      </h3>

      {/* Summary: ba_bullets as compact list, else fallback to paragraph */}
      {item.ba_bullets && item.ba_bullets.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {item.ba_bullets.slice(0, 4).map((bullet, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground leading-relaxed">
              <span className="mt-1.5 inline-block h-1 w-1 rounded-full bg-muted-foreground/40 flex-shrink-0" />
              <span className="line-clamp-2">{bullet}</span>
            </li>
          ))}
        </ul>
      ) : (
        (item.llm_summary || item.summary) && (
          <p className="mt-2 text-xs text-muted-foreground line-clamp-3 leading-relaxed">
            {item.llm_summary || item.summary}
          </p>
        )
      )}

      {/* C. Why it matters */}
      {whyItMatters && (
        <div className="mt-2">
          <span className="text-[10px] uppercase tracking-wider text-accent-info">{l.whyItMatters}</span>
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {whyItMatters}
          </p>
        </div>
      )}

      {/* D. ImpactBox */}
      <ImpactBox item={item} compact region={region} viewMode={viewMode} />

      {/* E. Evidence expander */}
      <EvidenceExpander evidence={evidence} region={region} />

      {/* F. Open source CTA */}
      {safeHref(item.url) && (
        <div className="mt-2">
          <a
            href={safeHref(item.url)!}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-md border border-accent-info/30 bg-accent-info/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-accent-info hover:bg-accent-info/20 transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            {l.openSource}
          </a>
        </div>
      )}

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
        <ReactionBar clusterId={item.id} compact onHide={onHide} region={region} />
      </div>
    </div>
  );
}

export function PinnedStoryCard({ item, isSelected, onSelect, isNew, onHide, region = 'global', viewMode }: StoryCardProps) {
  const l = region === 'turkey' ? TR_COPY : EN_COPY;
  const typeBadge = storyTypeBadgeClass(item.story_type);
  const displayTitle = item.ba_title || item.title;
  const whyItMatters = item.why_it_matters || item.builder_takeaway;
  const evidence = item.evidence && item.evidence.length > 0
    ? item.evidence
    : buildFallbackEvidence(item);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(item.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(item.id); } }}
      data-story-id={item.id}
      className={`group w-full text-left rounded-xl border p-4 transition-all duration-200 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-info/60
=======

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
  isPinned?: boolean;
  isNew?: boolean;
}

export function StoryRow({ item, isSelected, onSelect, isPinned, isNew }: StoryRowProps) {
  const summary = item.llm_summary || item.summary || item.rank_reason;
  const typeBadge = storyTypeBadge(item.story_type);

  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      data-story-id={item.id}
      aria-pressed={isSelected}
      className={`group w-full text-left px-6 py-3 border-b border-border/20 transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-info/60 focus-visible:ring-inset
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
            {isNew && (
              <span className="inline-block mr-1.5 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-success/10 text-success border border-success/25">
                New
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
export function PinnedStoryCard({ item, isSelected, onSelect, isNew }: StoryRowProps) {
  const summary = item.llm_summary || item.summary || item.rank_reason;
  const typeBadge = storyTypeBadge(item.story_type);

  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      data-story-id={item.id}
      className={`group w-full text-left rounded-xl border p-4 transition-all duration-200
>>>>>>> Stashed changes
        ${isSelected
          ? 'border-accent-info/40 bg-accent-info/10'
          : 'border-accent-info/25 bg-gradient-to-br from-accent-info/10 via-card/80 to-card/50 hover:border-accent-info/40'
        }
      `}
    >
<<<<<<< Updated upstream
      {viewMode && <DecisionHeader item={item} region={region} />}

      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-accent-info/15 text-accent-info border border-accent-info/25">
          {l.topImpact}
        </span>
        {isNew && (
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-success/10 text-success border border-success/25">
            {l.new}
          </span>
        )}
        <TrustBadge trustScore={item.trust_score} sourceCount={item.source_count} region={region} />
        <span className="inline-flex rounded-full border border-border/30 bg-muted/15 px-2 py-0.5 text-[10px] text-muted-foreground">
          {item.source_count >= 2 ? l.multiSource : l.singleSource}
        </span>
        <span className={`hidden sm:inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${typeBadge}`}>
          {storyTypeLabel(item.story_type, region)}
        </span>
        {typeof item.llm_signal_score === 'number' && (
          <span className="ml-auto inline-flex rounded-full border border-accent-info/35 bg-accent-info/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent-info">
            {aiSignalLabel(item.llm_signal_score)}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground/70 tabular-nums">
          {timeAgo(item.published_at, region)}
        </span>
      </div>

      <h3 className={`text-base font-medium leading-snug tracking-tight line-clamp-2 ${isSelected ? 'text-accent-info' : 'text-foreground group-hover:text-accent-info'}`}>
        {displayTitle}
      </h3>

      {item.ba_bullets && item.ba_bullets.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {item.ba_bullets.slice(0, 4).map((bullet, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground leading-relaxed">
              <span className="mt-1.5 inline-block h-1 w-1 rounded-full bg-muted-foreground/40 flex-shrink-0" />
              <span className="line-clamp-2">{bullet}</span>
            </li>
          ))}
        </ul>
      ) : (
        (item.llm_summary || item.summary) && (
          <p className="mt-2 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {item.llm_summary || item.summary}
          </p>
        )
      )}

      {whyItMatters && (
        <div className="mt-2">
          <span className="text-[10px] uppercase tracking-wider text-accent-info">{l.whyItMatters}</span>
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {whyItMatters}
          </p>
        </div>
      )}

      <ImpactBox item={item} compact region={region} viewMode={viewMode} />

      <EvidenceExpander evidence={evidence} region={region} />

      {safeHref(item.url) && (
        <div className="mt-2">
          <a
            href={safeHref(item.url)!}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-md border border-accent-info/30 bg-accent-info/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-accent-info hover:bg-accent-info/20 transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            {l.openSource}
          </a>
        </div>
      )}

      {viewMode && <ContextBar item={item} region={region} />}

      <div className="mt-3 pt-2 border-t border-border/20">
        <ReactionBar clusterId={item.id} compact onHide={onHide} region={region} />
      </div>
    </div>
  );
}
=======
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
>>>>>>> Stashed changes
