'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { TrendingUp, TrendingDown, Activity, Users, BarChart3, Clock, ExternalLink, ChevronRight } from 'lucide-react';
import type { SignalItem } from '@/lib/api/client';
import { timeAgo } from '@/lib/news-utils';
import { formatCurrency } from '@/lib/utils';

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

interface SignalRelevanceRound {
  funding_round_id: string;
  startup_id: string;
  startup_name: string;
  startup_slug: string | null;
  round_type: string;
  amount_usd: number | null;
  announced_date: string | null;
  lead_investor: string | null;
  occurrence_score: number;
  score: number;
  why?: string[];
}

interface SignalRelevancePattern {
  pattern: string;
  count: number;
  score: number;
  why?: string[];
  example_startups?: Array<{ slug: string; name: string }>;
}

interface SignalRelevanceRelatedSignal {
  signal: SignalItem;
  overlap_count: number;
  score?: number;
  why?: string[];
}

interface SignalRelevanceResponse {
  signal_id: string;
  region: 'global' | 'turkey';
  window_days: number;
  relevant_rounds: SignalRelevanceRound[];
  related_patterns: SignalRelevancePattern[];
  related_signals: SignalRelevanceRelatedSignal[];
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

const STATUS_LABELS_TR: Record<string, string> = {
  candidate: 'Aday',
  emerging: 'Yukselen',
  accelerating: 'Hizlanan',
  established: 'Yerlesik',
  decaying: 'Zayiflayan',
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
  event: 'Event',
  news: 'News',
  cluster: 'Cluster',
  crawl_diff: 'Crawl',
  manual: 'Manual',
};

const EVIDENCE_TYPE_LABELS_TR: Record<string, string> = {
  event: 'Olay',
  news: 'Haber',
  cluster: 'Kume',
  crawl_diff: 'Tarama',
  manual: 'Manuel',
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

export function InspectorEmpty({ region = 'global' }: { region?: 'global' | 'turkey' }) {
  const emptyLabel = region === 'turkey' ? 'Incelemek icin bir sinyal secin' : 'Select a signal to inspect';
  return (
    <div className="flex items-center justify-center h-full text-center p-8">
      <div>
        <BarChart3 className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground/60">{emptyLabel}</p>
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
  region?: 'global' | 'turkey';
}

export function SignalInspector({
  signalId,
  listSignal,
  allSignals = [],
  onSelectSignal,
  region = 'global',
}: SignalInspectorProps) {
  const isTR = region === 'turkey';
  const l = isTR
    ? {
      conviction: 'Guven',
      momentum: 'Momentum',
      impact: 'Etki',
      velocity: 'Hiz',
      evidence: 'kanit',
      company: 'sirket',
      companies: 'sirket',
      deepDive: 'Derin Inceleme',
      deepDiveMeta: 'Tam analiz · Vaka calismalari · Karsi kanitlar',
      recentEvidence: 'Son Kanitlar',
      moreEvidence: 'derin incelemede daha fazla kanit',
      relatedSignals: 'Ilgili Sinyaller',
      relevance: 'Ilgi',
      relevantRounds: 'Ilgili Turlar',
      relatedPatterns: 'Ilgili Patternler',
    }
    : {
      conviction: 'Conviction',
      momentum: 'Momentum',
      impact: 'Impact',
      velocity: 'Velocity',
      evidence: 'evidence',
      company: 'company',
      companies: 'companies',
      deepDive: 'Deep Dive',
      deepDiveMeta: 'Full analysis · Case studies · Counterevidence',
      recentEvidence: 'Recent Evidence',
      moreEvidence: 'more evidence items in deep dive',
      relatedSignals: 'Related Signals',
      relevance: 'Relevance',
      relevantRounds: 'Relevant Rounds',
      relatedPatterns: 'Related Patterns',
    };
  const [detail, setDetail] = useState<SignalDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [relevance, setRelevance] = useState<SignalRelevanceResponse | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    params.set('window_days', '90');
    params.set('limit', '8');
    if (region) params.set('region', region);

    fetch(`/api/signals/${signalId}/relevance?${params.toString()}`)
      .then(r => r.json())
      .then((data: SignalRelevanceResponse) => {
        if (!cancelled) {
          setRelevance(data && typeof data === 'object' ? data : null);
        }
      })
      .catch(() => {
        if (!cancelled) setRelevance(null);
      });

    return () => { cancelled = true; };
  }, [signalId, region]);

  if (loading) return <InspectorSkeleton />;

  const signal = detail?.signal || listSignal;
  if (!signal) return <InspectorEmpty region={region} />;

  const style = STATUS_STYLES[signal.status] || STATUS_STYLES.candidate;
  const domainLabel = (isTR
    ? { architecture: 'Mimari', gtm: 'GTM', capital: 'Sermaye', org: 'Organizasyon', product: 'Urun' }
    : DOMAIN_LABELS)[signal.domain] || signal.domain;
  const evidence = detail?.evidence || [];
  const relatedFromRelevance = relevance?.related_signals?.map((r) => r.signal).filter(Boolean) || [];
  const related = relatedFromRelevance.length > 0 ? relatedFromRelevance : (detail?.related || []);
  const stageContext = detail?.stage_context || signal.stage_context;
  const regionQS = region !== 'global' ? `?region=${encodeURIComponent(region)}` : '';

  return (
    <div className="p-5 space-y-6 overflow-y-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${style.bg} ${style.text}`}>
            {isTR ? (STATUS_LABELS_TR[signal.status] || style.label) : style.label}
          </span>
          <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
            {domainLabel}
          </span>
          <span className="text-[10px] text-muted-foreground/40 ml-auto flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            {timeAgo(signal.first_seen_at, region)}
          </span>
        </div>
        <h2 className="text-base font-medium text-foreground leading-snug">
          {signal.claim}
        </h2>
        {signal.explain?.definition && (
          <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1.5 line-clamp-2">
            {signal.explain.definition}
          </p>
        )}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-3">
        <MetricBadge label={l.conviction} value={signal.conviction} format="percent" />
        <MetricBadge
          label={l.momentum}
          value={signal.momentum}
          format="delta"
          icon={signal.momentum > 0 ? TrendingUp : signal.momentum < 0 ? TrendingDown : Activity}
        />
        <MetricBadge label={l.impact} value={signal.impact} format="percent" />
        <MetricBadge label={l.velocity} value={signal.adoption_velocity} format="delta" />
      </div>

      {/* Counts */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <BarChart3 className="w-3 h-3" />
          {signal.evidence_count} {l.evidence}
        </span>
        <span className="flex items-center gap-1.5">
          <Users className="w-3 h-3" />
          {signal.unique_company_count} {signal.unique_company_count === 1 ? l.company : l.companies}
        </span>
      </div>

      {/* Deep Dive CTA */}
      <Link
        href={`/signals/${signal.id}${regionQS}`}
        className="flex items-center gap-3 px-3 py-3 rounded-lg border border-border/30 hover:border-accent-info/30 hover:bg-muted/10 transition-colors group"
      >
        <div className="flex-1 min-w-0">
          <span className="text-sm text-foreground block">{l.deepDive}</span>
          <span className="text-[10px] text-muted-foreground/60 block mt-0.5">
            {l.deepDiveMeta}
          </span>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-accent-info transition-colors shrink-0" />
      </Link>

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
              {l.recentEvidence}
            </span>
            <div className="mt-2 space-y-3">
              {evidence.slice(0, 3).map(ev => (
                <div key={ev.id} className="text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-1.5 py-0.5 text-[9px] font-medium rounded bg-muted/30 text-muted-foreground">
                      {(isTR ? EVIDENCE_TYPE_LABELS_TR : EVIDENCE_TYPE_LABELS)[ev.evidence_type] || ev.evidence_type}
                    </span>
                    <span className="text-[10px] text-muted-foreground/50">
                      {timeAgo(ev.created_at, region)}
                    </span>
                    {ev.startup_slug && (
                      <Link
                        href={`/company/${ev.startup_slug}${regionQS}`}
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
              {evidence.length > 3 && (
                <p className="text-[10px] text-muted-foreground/50 pt-1">
                  {evidence.length - 3} {l.moreEvidence}
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {/* Relevance bundle */}
      {(relevance?.relevant_rounds?.length || relevance?.related_patterns?.length) && (
        <>
          <div className="h-px bg-border/20" />
          <div className="space-y-3">
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
              {l.relevance}
            </span>

            {relevance?.relevant_rounds?.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50">
                  {l.relevantRounds}
                </p>
                <div className="space-y-2">
                  {relevance.relevant_rounds.slice(0, 3).map((r) => (
                    <div
                      key={r.funding_round_id}
                      className="p-2.5 rounded-lg border border-border/20 hover:border-border/40 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        {r.startup_slug ? (
                          <Link
                            href={`/company/${r.startup_slug}${regionQS}`}
                            className="text-xs text-foreground hover:text-accent-info transition-colors font-medium truncate"
                          >
                            {r.startup_name}
                          </Link>
                        ) : (
                          <span className="text-xs text-foreground font-medium truncate">{r.startup_name}</span>
                        )}
                        <span className="text-[10px] text-muted-foreground/50 ml-auto tabular-nums">
                          {r.announced_date ? timeAgo(r.announced_date, region) : ''}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground/70">
                        <span className="uppercase tracking-wider">{r.round_type}</span>
                        {r.amount_usd != null && r.amount_usd > 0 && (
                          <>
                            <span className="text-muted-foreground/40">·</span>
                            <span className="tabular-nums">{formatCurrency(r.amount_usd, true)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {relevance?.related_patterns?.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50">
                  {l.relatedPatterns}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {relevance.related_patterns.slice(0, 6).map((p) => {
                    const href = region !== 'global'
                      ? `/dealbook?region=${encodeURIComponent(region)}&pattern=${encodeURIComponent(p.pattern)}`
                      : `/dealbook?pattern=${encodeURIComponent(p.pattern)}`;
                    return (
                      <Link
                        key={p.pattern}
                        href={href}
                        className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-accent-info/25 bg-accent-info/10 text-accent-info hover:bg-accent-info/15 transition-colors"
                      >
                        {p.pattern}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Related Signals */}
      {related.length > 0 && (
        <>
          <div className="h-px bg-border/20" />
          <div>
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
              {l.relatedSignals}
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
                        {isTR ? (STATUS_LABELS_TR[rel.status] || relStyle.label) : relStyle.label}
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
