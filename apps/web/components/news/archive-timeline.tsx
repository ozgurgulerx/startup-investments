'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { NewsArchiveDay } from '@startup-intelligence/shared';

interface ArchiveTimelineProps {
  initialItems: NewsArchiveDay[];
  pageSize?: number;
}

function formatDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function ArchiveTimeline({ initialItems, pageSize = 20 }: ArchiveTimelineProps) {
  const [items, setItems] = useState<NewsArchiveDay[]>(initialItems);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(initialItems.length >= pageSize);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/news/archive?offset=${items.length}&limit=${pageSize}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const older = (await res.json()) as NewsArchiveDay[];
      setItems((prev) => [...prev, ...older]);
      if (older.length < pageSize) {
        setHasMore(false);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  if (!items.length) return null;

  return (
    <section className="rounded-2xl border border-border/40 bg-card/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Browse Past Editions</h3>
        <span className="text-xs text-muted-foreground">Daily timeline</span>
      </div>

      <div className="space-y-2">
        {items.map((entry) => (
          <Link
            key={entry.edition_date}
            href={`/news/${entry.edition_date}`}
            className="flex items-center justify-between rounded-lg border border-border/35 bg-background/55 px-3 py-2 text-sm transition-colors hover:border-accent/35 hover:bg-accent/5"
          >
            <span className="text-foreground">{formatDate(entry.edition_date)}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {entry.top_story_count} top / {entry.total_clusters} clusters
            </span>
          </Link>
        ))}
      </div>

      {hasMore ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="mt-3 inline-flex h-9 items-center justify-center rounded-md border border-border/50 px-3 text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:border-accent/35 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loadingMore ? 'Loading...' : 'Load Older Editions'}
        </button>
      ) : null}
    </section>
  );
}
