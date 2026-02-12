'use client';

import { useEffect, useState } from 'react';

interface BenchmarkItem {
  cohort_key: string;
  cohort_type: string;
  metric: string;
  cohort_size: number;
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
}

interface BenchmarksData {
  startup_values: Record<string, number | null>;
  benchmarks: BenchmarkItem[];
  cohort_keys: string[];
}

interface CohortBenchmarksProps {
  slug: string;
  region?: string;
}

const METRIC_LABELS: Record<string, string> = {
  funding_total_usd: 'Total Funding',
  confidence_score: 'Confidence',
  engineering_quality_score: 'Engineering Quality',
  pattern_count: 'Pattern Count',
};

function formatMetricValue(metric: string, value: number | null): string {
  if (value == null) return '—';
  if (metric === 'funding_total_usd') {
    if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  }
  if (metric === 'pattern_count') return String(Math.round(value));
  return value.toFixed(2);
}

function cohortLabel(key: string): string {
  if (key === 'all:all') return 'All companies';
  const [type, ...rest] = key.split(':');
  const value = rest.join(':').replace(/_/g, ' ');
  if (type === 'stage') return `${value} stage`;
  if (type === 'vertical') return value;
  if (type === 'stage_vertical') return value.replace(':', ' · ');
  return key;
}

export function CohortBenchmarks({ slug, region }: CohortBenchmarksProps) {
  const [data, setData] = useState<BenchmarksData | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (region && region !== 'global') params.set('region', region);
    fetch(`/api/v1/companies/${encodeURIComponent(slug)}/benchmarks?${params}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (d && d.benchmarks && d.benchmarks.length > 0) setData(d);
      })
      .catch(() => {});
  }, [slug, region]);

  if (!data) return null;

  // Group benchmarks by metric, pick the most specific cohort per metric
  const byMetric = new Map<string, { benchmark: BenchmarkItem; startupValue: number | null }>();
  for (const b of data.benchmarks) {
    const existing = byMetric.get(b.metric);
    // Prefer more specific cohort (stage_vertical > stage/vertical > all)
    const specificity = b.cohort_type === 'stage_vertical' ? 3
      : (b.cohort_type === 'stage' || b.cohort_type === 'vertical') ? 2 : 1;
    const existingSpecificity = existing
      ? (existing.benchmark.cohort_type === 'stage_vertical' ? 3
        : (existing.benchmark.cohort_type === 'stage' || existing.benchmark.cohort_type === 'vertical') ? 2 : 1)
      : 0;
    if (specificity >= existingSpecificity) {
      byMetric.set(b.metric, {
        benchmark: b,
        startupValue: data.startup_values[b.metric] ?? null,
      });
    }
  }

  const metrics = Array.from(byMetric.entries());
  if (metrics.length === 0) return null;

  return (
    <section className="section">
      <div className="section-header">
        <span className="section-title">Cohort Benchmarks</span>
      </div>

      <div className="space-y-4">
        {metrics.map(([metric, { benchmark: b, startupValue }]) => {
          const p10 = b.p10 ?? 0;
          const p90 = b.p90 ?? 1;
          const range = p90 - p10 || 1;

          // Percentile positions (0-100%)
          const p25Pos = ((b.p25 ?? p10) - p10) / range * 100;
          const p50Pos = ((b.p50 ?? p10) - p10) / range * 100;
          const p75Pos = ((b.p75 ?? p10) - p10) / range * 100;

          // This startup's position
          const startupPos = startupValue != null
            ? Math.max(0, Math.min(100, ((startupValue - p10) / range) * 100))
            : null;

          return (
            <div key={metric}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-foreground/80">
                  {METRIC_LABELS[metric] || metric}
                </span>
                <span className="text-[10px] text-muted-foreground/60">
                  vs. {cohortLabel(b.cohort_key)} (n={b.cohort_size})
                </span>
              </div>

              {/* Percentile bar */}
              <div className="relative h-3 rounded-full bg-muted/20 overflow-visible">
                {/* p10-p90 range */}
                <div className="absolute inset-y-0 rounded-full bg-muted/30" style={{ left: '0%', right: '0%' }} />

                {/* p25-p75 IQR */}
                <div
                  className="absolute inset-y-0 rounded-full bg-muted/50"
                  style={{ left: `${p25Pos}%`, width: `${Math.max(1, p75Pos - p25Pos)}%` }}
                />

                {/* Median marker (p50) */}
                <div
                  className="absolute top-0 bottom-0 w-px bg-foreground/30"
                  style={{ left: `${p50Pos}%` }}
                />

                {/* This startup's position */}
                {startupPos != null && (
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rotate-45 bg-accent border border-accent/80"
                    style={{ left: `${startupPos}%`, marginLeft: '-5px' }}
                    title={formatMetricValue(metric, startupValue)}
                  />
                )}
              </div>

              {/* Labels */}
              <div className="flex justify-between mt-1">
                <span className="text-[9px] text-muted-foreground/50">
                  {formatMetricValue(metric, b.p10)}
                </span>
                {startupValue != null && (
                  <span className="text-[10px] text-accent font-medium">
                    {formatMetricValue(metric, startupValue)}
                  </span>
                )}
                <span className="text-[9px] text-muted-foreground/50">
                  {formatMetricValue(metric, b.p90)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
