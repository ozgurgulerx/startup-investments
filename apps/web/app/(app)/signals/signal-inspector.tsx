'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { TrendingUp, TrendingDown, Activity, Users, BarChart3, Clock, ExternalLink } from 'lucide-react';
import type { SignalItem } from '@/lib/api/client';
import { timeAgo } from '@/lib/news-utils';

// ---------------------------------------------------------------------------
// Types for signal detail API response
// ---------------------------------------------------------------------------

export interface SignalEvidence {
  id: string;
  event_id: string | null;
  cluster_id: string | null;
  startup_id: string | null;
  weight: number;
  evidence_type: string;
  snippet: string | null;
  created_at: string;
  cluster_title: string | null;
  startup_name: string | null;
  startup_slug: string | null;
}

export interface SignalDetailResponse {
  signal: SignalItem | null;
  evidence: SignalEvidence[];
  related: SignalItem[];
  stage_context?: {
    adoption_by_stage: Record<string, { adopters: number; total: number; pct: number }>;
    stage_acceleration: string | null;
    computed_at: string;
  } | null;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  candidate: { bg: 'bg-muted/30', text: 'text-muted-foreground', label: 'Candidate' },
  emerging: { bg: 'bg-accent-info/10', text: 'text-accent-info', label: 'Emerging' },
  accelerating: { bg: 'bg-accent/10', text: 'text-accent', label: 'Accelerating' },
  established: { bg: 'bg-foreground/10', text: 'text-foreground', label: 'Established' },
  decaying: { bg: 'bg-destructive/10', text: 'text-destructive', label: 'Decaying' },
};

const DOMAIN_LABELS: Record<string, string> = {
  architecture: 'Architecture',
  gtm: 'GTM',
  capital: 'Capital',
  org: 'Organization',
  product: 'Product',
};

const STAGE_LABELS: Record<string, string> = {
  pre_seed: 'Pre-Seed',
  seed: 'Seed',
  series_a: 'Series A',
  series_b: 'Series B',
  series_c: 'Series C',
  series_d_plus: 'Series D+',
  late_stage: 'Late',
  unknown: 'Unknown',
};

const EVIDENCE_TYPE_LABELS: Record<string, string> = {
  news: 'News',
  cluster: 'Cluster',
  crawl_diff: 'Crawl',
  manual: 'Manual',
};

function MetricBadge({
  label,
  value,
  format,
  icon: Icon,
}: {
  label: string;
  value: number;
  format: 'percent' | 'delta';
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const displayValue = format === 'percent'
    ? `${(value * 100).toFixed(0)}%`
    : `${value >= 0 ? '+' : ''}${(value * 100).toFixed(0)}%`;

  const colorClass = format === 'delta'
    ? value > 0 ? 'text-accent-info' : value < 0 ? 'text-destructive' : 'text-muted-foreground'
    : 'text-muted-foreground';

  return (
    <div className="flex items-center gap-1.5">
      {Icon && <Icon className={`w-3 h-3 ${colorClass}`} />}
      <span className="text-[10px] text-muted-foreground/60 uppercase">{label}</span>
      <span className={`text-xs font-medium tabular-nums ${colorClass}`}>{displayValue}</span>
    </div>
  );
}

function InspectorStageBreakdown({ stageContext }: { stageContext: NonNullable<SignalDetailResponse['stage_context']> }) {
  const stages = Object.entries(stageContext.adoption_by_stage)
    .filter(([, v]) => v.total >= 2)
    .sort((a, b) => b[1].pct - a[1].pct)
    .slice(0, 5);

  if (stages.length === 0) return null;

  const maxPct = Math.max(...stages.map(([, v]) => v.pct), 1);

  return (
    <div className="space-y-1.5">
      <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
        Adoption by Stage
      </span>
      <div className="space-y-1">
        {stages.map(([stage, data]) => (
          <div key={stage} className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-16 shrink-0 truncate">
              {STAGE_LABELS[stage] || stage}
            </span>
            <div className="flex-1 h-1.5 bg-muted/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent-info/40 rounded-full"
                style={{ width: `${Math.max(2, (data.pct / maxPct) * 100)}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
              {data.pct.toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function InspectorSkeleton() {
  return (
    <div className="animate-pulse space-y-6 p-5">
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="h-5 w-20 bg-muted/30 rounded-full" />
          <div className="h-5 w-16 bg-muted/30 rounded" />
        </div>
        <div className="h-6 w-full bg-muted/30 rounded" />
        <div className="h-4 w-3/4 bg-muted/30 rounded" />
      </div>
      <div className="h-px bg-border/30" />
      <div className="grid grid-cols-2 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-8 bg-muted/30 rounded" />
        ))}
      </div>
      <div className="h-px bg-border/30" />
      <div className="space-y-2">
        <div className="h-3 w-20 bg-muted/30 rounded" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-12 bg-muted/30 rounded" />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

export function InspectorEmpty() {
  return (
    <div className="flex items-center justify-center h-full text-center p-8">
      <div>
        <BarChart3 className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground/60">Select a signal to inspect</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Inspector
// ---------------------------------------------------------------------------

interface SignalInspectorProps {
  signalId: string;
  listSignal?: SignalItem;
  allSignals?: SignalItem[];
  onSelectSignal?: (id: string) => void;
}

export function SignalInspector({ signalId, listSignal, allSignals = [], onSelectSignal }: SignalInspectorProps) {
  const [detail, setDetail] = useState<SignalDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(`/api/signals/${signalId}`)
      .then(r => r.json())
      .then((data: SignalDetailResponse) => {
        if (!cancelled) {
          setDetail(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [signalId]);

  if (loading) return <InspectorSkeleton />;

  const signal = detail?.signal || listSignal;
  if (!signal) return <InspectorEmpty />;

  const style = STATUS_STYLES[signal.status] || STATUS_STYLES.candidate;
  const domainLabel = DOMAIN_LABELS[signal.domain] || signal.domain;
  const evidence = detail?.evidence || [];
  const related = detail?.related || [];
  const stageContext = detail?.stage_context || signal.stage_context;

  return (
    <div className="p-5 space-y-6 overflow-y-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${style.bg} ${style.text}`}>
            {style.label}
          </span>
          <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
            {domainLabel}
          </span>
          <span className="text-[10px] text-muted-foreground/40 ml-auto flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            {timeAgo(signal.first_seen_at)}
          </span>
        </div>
        <h2 className="text-base font-medium text-foreground leading-snug">
          {signal.claim}
        </h2>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-3">
        <MetricBadge label="Conviction" value={signal.conviction} format="percent" />
        <MetricBadge
          label="Momentum"
          value={signal.momentum}
          format="delta"
          icon={signal.momentum > 0 ? TrendingUp : signal.momentum < 0 ? TrendingDown : Activity}
        />
        <MetricBadge label="Impact" value={signal.impact} format="percent" />
        <MetricBadge label="Velocity" value={signal.adoption_velocity} format="delta" />
      </div>

      {/* Counts */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <BarChart3 className="w-3 h-3" />
          {signal.evidence_count} evidence
        </span>
        <span className="flex items-center gap-1.5">
          <Users className="w-3 h-3" />
          {signal.unique_company_count} {signal.unique_company_count === 1 ? 'company' : 'companies'}
        </span>
      </div>

      {/* Stage Breakdown */}
      {stageContext?.adoption_by_stage && (
        <>
          <div className="h-px bg-border/20" />
          <InspectorStageBreakdown stageContext={stageContext} />
        </>
      )}

      {/* Evidence */}
      {evidence.length > 0 && (
        <>
          <div className="h-px bg-border/20" />
          <div>
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
              Recent Evidence
            </span>
            <div className="mt-2 space-y-3">
              {evidence.slice(0, 5).map(ev => (
                <div key={ev.id} className="text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-1.5 py-0.5 text-[9px] font-medium rounded bg-muted/30 text-muted-foreground">
                      {EVIDENCE_TYPE_LABELS[ev.evidence_type] || ev.evidence_type}
                    </span>
                    <span className="text-[10px] text-muted-foreground/50">
                      {timeAgo(ev.created_at)}
                    </span>
                    {ev.startup_slug && (
                      <Link
                        href={`/company/${ev.startup_slug}`}
                        className="text-[10px] text-accent-info hover:text-accent-info/80 ml-auto flex items-center gap-0.5"
                      >
                        {ev.startup_name}
                        <ExternalLink className="w-2.5 h-2.5" />
                      </Link>
                    )}
                  </div>
                  {ev.snippet && (
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {ev.snippet}
                    </p>
                  )}
                  {!ev.snippet && ev.cluster_title && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {ev.cluster_title}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Deep Dive link */}
      <div className="h-px bg-border/20" />
      <Link
        href={`/signals/${signal.id}`}
        className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-border/20 hover:border-border/40 hover:bg-muted/10 transition-colors group"
      >
        <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
          View Full Deep Dive
        </span>
        <ExternalLink className="w-3 h-3 text-muted-foreground/50 group-hover:text-accent-info transition-colors" />
      </Link>

      {/* Related Signals */}
      {related.length > 0 && (
        <>
          <div className="h-px bg-border/20" />
          <div>
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
              Related Signals
            </span>
            <div className="mt-2 space-y-2">
              {related.slice(0, 4).map(rel => {
                const relStyle = STATUS_STYLES[rel.status] || STATUS_STYLES.candidate;
                return (
                  <button
                    key={rel.id}
                    onClick={() => onSelectSignal?.(rel.id)}
                    className="w-full text-left p-2.5 rounded-lg border border-border/20 hover:border-border/40 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-1.5 py-0.5 text-[9px] font-medium rounded-full ${relStyle.bg} ${relStyle.text}`}>
                        {relStyle.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                        {(rel.conviction * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-xs text-foreground line-clamp-2">{rel.claim}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
