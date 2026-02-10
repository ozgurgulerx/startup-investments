'use client';

import Link from 'next/link';
import { ExternalLink, X } from 'lucide-react';
import type { NewsItemCard } from '@startup-intelligence/shared';
import { TrustBadge } from './trust-badge';
import { ReactionBar } from './reaction-bar';

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

interface StoryContextProps {
  item: NewsItemCard;
  onClose: () => void;
  relatedStories: NewsItemCard[];
}

export function StoryContext({ item, onClose, relatedStories }: StoryContextProps) {
  const summary = item.llm_summary || item.summary;
  const hasBuilderOrigin = typeof item.builder_takeaway_is_llm === 'boolean';
  const builderOriginLabel = item.builder_takeaway_is_llm ? 'LLM' : 'AUTO';

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border/30">
        <span className="text-[10px] uppercase tracking-wider text-accent-info">Story Detail</span>
        <div className="flex items-center gap-2">
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-accent-info/30 bg-accent-info/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-accent-info hover:bg-accent-info/20 transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              Read
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
            {item.title}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <TrustBadge trustScore={item.trust_score} sourceCount={item.source_count} />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {item.story_type || 'news'}
            </span>
            <span className="text-[10px] text-muted-foreground/70">
              {timeAgo(item.published_at)}
            </span>
          </div>
        </div>

        {/* Summary */}
        {summary && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Summary</p>
            <p className="text-xs text-foreground/90 leading-relaxed">{summary}</p>
          </div>
        )}

        {/* Why it ranks */}
        {item.rank_reason && (
          <div className="rounded-lg border border-accent-info/20 bg-accent-info/5 p-3">
            <p className="text-[10px] uppercase tracking-wider text-accent-info mb-1.5">Why it ranks</p>
            <p className="text-xs text-foreground/90 leading-relaxed">{item.rank_reason}</p>
            {typeof item.llm_signal_score === 'number' && (
              <p className="mt-2 text-[10px] text-accent-info">
                AI Signal: {Math.round(item.llm_signal_score * 100)}%
              </p>
            )}
          </div>
        )}

        {/* Why it matters */}
        {item.builder_takeaway && (
          <div className="rounded-lg border border-accent-info/25 bg-accent-info/10 p-3">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <p className="text-[10px] uppercase tracking-wider text-accent-info">Why It Matters</p>
              {hasBuilderOrigin ? (
                <span className="inline-flex items-center rounded-full border border-accent-info/25 bg-accent-info/10 px-2 py-0.5 text-[9px] uppercase tracking-wider text-accent-info">
                  {builderOriginLabel}
                </span>
              ) : null}
            </div>
            <p className="text-xs text-foreground/90 leading-relaxed">{item.builder_takeaway}</p>
          </div>
        )}

        {/* Source stack */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Sources ({item.source_count})
          </p>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-foreground">{item.primary_source}</span>
              <span className="text-[9px] uppercase tracking-wider text-accent-info px-1.5 py-0.5 rounded bg-accent-info/10 border border-accent-info/20">Primary</span>
            </div>
            {item.sources
              .filter((s) => s !== item.primary_source)
              .map((source) => (
                <div key={source} className="text-xs text-muted-foreground">
                  {source}
                </div>
              ))}
          </div>
        </div>

        {/* Entities → links */}
        {item.entities.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Entities</p>
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
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Topics</p>
            <div className="flex flex-wrap gap-1.5">
              {item.topic_tags.map((tag) => (
                <span key={tag} className="rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Related cluster */}
        {relatedStories.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Related</p>
            <div className="space-y-2">
              {relatedStories.map((related) => (
                <p key={related.id} className="text-xs text-muted-foreground leading-snug">
                  <span className="text-foreground">{related.title}</span>
                  <span className="opacity-60 ml-1">({related.source_count} src)</span>
                </p>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions footer */}
      <div className="border-t border-border/30 px-6 py-3 flex items-center gap-3">
        <ReactionBar clusterId={item.id} />
      </div>
    </div>
  );
}
