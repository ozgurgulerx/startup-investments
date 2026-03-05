'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import type { NewsItemCard, EvidenceItem } from '@startup-intelligence/shared';
import { timeAgo, storyTypeBadgeClass, aiSignalLabel, storyTypeLabel } from '@/lib/news-utils';
import { safeHref } from '@/lib/url';
import { TrustBadge } from './trust-badge';
import { ReactionBar } from './reaction-bar';
import { ImpactBox } from './impact-box';
import { DecisionHeader } from './decision-header';
import { ContextBar } from './context-bar';
import { EvidenceExpander } from './evidence-expander';
import type { ViewMode } from './view-toggle';
import { isNewsSignalLinksEnabled } from '@/lib/radar-flags';

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
  signalImpactCreates: 'Signal impact: Creates',
  signalImpactUpdates: 'Signal impact: Updates',
  signalImpactNone: 'Signal impact: No strong signal',
  openSignal: 'Open signal',
};

const TR_COPY = {
  multiSource: 'Coklu kaynak',
  singleSource: 'Tek kaynak',
  whyItMatters: 'Neden onemli',
  openSource: 'Kaynagi ac',
  topImpact: 'En yuksek etki',
  new: 'Yeni',
  signalImpactCreates: 'Sinyal etkisi: Olusturur',
  signalImpactUpdates: 'Sinyal etkisi: Gunceller',
  signalImpactNone: 'Sinyal etkisi: Guclu degil',
  openSignal: 'Sinyali ac',
};

function getSignalImpactLabel(item: NewsItemCard, region: 'global' | 'turkey'): string {
  const isTR = region === 'turkey';
  if (item.signal_impact === 'creates') return isTR ? TR_COPY.signalImpactCreates : EN_COPY.signalImpactCreates;
  if (item.signal_impact === 'updates') return isTR ? TR_COPY.signalImpactUpdates : EN_COPY.signalImpactUpdates;
  return isTR ? TR_COPY.signalImpactNone : EN_COPY.signalImpactNone;
}

function getOpenSignalHref(item: NewsItemCard, region: 'global' | 'turkey'): string | null {
  const signalId = item.top_linked_signal?.id;
  if (!signalId) return null;
  const qs = new URLSearchParams();
  if (region !== 'global') qs.set('region', region);
  qs.set('id', signalId);
  qs.set('originStory', item.id);
  qs.set('originRegion', region);
  qs.set('originPath', `/news?${region !== 'global' ? `region=${region}&` : ''}story=${item.id}`);
  return `/signals?${qs.toString()}`;
}

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
  const linksEnabled = isNewsSignalLinksEnabled();
  const openSignalHref = linksEnabled ? getOpenSignalHref(item, region) : null;
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
        {item.is_investigation && (
          <span className="inline-flex items-center gap-1 rounded-full border border-delta/30 bg-delta/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-delta">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-delta" />
            {region === 'turkey' ? 'Sinyal' : 'Signal Watch'}
          </span>
        )}
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

      {linksEnabled && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex rounded-full border border-border/35 bg-muted/15 px-2 py-0.5 text-[10px] text-muted-foreground">
            {getSignalImpactLabel(item, region)}
          </span>
          {openSignalHref && (
            <Link
              href={openSignalHref}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex rounded-full border border-accent-info/35 bg-accent-info/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent-info hover:bg-accent-info/20 transition-colors"
            >
              {l.openSignal}
            </Link>
          )}
        </div>
      )}

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
      <EvidenceExpander evidence={evidence} region={region} isInvestigation={item.is_investigation} />

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
  const linksEnabled = isNewsSignalLinksEnabled();
  const openSignalHref = linksEnabled ? getOpenSignalHref(item, region) : null;
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
        ${isSelected
          ? 'border-accent-info/40 bg-accent-info/10'
          : 'border-accent-info/25 bg-gradient-to-br from-accent-info/10 via-card/80 to-card/50 hover:border-accent-info/40'
        }
      `}
    >
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

      {linksEnabled && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex rounded-full border border-border/35 bg-muted/15 px-2 py-0.5 text-[10px] text-muted-foreground">
            {getSignalImpactLabel(item, region)}
          </span>
          {openSignalHref && (
            <Link
              href={openSignalHref}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex rounded-full border border-accent-info/35 bg-accent-info/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent-info hover:bg-accent-info/20 transition-colors"
            >
              {l.openSignal}
            </Link>
          )}
        </div>
      )}

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

      <EvidenceExpander evidence={evidence} region={region} isInvestigation={item.is_investigation} />

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
