'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRegion } from '@/lib/region-context';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface CohortBenchmark {
  cohort_key: string;
  cohort_type: string;
  metric: string;
  cohort_size: number;
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  mean: number | null;
  stddev: number | null;
  period: string;
}

interface CohortInfo {
  cohort_key: string;
  cohort_type: string;
  size: number;
  metrics: string[];
}

const METRIC_LABELS: Record<string, string> = {
  funding_total_usd: 'Total Funding',
  latest_round_usd: 'Latest Round',
  employee_count: 'Employees',
  confidence_score: 'Confidence',
  engineering_quality_score: 'Engineering Quality',
  conviction_mean: 'Avg Conviction',
  pattern_count: 'Pattern Count',
};

const COHORT_TYPE_LABELS: Record<string, string> = {
  all: 'All',
  stage: 'By Stage',
  vertical: 'By Vertical',
  pattern: 'By Pattern',
  stage_vertical: 'Stage + Vertical',
  stage_pattern: 'Stage + Pattern',
};

function formatValue(value: number | null, metric: string): string {
  if (value == null) return '-';
  if (metric.includes('usd')) {
    if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  }
  if (metric === 'employee_count') return value.toFixed(0);
  return value.toFixed(2);
}

export default function BenchmarksPage() {
  const { region } = useRegion();
  const [cohorts, setCohorts] = useState<CohortInfo[]>([]);
  const [benchmarks, setBenchmarks] = useState<CohortBenchmark[]>([]);
  const [selectedCohortType, setSelectedCohortType] = useState('all');
  const [selectedCohort, setSelectedCohort] = useState('all:all');
  const [selectedMetric, setSelectedMetric] = useState('funding_total_usd');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const qs = region !== 'global' ? `?region=${region}` : '';
        const [cohortRes, benchRes] = await Promise.all([
          fetch(`/api/benchmarks/cohorts${qs}`),
          fetch(`/api/benchmarks${qs}`),
        ]);
        if (cohortRes.ok) setCohorts(await cohortRes.json());
        if (benchRes.ok) {
          const data = await benchRes.json();
          setBenchmarks(data.benchmarks || []);
        }
      } catch (err) {
        console.error('Failed to load benchmarks:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [region]);

  const filteredCohorts = useMemo(() => {
    if (selectedCohortType === 'all') return cohorts;
    return cohorts.filter(c => c.cohort_type === selectedCohortType);
  }, [cohorts, selectedCohortType]);

  const selectedBenchmarks = useMemo(() => {
    return benchmarks.filter(b => b.cohort_key === selectedCohort && b.metric === selectedMetric);
  }, [benchmarks, selectedCohort, selectedMetric]);

  const distributionData = useMemo(() => {
    const bench = selectedBenchmarks[0];
    if (!bench) return [];
    return [
      { label: 'p10', value: bench.p10 },
      { label: 'p25', value: bench.p25 },
      { label: 'p50', value: bench.p50 },
      { label: 'p75', value: bench.p75 },
      { label: 'p90', value: bench.p90 },
    ].filter(d => d.value != null);
  }, [selectedBenchmarks]);

  const cohortMetrics = useMemo(() => {
    return benchmarks.filter(b => b.cohort_key === selectedCohort);
  }, [benchmarks, selectedCohort]);

  const cohortTypes = useMemo(() => {
    const types = new Set(cohorts.map(c => c.cohort_type));
    return ['all', ...Array.from(types)];
  }, [cohorts]);

  if (loading) {
    return (
      <>
        <div className="briefing-header">
          <span className="briefing-date">Benchmarks</span>
          <h1 className="briefing-headline">Cohort percentile distributions</h1>
        </div>
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="briefing-header">
        <span className="briefing-date">Benchmarks</span>
        <h1 className="briefing-headline">Cohort percentile distributions</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Compare funding, scores, and team size across {cohorts.length} cohorts
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 mt-6">
        {/* Left Panel — Cohort Builder */}
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cohort Type</label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {cohortTypes.map(ct => (
                <button
                  key={ct}
                  onClick={() => { setSelectedCohortType(ct); setSelectedCohort(filteredCohorts[0]?.cohort_key || 'all:all'); }}
                  className={`px-2.5 py-1 text-xs rounded transition-colors ${
                    selectedCohortType === ct
                      ? 'bg-accent-info/15 text-accent-info'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                  }`}
                >
                  {COHORT_TYPE_LABELS[ct] || ct}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cohort</label>
            <div className="mt-2 space-y-0.5 max-h-64 overflow-y-auto">
              {filteredCohorts.map(c => (
                <button
                  key={c.cohort_key}
                  onClick={() => setSelectedCohort(c.cohort_key)}
                  className={`w-full text-left px-2.5 py-1.5 text-xs rounded transition-colors flex items-center justify-between ${
                    selectedCohort === c.cohort_key
                      ? 'bg-accent-info/15 text-accent-info'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                  }`}
                >
                  <span className="truncate">{c.cohort_key.split(':').slice(1).join(':') || c.cohort_key}</span>
                  <span className="text-[10px] text-muted-foreground/60 ml-2">n={c.size}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Metric</label>
            <div className="mt-2 space-y-0.5">
              {Object.entries(METRIC_LABELS).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setSelectedMetric(key)}
                  className={`w-full text-left px-2.5 py-1.5 text-xs rounded transition-colors ${
                    selectedMetric === key
                      ? 'bg-accent-info/15 text-accent-info'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Panel — Distribution + Stats */}
        <div className="space-y-6">
          {/* Distribution Chart */}
          {distributionData.length > 0 && (
            <div className="p-4 border border-border/30 rounded-lg">
              <h3 className="text-sm font-medium text-foreground mb-1">
                {METRIC_LABELS[selectedMetric]} — {selectedCohort}
              </h3>
              <p className="text-xs text-muted-foreground mb-4">
                n={selectedBenchmarks[0]?.cohort_size || 0} startups
              </p>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={distributionData} margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} tickFormatter={(v) => formatValue(v, selectedMetric)} />
                    <Tooltip
                      contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                      formatter={(value: number) => [formatValue(value, selectedMetric), METRIC_LABELS[selectedMetric]]}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {distributionData.map((_, i) => (
                        <Cell key={i} fill={i === 2 ? 'var(--accent-info)' : 'var(--muted-foreground)'} opacity={i === 2 ? 0.8 : 0.3} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* All Metrics for Selected Cohort */}
          <div className="p-4 border border-border/30 rounded-lg">
            <h3 className="text-sm font-medium text-foreground mb-3">All Metrics — {selectedCohort}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground/70 border-b border-border/20">
                    <th className="text-left py-2 pr-4">Metric</th>
                    <th className="text-right py-2 px-2">p10</th>
                    <th className="text-right py-2 px-2">p25</th>
                    <th className="text-right py-2 px-2 font-semibold">p50</th>
                    <th className="text-right py-2 px-2">p75</th>
                    <th className="text-right py-2 px-2">p90</th>
                    <th className="text-right py-2 px-2">Mean</th>
                    <th className="text-right py-2 pl-2">n</th>
                  </tr>
                </thead>
                <tbody>
                  {cohortMetrics.map(b => (
                    <tr
                      key={b.metric}
                      className={`border-b border-border/10 cursor-pointer transition-colors ${
                        b.metric === selectedMetric ? 'bg-accent-info/5' : 'hover:bg-muted/20'
                      }`}
                      onClick={() => setSelectedMetric(b.metric)}
                    >
                      <td className="py-2 pr-4 text-foreground">{METRIC_LABELS[b.metric] || b.metric}</td>
                      <td className="text-right py-2 px-2 tabular-nums text-muted-foreground">{formatValue(b.p10, b.metric)}</td>
                      <td className="text-right py-2 px-2 tabular-nums text-muted-foreground">{formatValue(b.p25, b.metric)}</td>
                      <td className="text-right py-2 px-2 tabular-nums font-medium text-foreground">{formatValue(b.p50, b.metric)}</td>
                      <td className="text-right py-2 px-2 tabular-nums text-muted-foreground">{formatValue(b.p75, b.metric)}</td>
                      <td className="text-right py-2 px-2 tabular-nums text-muted-foreground">{formatValue(b.p90, b.metric)}</td>
                      <td className="text-right py-2 px-2 tabular-nums text-muted-foreground">{formatValue(b.mean, b.metric)}</td>
                      <td className="text-right py-2 pl-2 tabular-nums text-muted-foreground/60">{b.cohort_size}</td>
                    </tr>
                  ))}
                  {cohortMetrics.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-muted-foreground">
                        No benchmark data available for this cohort
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
