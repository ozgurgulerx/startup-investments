'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

interface KpiStripProps {
  totalStories: number;
  crossSourceCount: number;
  totalEntities: number;
  totalClusters: number;
  region?: 'global' | 'turkey';
}

const compactCountFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function formatCompactCount(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return compactCountFormatter.format(value);
}

export function KpiStrip({
  totalStories,
  crossSourceCount,
  totalEntities,
  totalClusters,
  region = 'global',
}: KpiStripProps) {
  const l = region === 'turkey'
    ? {
      items: 'Oge',
      corroborated: 'Dogrulanmis',
      signals: 'Sinyal',
      entities: 'Varlik',
      expand: 'Istatistikleri genislet',
      collapse: 'Istatistikleri daralt',
      coveredBySources: '2+ kaynakla desteklenen oge sayisi',
      currentViewItems: 'Filtrelenmis gorunumdeki oge sayisi',
      clusterCount: 'Yayindaki benzersiz hikaye kumesi (gosterilmeyenler dahil)',
      uniqueEntities: 'Bu gorunumdeki benzersiz varlik sayisi',
    }
    : {
      items: 'Items',
      corroborated: 'Corroborated',
      signals: 'Signals',
      entities: 'Entities',
      expand: 'Expand feed stats',
      collapse: 'Collapse feed stats',
      coveredBySources: 'Items covered by 2+ sources',
      currentViewItems: 'Items in the current filtered feed view',
      clusterCount: 'Deduped story clusters detected for the edition (includes clusters not shown)',
      uniqueEntities: 'Unique named entities mentioned in this feed view',
    };
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        title={l.expand}
      >
        <ChevronDown className="h-3 w-3" />
        <span className="tabular-nums">{totalStories} {l.items.toLowerCase()}</span>
        <span className="opacity-50">|</span>
        <span className="tabular-nums" title={l.coveredBySources}>
          {crossSourceCount} {l.corroborated.toLowerCase()}
        </span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-4 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground" title={l.currentViewItems}>
            {l.items}
          </span>
          <span className="text-foreground font-medium tabular-nums">{totalStories}</span>
        </div>
        <span className="text-border">|</span>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground" title={l.coveredBySources}>
            {l.corroborated}
          </span>
          <span className="text-foreground font-medium tabular-nums">{crossSourceCount}</span>
        </div>
        <span className="text-border">|</span>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground" title={l.clusterCount}>
            {l.signals}
          </span>
          <span className="text-foreground font-medium tabular-nums">{formatCompactCount(totalClusters)}</span>
        </div>
        <span className="text-border">|</span>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground" title={l.uniqueEntities}>
            {l.entities}
          </span>
          <span className="text-foreground font-medium tabular-nums">{formatCompactCount(totalEntities)}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setCollapsed(true)}
        className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        title={l.collapse}
      >
        <ChevronUp className="h-3 w-3" />
      </button>
    </div>
  );
}
