'use client';

import Link from 'next/link';
import { Calendar, TrendingUp } from 'lucide-react';

interface BriefPreviewData {
  period_type: 'weekly' | 'monthly';
  period_start: string;
  period_end: string;
  title: string | null;
  story_count: number;
  executive_summary?: string;
}

function formatDateRange(start: string, end: string, locale: string) {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  if (sameMonth) {
    return `${s.toLocaleDateString(locale, { month: 'short', day: 'numeric' })} – ${e.getDate()}`;
  }
  return `${s.toLocaleDateString(locale, { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString(locale, { month: 'short', day: 'numeric' })}`;
}

function BriefCard({
  brief,
  href,
  region,
}: {
  brief: BriefPreviewData;
  href: string;
  region: 'global' | 'turkey';
}) {
  const isTR = region === 'turkey';
  const label = brief.period_type === 'weekly'
    ? (isTR ? 'Haftalik' : 'Weekly')
    : (isTR ? 'Aylik' : 'Monthly');
  const dateRange = formatDateRange(brief.period_start, brief.period_end, isTR ? 'tr-TR' : 'en-US');
  const Icon = brief.period_type === 'weekly' ? Calendar : TrendingUp;

  // Use first sentence of executive summary as teaser
  const teaser = brief.executive_summary
    ? brief.executive_summary.split(/\.\s/)[0] + '.'
    : null;

  return (
    <Link
      href={href}
      className="group flex gap-3 rounded-xl border border-border/30 bg-card/40 p-3 transition-colors hover:border-accent-info/30 hover:bg-card/60"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-info/10 text-accent-info">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-accent-info">{label} {isTR ? 'Bulten' : 'Brief'}</span>
          <span className="text-[10px] text-muted-foreground">{dateRange}</span>
        </div>
        {teaser ? (
          <p className="mt-0.5 text-xs leading-relaxed text-foreground/80 line-clamp-2">
            {teaser}
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {brief.story_count} {isTR ? 'sinyal kapsandi' : 'signals covered'}
          </p>
        )}
      </div>
      <span className="mt-1 shrink-0 text-[10px] text-muted-foreground/60 transition-colors group-hover:text-accent-info">
        {isTR ? 'Oku' : 'Read'} &rarr;
      </span>
    </Link>
  );
}

export interface PeriodicBriefPreviewProps {
  region: 'global' | 'turkey';
  weeklyBrief?: BriefPreviewData | null;
  monthlyBrief?: BriefPreviewData | null;
}

export function PeriodicBriefPreview({ region, weeklyBrief, monthlyBrief }: PeriodicBriefPreviewProps) {
  if (!weeklyBrief && !monthlyBrief) return null;

  const basePath = region === 'turkey' ? '/news/turkey' : '/news';

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
      {weeklyBrief && (
        <div className="flex-1">
          <BriefCard brief={weeklyBrief} href={`${basePath}/weekly`} region={region} />
        </div>
      )}
      {monthlyBrief && (
        <div className="flex-1">
          <BriefCard brief={monthlyBrief} href={`${basePath}/monthly`} region={region} />
        </div>
      )}
    </div>
  );
}
