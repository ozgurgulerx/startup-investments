'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { cn } from '@/lib/utils';
import { CHART_PALETTE, CHART_GRID, CHART_AXIS, CHART_CURSOR } from '@/lib/chart-colors';
import type { OccurrenceItem } from '@/lib/api/client';
import { STAGE_LABELS } from './types';

interface ExplorerTabProps {
  signalId: string;
}

export function ExplorerTab({ signalId }: ExplorerTabProps) {
  const [occurrences, setOccurrences] = useState<OccurrenceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(`/api/signals/${signalId}/occurrences?limit=100`)
      .then(r => r.json())
      .then((data: { occurrences: OccurrenceItem[]; total: number }) => {
        if (!cancelled) {
          setOccurrences(data.occurrences || []);
          setTotal(data.total || 0);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [signalId]);

  // Score histogram
  const histogramData = useMemo(() => {
    const buckets = Array.from({ length: 10 }, (_, i) => ({
      label: `${(i * 10)}%`,
      range: `${i * 10}-${(i + 1) * 10}%`,
      count: 0,
    }));
    for (const occ of occurrences) {
      const idx = Math.min(9, Math.floor(occ.score * 10));
      buckets[idx].count++;
    }
    return buckets.filter(b => b.count > 0);
  }, [occurrences]);

  // Stage counts
  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const occ of occurrences) {
      const stage = occ.funding_stage || 'unknown';
      counts[stage] = (counts[stage] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [occurrences]);

  // Filtered list
  const filteredOccurrences = useMemo(() => {
    if (!stageFilter) return occurrences;
    return occurrences.filter(o => (o.funding_stage || 'unknown') === stageFilter);
  }, [occurrences, stageFilter]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-40 bg-muted rounded-lg" />
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-muted rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (occurrences.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">No occurrence scores computed yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Score histogram */}
      {histogramData.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
            Score Distribution ({total} companies)
          </h3>
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={histogramData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  stroke={CHART_AXIS}
                  tickLine={false}
                />
                <YAxis hide />
                <Tooltip
                  cursor={{ fill: CHART_CURSOR }}
                  content={({ active, payload }) => {
                    if (active && payload?.length) {
                      const d = payload[0].payload;
                      return (
                        <div className="rounded-lg border border-border bg-card p-2 shadow-lg text-xs">
                          <p className="text-foreground font-medium">{d.range}</p>
                          <p className="text-muted-foreground">{d.count} companies</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {histogramData.map((_, i) => (
                    <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Stage filter pills */}
      {stageCounts.length > 1 && (
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setStageFilter(null)}
            className={cn(
              'px-2.5 py-1 text-xs rounded-full transition-colors',
              !stageFilter
                ? 'bg-foreground/10 text-foreground'
                : 'bg-muted/20 text-muted-foreground hover:text-foreground'
            )}
          >
            All ({total})
          </button>
          {stageCounts.map(([stage, count]) => (
            <button
              key={stage}
              onClick={() => setStageFilter(stageFilter === stage ? null : stage)}
              className={cn(
                'px-2.5 py-1 text-xs rounded-full transition-colors',
                stageFilter === stage
                  ? 'bg-foreground/10 text-foreground'
                  : 'bg-muted/20 text-muted-foreground hover:text-foreground'
              )}
            >
              {STAGE_LABELS[stage] || stage} ({count})
            </button>
          ))}
        </div>
      )}

      {/* Company list */}
      <div className="space-y-1">
        {filteredOccurrences.slice(0, 50).map((occ) => (
          <div
            key={occ.id}
            className="flex items-center gap-3 py-2.5 px-3 hover:bg-muted/10 rounded-lg transition-colors"
          >
            {/* Score bar */}
            <div className="w-12 flex-shrink-0">
              <div className="h-1.5 bg-muted/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent-info/60 rounded-full"
                  style={{ width: `${occ.score * 100}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground/50 text-center mt-0.5 tabular-nums">
                {(occ.score * 100).toFixed(0)}%
              </p>
            </div>

            {/* Company info */}
            <div className="flex-1 min-w-0">
              <Link
                href={`/company/${occ.startup_slug}`}
                className="text-sm text-foreground hover:text-accent-info transition-colors font-medium"
              >
                {occ.startup_name}
              </Link>
            </div>

            {/* Stage */}
            {occ.funding_stage && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/20 text-muted-foreground flex-shrink-0">
                {STAGE_LABELS[occ.funding_stage] || occ.funding_stage}
              </span>
            )}

            {/* Evidence count */}
            <span className="text-[10px] text-muted-foreground/50 tabular-nums flex-shrink-0">
              {occ.evidence_count} ev.
            </span>
          </div>
        ))}

        {filteredOccurrences.length > 50 && (
          <p className="text-xs text-muted-foreground/60 text-center pt-2">
            Showing 50 of {filteredOccurrences.length}
          </p>
        )}
      </div>
    </div>
  );
}
