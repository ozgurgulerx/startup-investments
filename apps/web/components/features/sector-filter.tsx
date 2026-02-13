'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';

interface SectorItem {
  id: string;
  label: string;
  count: number;
}

interface SectorFilterProps {
  region?: string;
  value: string | null;
  onChange: (sectorId: string | null) => void;
  /** Number of sectors to show before "More" toggle (default 8) */
  visibleCount?: number;
  className?: string;
}

export function SectorFilter({
  region = 'global',
  value,
  onChange,
  visibleCount = 8,
  className,
}: SectorFilterProps) {
  const [sectors, setSectors] = useState<SectorItem[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(`/api/sectors?region=${region}`)
      .then(r => r.json())
      .then(data => {
        if (!cancelled && data.sectors) {
          setSectors(data.sectors);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [region]);

  const visible = useMemo(
    () => expanded ? sectors : sectors.slice(0, visibleCount),
    [sectors, expanded, visibleCount],
  );

  const hasMore = sectors.length > visibleCount;

  const handleClick = useCallback((id: string | null) => {
    onChange(id === value ? null : id);
  }, [onChange, value]);

  if (loading) {
    return (
      <div className={cn('flex items-center gap-1.5', className)}>
        <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider w-12 shrink-0">Sector</span>
        <div className="flex gap-1">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-6 w-16 bg-muted/20 rounded-full animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (sectors.length === 0) return null;

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider w-12 shrink-0">Sector</span>
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => handleClick(null)}
          className={cn(
            'px-2.5 py-1 text-[11px] rounded-full transition-colors whitespace-nowrap',
            value === null
              ? 'bg-accent-info/10 text-accent-info border border-accent-info/25'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/25 border border-transparent',
          )}
        >
          All
        </button>
        {visible.map(s => (
          <button
            key={s.id}
            onClick={() => handleClick(s.id)}
            className={cn(
              'px-2.5 py-1 text-[11px] rounded-full transition-colors whitespace-nowrap',
              value === s.id
                ? 'bg-accent-info/10 text-accent-info border border-accent-info/25'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/25 border border-transparent',
            )}
          >
            {s.label}
            <span className="ml-1 opacity-50">{s.count}</span>
          </button>
        ))}
        {hasMore && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="px-2.5 py-1 text-[11px] rounded-full text-muted-foreground/60 hover:text-muted-foreground transition-colors whitespace-nowrap"
          >
            {expanded ? 'Less' : `+${sectors.length - visibleCount} more`}
          </button>
        )}
      </div>
    </div>
  );
}
