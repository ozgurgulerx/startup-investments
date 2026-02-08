'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import type { DailyNewsBrief } from '@startup-intelligence/shared';

interface DailyBriefCardProps {
  brief: DailyNewsBrief;
  onDismiss: () => void;
}

export function DailyBriefCard({ brief, onDismiss }: DailyBriefCardProps) {
  const [expanded, setExpanded] = useState(false);
  const bullets = (brief.bullets || []).slice(0, 4).filter(Boolean);
  const themes = (brief.themes || []).slice(0, 6).filter(Boolean);

  const updatedTime = brief.generated_at
    ? new Date(brief.generated_at).toLocaleString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      })
    : null;

  return (
    <section className="my-2 overflow-hidden rounded-xl border border-accent-info/20 bg-gradient-to-br from-accent-info/8 via-card/80 to-card/50 p-4">
      {/* Header row: label + meta + dismiss */}
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <p className="label-xs text-accent-info">Today&apos;s Briefing</p>
          {(updatedTime || brief.cluster_count) ? (
            <p className="text-[10px] text-muted-foreground/60">
              {brief.cluster_count ? `${brief.cluster_count} stories` : null}
              {brief.cluster_count && updatedTime ? ' · ' : null}
              {updatedTime ? `Updated ${updatedTime}` : null}
            </p>
          ) : null}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          className="flex-shrink-0 rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-muted-foreground"
          aria-label="Dismiss briefing"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Headline */}
      <h2 className="mt-2 text-lg font-light leading-snug tracking-tight text-foreground">
        {brief.headline}
      </h2>

      {/* Summary — clamped to 2 lines when collapsed */}
      {brief.summary ? (
        <p className={`mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground ${expanded ? '' : 'line-clamp-2'}`}>
          {brief.summary}
        </p>
      ) : null}

      {/* Bullet points — only when expanded */}
      {expanded && bullets.length ? (
        <ul className="mt-3 space-y-1.5">
          {bullets.map((bullet, idx) => (
            <li
              key={`${idx}-${bullet.slice(0, 24)}`}
              className="flex items-start gap-2.5 text-sm text-foreground/85"
            >
              <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-info/60" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Theme tags + expand toggle */}
      <div className="mt-3 flex items-center justify-between gap-3">
        {themes.length ? (
          <div className="flex flex-wrap gap-1.5">
            {themes.map((theme) => (
              <span
                key={theme}
                className="inline-flex items-center rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
              >
                {theme}
              </span>
            ))}
          </div>
        ) : <div />}

        {bullets.length ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex flex-shrink-0 items-center gap-1 text-[11px] text-accent-info/70 transition-colors hover:text-accent-info"
          >
            {expanded ? (
              <>Show less <ChevronUp className="h-3 w-3" /></>
            ) : (
              <>Read more <ChevronDown className="h-3 w-3" /></>
            )}
          </button>
        ) : null}
      </div>
    </section>
  );
}
