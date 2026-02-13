'use client';

import { ShieldCheck } from 'lucide-react';

interface TrustBadgeProps {
  trustScore: number;
  sourceCount: number;
  region?: 'global' | 'turkey';
}

export function TrustBadge({ trustScore, sourceCount, region = 'global' }: TrustBadgeProps) {
  const pct = Math.round(Math.max(0, Math.min(1, trustScore)) * 100);
  const tone = pct >= 70
    ? 'text-success border-success/35 bg-success/10'
    : pct >= 45
      ? 'text-warning border-warning/35 bg-warning/10'
      : 'text-muted-foreground border-border/40 bg-muted/20';

  const trustLabel = region === 'turkey' ? 'guven' : 'trust';
  const sourceUnit = region === 'turkey' ? 'kaynak' : 'src';

  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${tone}`}>
      <ShieldCheck className="h-3 w-3" />
      <span>{pct}% {trustLabel}</span>
      <span className="opacity-70">·</span>
      <span>{sourceCount} {sourceUnit}</span>
    </div>
  );
}
