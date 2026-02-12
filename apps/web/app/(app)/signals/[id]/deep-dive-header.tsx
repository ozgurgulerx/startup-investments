'use client';

import Link from 'next/link';
import { ArrowLeft, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/news-utils';
import type { SignalItem } from '@/lib/api/client';
import { STATUS_STYLES, DOMAIN_LABELS } from './types';

interface DeepDiveHeaderProps {
  signal: SignalItem;
  version: number;
  createdAt: string;
  diff: { diff_json: Record<string, any> } | null;
  sampleCount: number;
}

function MetricPill({ label, value, format }: {
  label: string;
  value: number;
  format: 'percent' | 'delta';
}) {
  const displayValue = format === 'percent'
    ? `${(value * 100).toFixed(0)}%`
    : `${value >= 0 ? '+' : ''}${(value * 100).toFixed(0)}%`;

  const colorClass = format === 'delta'
    ? value > 0 ? 'text-accent-info' : value < 0 ? 'text-destructive' : 'text-muted-foreground'
    : 'text-muted-foreground';

  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="text-muted-foreground/60">{label}</span>
      <span className={cn('font-medium tabular-nums', colorClass)}>{displayValue}</span>
    </span>
  );
}

export function DeepDiveHeader({ signal, version, createdAt, diff, sampleCount }: DeepDiveHeaderProps) {
  const statusStyle = STATUS_STYLES[signal.status] || STATUS_STYLES.candidate;
  const domainLabel = DOMAIN_LABELS[signal.domain] || signal.domain;

  return (
    <div className="space-y-4">
      {/* Back link */}
      <Link
        href="/signals"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3 h-3" />
        Signals
      </Link>

      {/* Badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn(
          'px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded-full',
          statusStyle.bg, statusStyle.text
        )}>
          {statusStyle.label}
        </span>
        <span className="px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded-full bg-muted/30 text-muted-foreground">
          {domainLabel}
        </span>
        {diff && (
          <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-accent-info/10 text-accent-info">
            v{version} updated
          </span>
        )}
      </div>

      {/* Claim */}
      <h1 className="text-xl md:text-2xl font-light text-foreground leading-tight">
        {signal.claim}
      </h1>

      {/* Definition */}
      {signal.explain?.definition && (
        <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl">
          {signal.explain.definition}
        </p>
      )}

      {/* Metrics row */}
      <div className="flex items-center gap-4 flex-wrap">
        <MetricPill label="Conv" value={signal.conviction} format="percent" />
        <MetricPill label="Mom" value={signal.momentum} format="delta" />
        <MetricPill label="Impact" value={signal.impact} format="percent" />
        <MetricPill label="Vel" value={signal.adoption_velocity} format="delta" />

        <span className="h-3 w-px bg-border/30" />

        <span className="text-xs text-muted-foreground/60 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {sampleCount} companies sampled
        </span>

        <span className="text-xs text-muted-foreground/60">
          Generated {timeAgo(createdAt)}
        </span>
      </div>
    </div>
  );
}
