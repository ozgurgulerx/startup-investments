'use client';

import Link from 'next/link';
import type { DeltaEvent } from '@/lib/api/client';

/* ------------------------------------------------------------------
 * Delta-type icons (lightweight inline SVGs)
 * ----------------------------------------------------------------*/

const typeIcons: Record<string, React.ReactNode> = {
  funding_round: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
  pattern_added: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
      />
    </svg>
  ),
  pattern_removed: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
      />
    </svg>
  ),
  signal_spike: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M13 10V3L4 14h7v7l9-11h-7z"
      />
    </svg>
  ),
  score_change: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
      />
    </svg>
  ),
  stage_change: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M5 10l7-7m0 0l7 7m-7-7v18"
      />
    </svg>
  ),
  employee_change: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
      />
    </svg>
  ),
  new_entry: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M12 4v16m8-8H4"
      />
    </svg>
  ),
  gtm_shift: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  ),
};

/* ------------------------------------------------------------------
 * Direction color helper
 * ----------------------------------------------------------------*/

function directionColor(dir: string | null): string {
  switch (dir) {
    case 'up':
      return 'text-emerald-400/80';
    case 'down':
      return 'text-red-400/80';
    case 'new':
      return 'text-accent';
    default:
      return 'text-muted-foreground';
  }
}

/* ------------------------------------------------------------------
 * Relative time formatter
 * ----------------------------------------------------------------*/

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days > 30) return `${Math.floor(days / 30)}mo ago`;
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours > 0) return `${hours}h ago`;
  return 'just now';
}

/* ------------------------------------------------------------------
 * DeltaCard component
 * ----------------------------------------------------------------*/

export function DeltaCard({ event }: { event: DeltaEvent }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-border/30 hover:border-border/60 transition-colors">
      {/* Type icon */}
      <div className={`mt-0.5 ${directionColor(event.direction)}`}>
        {typeIcons[event.delta_type] || typeIcons.score_change}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {event.startup_slug ? (
            <Link
              href={`/company/${event.startup_slug}`}
              className="text-sm font-medium hover:text-accent transition-colors truncate"
            >
              {event.startup_name}
            </Link>
          ) : (
            <span className="text-sm font-medium truncate">{event.headline}</span>
          )}
          <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap">
            {formatRelativeTime(event.effective_at)}
          </span>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">
          {event.startup_slug
            ? event.headline
                .replace(`${event.startup_name}: `, '')
                .replace(`${event.startup_name} `, '')
            : event.detail}
        </p>
        {/* Chips */}
        <div className="flex items-center gap-1.5 mt-1.5">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground capitalize">
            {event.delta_type.replace(/_/g, ' ')}
          </span>
          {event.domain !== 'general' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground/70 capitalize">
              {event.domain}
            </span>
          )}
        </div>
      </div>

      {/* Magnitude bar */}
      {event.magnitude != null && (
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="w-16 h-1.5 rounded-full bg-muted/30 overflow-hidden">
            <div
              className="h-full rounded-full bg-accent/60"
              style={{ width: `${Math.round(event.magnitude * 100)}%` }}
            />
          </div>
          <span className="text-[9px] text-muted-foreground/50">
            {(event.magnitude * 100).toFixed(0)}%
          </span>
        </div>
      )}
    </div>
  );
}
