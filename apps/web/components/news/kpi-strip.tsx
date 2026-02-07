'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

interface KpiStripProps {
  totalStories: number;
  crossSourceCount: number;
  totalEntities: number;
  totalClusters: number;
}

export function KpiStrip({ totalStories, crossSourceCount, totalEntities, totalClusters }: KpiStripProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown className="h-3 w-3" />
        <span className="tabular-nums">{totalStories} stories</span>
        <span className="opacity-50">|</span>
        <span className="tabular-nums">{crossSourceCount} cross-source</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-4 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Stories</span>
          <span className="text-foreground font-medium tabular-nums">{totalStories}</span>
        </div>
        <span className="text-border">|</span>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Cross-source</span>
          <span className="text-foreground font-medium tabular-nums">{crossSourceCount}</span>
        </div>
        <span className="text-border">|</span>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Clusters</span>
          <span className="text-foreground font-medium tabular-nums">{totalClusters}</span>
        </div>
        <span className="text-border">|</span>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Entities</span>
          <span className="text-foreground font-medium tabular-nums">{totalEntities}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setCollapsed(true)}
        className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
      >
        <ChevronUp className="h-3 w-3" />
      </button>
    </div>
  );
}
