'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import type { NewsItemCard } from '@startup-intelligence/shared';
import { TrustBadge } from './trust-badge';
import { CoverageDrawer } from './coverage-drawer';

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

interface NewsCardProps {
  item: NewsItemCard;
  featured?: boolean;
}

function toneForStoryType(storyType: string): string {
  const normalized = (storyType || '').toLowerCase();
  if (normalized === 'funding') {
    return 'border-success/30 bg-gradient-to-br from-success/10 via-card/70 to-card/60';
  }
  if (normalized === 'mna') {
    return 'border-delta/30 bg-gradient-to-br from-delta/10 via-card/70 to-card/60';
  }
  if (normalized === 'regulation') {
    return 'border-warning/30 bg-gradient-to-br from-warning/10 via-card/70 to-card/60';
  }
  if (normalized === 'launch') {
    return 'border-accent-info/30 bg-gradient-to-br from-accent-info/10 via-card/70 to-card/60';
  }
  return 'border-border/40 bg-card/65';
}

export function NewsCard({ item, featured = false }: NewsCardProps) {
  const tags = item.topic_tags.slice(0, 3);
  const summary = item.llm_summary || item.summary || item.rank_reason;
  const hasSourceUrl = Boolean(item.url);
  const sourceHref = item.url || '#';
  const toneClass = toneForStoryType(item.story_type);
  const initialHasImage = Boolean(item.image_url && item.image_url.startsWith('http'));
  const [showImage, setShowImage] = useState(initialHasImage);

  useEffect(() => {
    setShowImage(initialHasImage);
  }, [initialHasImage, item.image_url]);

  return (
    <article
      className={`group flex flex-col rounded-xl border backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-accent-info/35 hover:shadow-[0_8px_30px_rgba(0,0,0,0.24)] ${toneClass} ${featured ? 'p-6' : 'p-4'}`}
    >
      {showImage ? (
        <div className="mb-3 overflow-hidden rounded-lg border border-border/35 bg-background/70">
          <img
            src={item.image_url}
            alt=""
            loading="lazy"
            className={`w-full object-cover transition-transform duration-300 group-hover:scale-[1.02] ${featured ? 'h-52' : 'h-36'}`}
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
            AI Signal {Math.round(item.llm_signal_score * 100)}%
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
          <h3 className={`text-foreground tracking-tight transition-colors group-hover:text-accent-info ${featured ? 'text-xl font-medium leading-tight' : 'text-base font-medium leading-snug'}`}>
            {item.title}
          </h3>
        </Link>
      ) : (
        <h3 className={`text-foreground tracking-tight ${featured ? 'text-xl font-medium leading-tight' : 'text-base font-medium leading-snug'}`}>
          {item.title}
        </h3>
      )}

      {summary ? (
        <p className={`mt-3 text-muted-foreground ${featured ? 'text-sm leading-relaxed' : 'text-xs leading-relaxed'}`}>
          {summary}
        </p>
      ) : null}

      {item.builder_takeaway ? (
        <div className="mt-3 rounded-md border border-accent-info/25 bg-accent-info/10 px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-wider text-accent-info">Builder View</p>
          <p className="mt-1 text-xs leading-relaxed text-foreground/90">{item.builder_takeaway}</p>
        </div>
      ) : null}

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

      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
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
