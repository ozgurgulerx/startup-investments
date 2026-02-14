'use client';

import Link from 'next/link';
import { ExternalLink, X } from 'lucide-react';
import type { NewsItemCard, EvidenceItem } from '@startup-intelligence/shared';
import { timeAgo, aiSignalLabel, storyTypeLabel } from '@/lib/news-utils';
import { safeHref } from '@/lib/url';
import { TrustBadge } from './trust-badge';
import { ReactionBar } from './reaction-bar';
import { ImpactBox } from './impact-box';
import { EvidenceExpander } from './evidence-expander';

interface StoryContextProps {
  item: NewsItemCard;
  onClose: () => void;
  relatedSignals: NewsItemCard[];
  region?: 'global' | 'turkey';
}

const EN_COPY = {
  storyDetail: 'Story Detail',
  openSource: 'Open source',
  sourceHeadline: 'Source headline',
  multiSource: 'Multi-source',
  singleSource: 'Single-source',
  keyPoints: 'Key Points',
  summary: 'Summary',
  whyItMatters: 'Why it matters',
  whyItRanks: 'Why it ranks',
  entities: 'Entities',
  topics: 'Topics',
  related: 'Related',
};

const TR_COPY = {
  storyDetail: 'Haber detayi',
  openSource: 'Kaynagi ac',
  sourceHeadline: 'Kaynak baslik',
  multiSource: 'Coklu kaynak',
  singleSource: 'Tek kaynak',
  keyPoints: 'Ana noktalar',
  summary: 'Ozet',
  whyItMatters: 'Neden onemli',
  whyItRanks: 'Neden ustte',
  entities: 'Varliklar',
  topics: 'Konular',
  related: 'Ilgili',
};

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

export function StoryContext({ item, onClose, relatedSignals, region = 'global' }: StoryContextProps) {
  const l = region === 'turkey' ? TR_COPY : EN_COPY;
  const summary = item.llm_summary || item.summary;
  const displayTitle = item.ba_title || item.title;
  const whyItMatters = item.why_it_matters || item.builder_takeaway;
  const evidence = item.evidence && item.evidence.length > 0
    ? item.evidence
    : buildFallbackEvidence(item);

<<<<<<< Updated upstream
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border/30">
        <span className="text-[10px] uppercase tracking-wider text-accent-info">{l.storyDetail}</span>
        <div className="flex items-center gap-2">
          {safeHref(item.url) && (
            <a
              href={safeHref(item.url)!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-accent-info/30 bg-accent-info/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-accent-info hover:bg-accent-info/20 transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              {l.openSource}
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
        {/* Title */}
        <div>
          <h3 className="text-base font-medium leading-snug tracking-tight text-foreground">
            {displayTitle}
=======
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border/30">
        <span className="text-[10px] uppercase tracking-wider text-accent-info">Story Detail</span>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* Title */}
        <div>
          <h3 className="text-base font-medium leading-snug tracking-tight text-foreground">
            {item.title}
>>>>>>> Stashed changes
          </h3>
          {/* Show original publisher headline when ba_title differs */}
          {item.ba_title && item.ba_title !== item.title && (
            <p className="mt-1 text-[10px] text-muted-foreground/50">
              {l.sourceHeadline}: {item.title}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <TrustBadge trustScore={item.trust_score} sourceCount={item.source_count} region={region} />
            <span className="inline-flex rounded-full border border-border/30 bg-muted/15 px-2 py-0.5 text-[10px] text-muted-foreground">
              {item.source_count >= 2 ? l.multiSource : l.singleSource}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {storyTypeLabel(item.story_type, region)}
            </span>
            <span className="text-[10px] text-muted-foreground/70">
              {timeAgo(item.published_at, region)}
            </span>
          </div>
        </div>

        {/* Summary — ba_bullets or paragraph */}
        {item.ba_bullets && item.ba_bullets.length > 0 ? (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{l.keyPoints}</p>
            <ul className="space-y-1">
              {item.ba_bullets.map((bullet, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/90 leading-relaxed">
                  <span className="mt-1.5 inline-block h-1 w-1 rounded-full bg-muted-foreground/40 flex-shrink-0" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : summary ? (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{l.summary}</p>
            <p className="text-xs text-foreground/90 leading-relaxed">{summary}</p>
          </div>
        ) : null}

        {/* Why it matters */}
        {whyItMatters && (
          <div className="rounded-lg border border-accent-info/20 bg-accent-info/5 p-3">
            <p className="text-[10px] uppercase tracking-wider text-accent-info mb-1.5">{l.whyItMatters}</p>
            <p className="text-xs text-foreground/90 leading-relaxed">{whyItMatters}</p>
          </div>
        )}

        {/* Why it ranks */}
        {item.rank_reason && (
          <div className="rounded-lg border border-accent-info/20 bg-accent-info/5 p-3">
            <p className="text-[10px] uppercase tracking-wider text-accent-info mb-1.5">{l.whyItRanks}</p>
            <p className="text-xs text-foreground/90 leading-relaxed">{item.rank_reason}</p>
            {typeof item.llm_signal_score === 'number' && (
              <p className="mt-2 text-[10px] text-accent-info">
                {aiSignalLabel(item.llm_signal_score)}
              </p>
            )}
          </div>
        )}

        {/* Impact */}
        <ImpactBox item={item} region={region} />

        {/* Evidence */}
        <EvidenceExpander evidence={evidence} defaultCollapsed={false} region={region} />

        {/* Entities */}
        {item.entities.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{l.entities}</p>
            <div className="flex flex-wrap gap-1.5">
              {item.entities.slice(0, 8).map((entity) => {
                const slug = entity.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                return (
                  <Link
                    key={entity}
                    href={`/company/${slug}`}
                    className="inline-flex items-center rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[10px] text-muted-foreground hover:border-accent-info/40 hover:text-accent-info transition-colors"
                  >
                    {entity}
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Topic tags */}
        {item.topic_tags.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{l.topics}</p>
            <div className="flex flex-wrap gap-1.5">
              {item.topic_tags.map((tag) => (
                <Link
                  key={tag}
                  href={`/topics/${encodeURIComponent(tag)}`}
                  className="rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:border-accent-info/40 hover:text-accent-info transition-colors"
                >
                  {tag}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Related cluster */}
        {relatedSignals.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{l.related}</p>
            <div className="space-y-2">
              {relatedSignals.map((related) => (
                <p key={related.id} className="text-xs text-muted-foreground leading-snug">
                  <span className="text-foreground">{related.ba_title || related.title}</span>
                  <span className="opacity-60 ml-1">({related.source_count} {region === 'turkey' ? 'kaynak' : 'src'})</span>
                </p>
              ))}
            </div>
          </div>
        )}
<<<<<<< Updated upstream
      </div>

      {/* Actions footer */}
      <div className="border-t border-border/30 px-6 py-3 flex items-center gap-3">
        <ReactionBar clusterId={item.id} region={region} />
      </div>
    </div>
  );
}
=======
      </div>

      {/* Actions footer */}
      <div className="border-t border-border/30 px-6 py-3 flex items-center gap-2">
        {item.url && (
          <Link
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/20 px-3 py-1.5 text-xs text-foreground hover:bg-muted/40 transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            Read source
          </Link>
        )}
      </div>
    </div>
  );
}
>>>>>>> Stashed changes
