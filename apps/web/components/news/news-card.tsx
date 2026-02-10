'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import type { NewsItemCard } from '@startup-intelligence/shared';
import { timeAgo, storyTypeToneClass, aiSignalLabel } from '@/lib/news-utils';
import { TrustBadge } from './trust-badge';
import { CoverageDrawer } from './coverage-drawer';
import { ImpactBox } from './impact-box';

interface NewsCardProps {
  item: NewsItemCard;
  featured?: boolean;
  className?: string;
}

export function NewsCard({ item, featured = false, className }: NewsCardProps) {
  const tags = item.topic_tags.slice(0, 3);
  const summary = item.llm_summary || item.summary || item.rank_reason;
  const hasSourceUrl = Boolean(item.url);
  const sourceHref = item.url || '#';
  const toneClass = storyTypeToneClass(item.story_type);
  const initialHasImage = Boolean(item.image_url && item.image_url.startsWith('http'));
  const [showImage, setShowImage] = useState(initialHasImage);
  useEffect(() => {
    setShowImage(initialHasImage);
  }, [initialHasImage, item.image_url]);

  return (
    <article
      className={`group flex flex-col rounded-xl border backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-accent-info/35 hover:shadow-[0_8px_30px_rgba(0,0,0,0.24)] md:min-h-[340px] ${toneClass} ${featured ? 'p-6' : 'p-4'} ${className || ''}`}
    >
      <div className="flex-1">
        {showImage ? (
          <div className="mb-3 overflow-hidden rounded-lg border border-border/35 bg-background/70">
            <img
              src={item.image_url}
              alt=""
              loading="lazy"
              className={`w-full object-cover transition-transform duration-300 group-hover:scale-[1.02] ${featured ? 'h-32' : 'h-20'}`}
              onError={(event) => {
                event.currentTarget.removeAttribute('src');
                setShowImage(false);
              }}
            />
          </div>
        ) : null}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <TrustBadge trustScore={item.trust_score} sourceCount={item.source_count} />
          {typeof item.llm_signal_score === 'number' ? (
            <span className="rounded-full border border-accent-info/35 bg-accent-info/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent-info">
              {aiSignalLabel(item.llm_signal_score)}
            </span>
          ) : null}
          <span className="rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {item.story_type || 'news'}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{item.primary_source}</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{timeAgo(item.published_at)}</span>
        </div>

        {hasSourceUrl ? (
          <Link href={sourceHref} target="_blank" rel="noopener noreferrer" className="block">
            <h3 className={`text-foreground tracking-tight transition-colors group-hover:text-accent-info line-clamp-2 ${featured ? 'text-xl font-medium leading-tight' : 'text-base font-medium leading-snug'}`}>
              {item.title}
            </h3>
          </Link>
        ) : (
          <h3 className={`text-foreground tracking-tight line-clamp-2 ${featured ? 'text-xl font-medium leading-tight' : 'text-base font-medium leading-snug'}`}>
            {item.title}
          </h3>
        )}

        {summary ? (
          <p className={`mt-3 text-muted-foreground line-clamp-3 ${featured ? 'text-sm leading-relaxed' : 'text-xs leading-relaxed'}`}>
            {summary}
          </p>
        ) : null}

        <ImpactBox item={item} />

        <div className="mt-4 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Link
              key={tag}
              href={`/topics/${encodeURIComponent(tag)}`}
              className="inline-flex items-center rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:border-accent-info/40 hover:text-accent-info transition-colors"
            >
              {tag}
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-auto flex flex-shrink-0 items-center justify-between gap-3 pt-4">
        <CoverageDrawer sources={item.sources.filter((s) => s !== item.primary_source)} />
        {hasSourceUrl ? (
          <Link
            href={sourceHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-accent-info/90 hover:text-accent-info"
          >
            Read source
            <ExternalLink className="h-3 w-3" />
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            Source unavailable
          </span>
        )}
      </div>
    </article>
  );
}
