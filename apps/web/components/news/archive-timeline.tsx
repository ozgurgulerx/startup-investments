'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Calendar, ChevronDown, Loader2 } from 'lucide-react';
import type { NewsArchiveDay } from '@startup-intelligence/shared';

interface ArchiveTimelineProps {
  initialItems: NewsArchiveDay[];
  pageSize?: number;
  region?: 'global' | 'turkey';
  hrefPrefix?: string;
}

function formatDate(value: string, locale: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatMonthHeader(yearMonth: string, locale: string): string {
  const [year, month] = yearMonth.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

function storyTypeDot(type: string): string {
  const t = (type || '').toLowerCase();
  if (t === 'funding') return 'bg-success';
  if (t === 'mna') return 'bg-delta';
  if (t === 'regulation') return 'bg-warning';
  if (t === 'launch') return 'bg-accent-info';
  return 'bg-muted-foreground/40';
}

function storyTypeLabel(type: string, region: 'global' | 'turkey'): string {
  const t = (type || '').toLowerCase();
  if (t === 'mna') return region === 'turkey' ? 'Satinalma' : 'M&A';
  if (region === 'turkey') {
    if (t === 'funding') return 'Yatirim';
    if (t === 'regulation') return 'Regulasyon';
    if (t === 'launch') return 'Lansman';
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function groupByMonth(items: NewsArchiveDay[]): { month: string; entries: NewsArchiveDay[] }[] {
  const groups: Map<string, NewsArchiveDay[]> = new Map();
  for (const item of items) {
    const month = item.edition_date.slice(0, 7); // YYYY-MM
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month)!.push(item);
  }
  return Array.from(groups.entries()).map(([month, entries]) => ({ month, entries }));
}

export function ArchiveTimeline({
  initialItems,
  pageSize = 30,
  region = 'global',
  hrefPrefix = '/news',
}: ArchiveTimelineProps) {
  const isTR = region === 'turkey';
  const locale = isTR ? 'tr-TR' : 'en-US';
  const l = isTR
    ? {
      noPastEditions: 'Henuz gecmis baski yok.',
      edition: 'baski',
      editions: 'baski',
      signals: 'sinyal',
      top: 'ust',
      loading: 'Yukleniyor...',
      loadOlder: 'Daha eski baskilari yukle',
    }
    : {
      noPastEditions: 'No past editions available yet.',
      edition: 'edition',
      editions: 'editions',
      signals: 'signals',
      top: 'top',
      loading: 'Loading...',
      loadOlder: 'Load Older Editions',
    };
  const [items, setItems] = useState<NewsArchiveDay[]>(initialItems);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(initialItems.length >= pageSize);

  const monthGroups = useMemo(() => groupByMonth(items), [items]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const regionParam = region === 'turkey' ? '&region=turkey' : '';
      const res = await fetch(`/api/news/archive?offset=${items.length}&limit=${pageSize}${regionParam}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const older = (await res.json()) as NewsArchiveDay[];
      setItems((prev) => [...prev, ...older]);
      if (older.length < pageSize) setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }

  if (!items.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-border/40 bg-card/60 px-6 py-16 text-center">
        <Calendar className="mb-3 h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">{l.noPastEditions}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {monthGroups.map((group) => (
        <section key={group.month}>
          {/* Month header */}
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-sm font-medium tracking-tight text-foreground">
              {formatMonthHeader(group.month, locale)}
            </h2>
            <div className="h-px flex-1 bg-border/30" />
            <span className="text-[10px] text-muted-foreground/60 tabular-nums">
              {group.entries.length} {group.entries.length === 1 ? l.edition : l.editions}
            </span>
          </div>

          {/* Edition cards */}
          <div className="space-y-2">
            {group.entries.map((entry, idx) => {
              const topTypes = entry.story_type_counts
                ? Object.entries(entry.story_type_counts)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 3)
                : [];
              const topics = (entry.top_topics || []).slice(0, 3);

              return (
                <motion.div
                  key={entry.edition_date}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: Math.min(idx * 0.03, 0.3) }}
                >
                  <Link
                    href={`${hrefPrefix}/${entry.edition_date}`}
                    className="group block rounded-xl border border-border/35 bg-card/50 px-4 py-3 transition-colors hover:border-accent-info/30 hover:bg-accent-info/[0.03]"
                  >
                    {/* Top row: date + stats */}
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-foreground group-hover:text-accent-info transition-colors">
                        {formatDate(entry.edition_date, locale)}
                      </span>
                      <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                        {entry.total_clusters} {l.signals} · {entry.top_story_count} {l.top}
                      </span>
                    </div>

                    {/* Brief headline */}
                    {entry.brief_headline ? (
                      <p className="mt-1.5 text-sm font-light leading-snug text-foreground/70 line-clamp-1">
                        {entry.brief_headline}
                      </p>
                    ) : null}

                    {/* Bottom row: topics + story type dots */}
                    {(topics.length > 0 || topTypes.length > 0) ? (
                      <div className="mt-2 flex items-center justify-between gap-3">
                        {topics.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {topics.map((topic) => (
                              <span
                                key={topic}
                                className="inline-flex items-center rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
                              >
                                {topic}
                              </span>
                            ))}
                          </div>
                        ) : <div />}
                        {topTypes.length > 0 ? (
                          <div className="flex items-center gap-2">
                            {topTypes.map(([type]) => (
                              <span key={type} className="flex items-center gap-1">
                                <span className={`h-1.5 w-1.5 rounded-full ${storyTypeDot(type)}`} />
                                <span className="text-[10px] text-muted-foreground/60">
                                  {storyTypeLabel(type, region)}
                                </span>
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </section>
      ))}

      {/* Load more */}
      {hasMore ? (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-lg border border-border/50 px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:border-accent-info/35 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
                {loadingMore ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {l.loading}
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3" />
                    {l.loadOlder}
                  </>
                )}
          </button>
        </div>
      ) : null}
    </div>
  );
}
