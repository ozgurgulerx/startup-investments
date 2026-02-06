'use client';

import { ShieldCheck } from 'lucide-react';

interface TrustBadgeProps {
  trustScore: number;
  sourceCount: number;
}

export function TrustBadge({ trustScore, sourceCount }: TrustBadgeProps) {
  const pct = Math.round(Math.max(0, Math.min(1, trustScore)) * 100);
  const tone = pct >= 70 ? 'text-success border-success/30 bg-success/10' : pct >= 45 ? 'text-warning border-warning/30 bg-warning/10' : 'text-muted-foreground border-border/40 bg-muted/20';

  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${tone}`}>
      <ShieldCheck className="h-3 w-3" />
      <span>{pct}% trust</span>
      <span className="opacity-70">·</span>
      <span>{sourceCount} src</span>
    </div>
  );
}
