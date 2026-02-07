'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

interface KpiStripProps {
  totalStories: number;
  crossSourceCount: number;
  totalEntities: number;
  totalClusters: number;
}

const compactCountFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function formatCompactCount(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return compactCountFormatter.format(value);
}

export function KpiStrip({ totalStories, crossSourceCount, totalEntities, totalClusters }: KpiStripProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        title="Expand feed stats"
      >
        <ChevronDown className="h-3 w-3" />
        <span className="tabular-nums">{totalStories} stories</span>
        <span className="opacity-50">|</span>
        <span className="tabular-nums" title="Stories covered by 2+ sources">
          {crossSourceCount} corroborated
        </span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-4 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground" title="Stories in the current filtered feed view">
            Stories
          </span>
          <span className="text-foreground font-medium tabular-nums">{totalStories}</span>
        </div>
        <span className="text-border">|</span>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground" title="Stories covered by 2+ sources in this view">
            Corroborated
          </span>
          <span className="text-foreground font-medium tabular-nums">{crossSourceCount}</span>
        </div>
        <span className="text-border">|</span>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground" title="Deduped story clusters detected for the edition (includes clusters not shown)">
            Signals
          </span>
          <span className="text-foreground font-medium tabular-nums">{formatCompactCount(totalClusters)}</span>
        </div>
        <span className="text-border">|</span>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground" title="Unique named entities mentioned in this feed view">
            Entities
          </span>
          <span className="text-foreground font-medium tabular-nums">{formatCompactCount(totalEntities)}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setCollapsed(true)}
        className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        title="Collapse feed stats"
      >
        <ChevronUp className="h-3 w-3" />
      </button>
    </div>
  );
}
