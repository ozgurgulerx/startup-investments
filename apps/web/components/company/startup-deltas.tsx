'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface DeltaEvent {
  id: string;
  delta_type: string;
  domain: string;
  direction: string | null;
  headline: string;
  magnitude: number | null;
  effective_at: string;
  period: string | null;
}

interface StartupDeltasProps {
  slug: string;
  region?: string;
}

const TYPE_ICONS: Record<string, string> = {
  funding_round: '$',
  pattern_added: '+',
  pattern_removed: '−',
  signal_spike: '⚡',
  score_change: '↕',
  stage_change: '↑',
  employee_change: '👤',
  new_entry: '★',
  gtm_shift: '⟳',
};

function directionClass(dir: string | null): string {
  switch (dir) {
    case 'up': return 'border-emerald-500/30 text-emerald-400/80';
    case 'down': return 'border-red-500/30 text-red-400/80';
    case 'new': return 'border-accent/30 text-accent';
    default: return 'border-border/30 text-muted-foreground';
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function StartupDeltas({ slug, region }: StartupDeltasProps) {
  const [events, setEvents] = useState<DeltaEvent[]>([]);

  useEffect(() => {
    const params = new URLSearchParams({ limit: '8' });
    if (region && region !== 'global') params.set('region', region);
    fetch(`/api/companies/${encodeURIComponent(slug)}/deltas?${params}`)
      .then((res) => (res.ok ? res.json() : { events: [] }))
      .then((data) => {
        if (data.events) setEvents(data.events);
      })
      .catch(() => {});
  }, [slug, region]);

  if (events.length === 0) return null;

  return (
    <section className="section">
      <div className="section-header">
        <span className="section-title">Recent Changes</span>
        <Link href="/movers" className="section-link">
          All movers
        </Link>
      </div>

      <div className="relative pl-4 border-l border-border/20">
        {events.map((ev, i) => (
          <div key={ev.id} className="relative pb-3 last:pb-0">
            {/* Timeline dot */}
            <div
              className={`absolute -left-[calc(1rem+4px)] top-1 w-2 h-2 rounded-full border ${directionClass(ev.direction)} bg-background`}
            />

            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground/60">
                    {TYPE_ICONS[ev.delta_type] || '•'}
                  </span>
                  <span className="text-sm text-foreground/80 truncate">
                    {ev.headline.replace(/^[^:]+:\s*/, '')}
                  </span>
                </div>
              </div>
              <span className="text-[10px] text-muted-foreground/50 whitespace-nowrap shrink-0">
                {formatDate(ev.effective_at)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
