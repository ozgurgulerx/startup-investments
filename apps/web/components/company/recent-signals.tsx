'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { deltaTypeBadgeClass } from '@/lib/strategy-templates';
import { timeAgo } from '@/lib/news-utils';

interface Signal {
  id: string;
  title: string;
  story_type: string;
  published_at: string;
  rank_score: number;
  delta_type: string;
}

interface RecentSignalsProps {
  slug: string;
  region?: string;
}

export function RecentSignals({ slug, region }: RecentSignalsProps) {
  const [signals, setSignals] = useState<Signal[]>([]);

  useEffect(() => {
    const params = new URLSearchParams({ limit: '5', days: '30' });
    fetch(`/api/v1/startups/${encodeURIComponent(slug)}/signals?${params}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setSignals(data);
      })
      .catch(() => {});
  }, [slug]);

  if (signals.length === 0) return null;

  const regionParam = region && region !== 'global' ? `&region=${encodeURIComponent(region)}` : '';

  return (
    <section className="section">
      <div className="section-header">
        <span className="section-title">Recent Signals (30d)</span>
        <Link
          href={region === 'turkey' ? '/news/turkey' : '/news'}
          className="section-link"
        >
          Full radar
        </Link>
      </div>

      <div className="space-y-2">
        {signals.map((signal) => (
          <Link
            key={signal.id}
            href={`${region === 'turkey' ? '/news/turkey' : '/news'}?story=${signal.id}${regionParam}`}
            className="flex items-center gap-2 py-1.5 group"
          >
            <span className={`inline-flex shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${deltaTypeBadgeClass(signal.delta_type)}`}>
              {signal.delta_type}
            </span>
            <span className="text-xs text-foreground/80 truncate group-hover:text-accent-info transition-colors">
              {signal.title}
            </span>
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60 tabular-nums">
              {timeAgo(signal.published_at)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
