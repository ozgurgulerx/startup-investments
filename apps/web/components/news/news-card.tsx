'use client';

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

export function NewsCard({ item, featured = false }: NewsCardProps) {
  const tags = item.topic_tags.slice(0, 3);
  const summary = item.summary || item.rank_reason;
  const hasSourceUrl = Boolean(item.url);
  const sourceHref = item.url || '#';

  return (
    <article
      className={`group rounded-xl border border-border/40 bg-card/60 backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/35 hover:shadow-[0_8px_30px_rgba(0,0,0,0.24)] ${featured ? 'p-6' : 'p-4'}`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <TrustBadge trustScore={item.trust_score} sourceCount={item.source_count} />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{item.primary_source}</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{timeAgo(item.published_at)}</span>
      </div>

      {hasSourceUrl ? (
        <Link href={sourceHref} target="_blank" rel="noopener noreferrer" className="block">
          <h3 className={`text-foreground tracking-tight transition-colors group-hover:text-accent ${featured ? 'text-xl font-medium leading-tight' : 'text-base font-medium leading-snug'}`}>
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

      <div className="mt-4 flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <Link
            key={tag}
            href={`/topics/${encodeURIComponent(tag)}`}
            className="inline-flex items-center rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:border-accent/40 hover:text-accent transition-colors"
          >
            {tag}
          </Link>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <CoverageDrawer sources={item.sources.filter((s) => s !== item.primary_source)} />
        {hasSourceUrl ? (
          <Link
            href={sourceHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-accent/90 hover:text-accent"
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
