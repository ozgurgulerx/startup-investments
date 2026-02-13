'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Users, ArrowRight, Lightbulb, ExternalLink, Sparkles, TrendingUp, TrendingDown, Activity, BarChart3, Clock, ChevronRight, Info, Bell, X } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { PatternCohortTable } from '@/components/features/pattern-cohort-table';
import { SectorFilter } from '@/components/features/sector-filter';
import { CoOccurrenceMatrix } from '@/components/charts/co-occurrence-matrix';
import { Sheet, SheetHeader, SheetContent } from '@/components/ui/sheet';
import { useIsDesktop } from '@/lib/hooks/use-media-query';
import { cn } from '@/lib/utils';
import { SignalInspector, InspectorSkeleton, InspectorEmpty } from './signal-inspector';
import { ExplainPopover } from './explain-popover';
import { EvidenceDrawer } from './evidence-drawer';
import type { PatternData, EmergingPattern, CategoryData } from './page';
import type { PatternCorrelation } from '@/lib/data/signals';
import type { SignalItem, SignalsSummaryResponse, SignalsListResponse } from '@/lib/api/client';
import type { StartupAnalysis } from '@startup-intelligence/shared';
import { normalizeDatasetRegion } from '@/lib/region';
import { trackEvent } from '@/lib/posthog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StaticModeProps {
  mode: 'static';
  patterns: PatternData[];
  correlations: PatternCorrelation[];
  totalDeals: number;
  region?: string;
  emergingPatterns?: EmergingPattern[];
  categories?: CategoryData[];
  fallbackReason?: 'api_empty' | 'api_error';
}

interface DynamicModeProps {
  mode: 'dynamic';
  dynamicSignals: SignalsSummaryResponse;
  region?: string;
}

type InteractiveSignalsProps = StaticModeProps | DynamicModeProps;

interface SignalRecommendation {
  signal: SignalItem;
  overlap_count: number;
  reason: string;
  reason_type?: 'watchlist_overlap' | 'graph_investor_overlap' | 'memory_momentum' | 'high_impact_fallback';
}

interface SignalRecommendationsResponse {
  request_id?: string;
  algorithm_version?: string;
  recommendations?: SignalRecommendation[];
}

interface RecommendationFollowContext {
  source: 'signal_list' | 'recommendation';
  recommendation_request_id?: string;
  recommendation_position?: number;
  recommendation_reason_type?: string;
  recommendation_algorithm_version?: string;
}

type RecommendationFeedbackType = 'not_relevant' | 'more_like_this' | 'less_from_domain';

// ---------------------------------------------------------------------------
// Constants
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

const DOMAIN_LABELS_TR: Record<string, string> = {
  architecture: 'Mimari',
  gtm: 'GTM',
  capital: 'Sermaye',
  org: 'Organizasyon',
  product: 'Urun',
};

const STATUS_ORDER = ['accelerating', 'emerging', 'candidate', 'established', 'decaying'] as const;
const RECOMMENDATION_ALGO_FALLBACK = 'signals_v2_graph_memory';
const RECOMMENDATION_SURFACE = 'signals';

const SORT_OPTIONS = [
  { value: 'momentum', label: 'Momentum' },
  { value: 'conviction', label: 'Conviction' },
  { value: 'impact', label: 'Impact' },
  { value: 'created', label: 'Newest' },
] as const;

const SORT_OPTIONS_TR = [
  { value: 'momentum', label: 'Momentum' },
  { value: 'conviction', label: 'Guven' },
  { value: 'impact', label: 'Etki' },
  { value: 'created', label: 'En yeni' },
] as const;

type SortKey = typeof SORT_OPTIONS[number]['value'];

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

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

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
    <div className="flex items-center gap-1">
      {Icon && <Icon className={`w-3 h-3 ${colorClass}`} />}
      <span className="text-[10px] text-muted-foreground/60 uppercase">{label}</span>
      <span className={`text-xs font-medium ${colorClass}`}>{displayValue}</span>
    </div>
  );
}

function StageBreakdown({ signal }: { signal: SignalItem }) {
  const ctx = signal.stage_context;
  if (!ctx?.adoption_by_stage) return null;

  const stages = Object.entries(ctx.adoption_by_stage)
    .filter(([, v]) => v.total >= 2)
    .sort((a, b) => b[1].pct - a[1].pct)
    .slice(0, 4);

  if (stages.length === 0) return null;

  const maxPct = Math.max(...stages.map(([, v]) => v.pct), 1);

  return (
    <div className="mt-3 pt-3 border-t border-border/20">
      <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
        Adoption by Stage
      </span>
      <div className="mt-1.5 space-y-1">
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
// Follow button (auth-gated)
// ---------------------------------------------------------------------------

function FollowButton({
  signalId,
  isFollowing,
  onToggle,
  isAuthenticated,
  isTR,
}: {
  signalId: string;
  isFollowing: boolean;
  onToggle: (id: string) => void;
  isAuthenticated: boolean;
  isTR: boolean;
}) {
  const l = isTR
    ? { signIn: 'Takip etmek icin giris yapin', unfollow: 'Sinyali takipten cik', follow: 'Sinyali takip et' }
    : { signIn: 'Sign in to follow', unfollow: 'Unfollow signal', follow: 'Follow signal' };
  if (!isAuthenticated) {
    return (
      <button
        className="p-1 rounded hover:bg-muted/30 transition-colors"
        aria-label={l.signIn}
        title={l.signIn}
        disabled
      >
        <Bell className="w-3.5 h-3.5 text-muted-foreground/30" />
      </button>
    );
  }

  return (
    <button
      onClick={() => onToggle(signalId)}
      className="p-1 rounded hover:bg-muted/30 transition-colors"
      aria-label={isFollowing ? l.unfollow : l.follow}
    >
      {isFollowing ? (
        <Bell className="w-3.5 h-3.5 text-accent-info fill-accent-info/30" />
      ) : (
        <Bell className="w-3.5 h-3.5 text-muted-foreground/50 hover:text-muted-foreground" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Notification pill
// ---------------------------------------------------------------------------

function NotificationPill({
  count,
  onDismiss,
  isTR,
}: {
  count: number;
  onDismiss: () => void;
  isTR: boolean;
}) {
  if (count <= 0) return null;
  return (
    <button
      onClick={onDismiss}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-full bg-accent-info/10 text-accent-info border border-accent-info/25 animate-in fade-in-0 duration-300 hover:bg-accent-info/15 transition-colors"
      aria-label={isTR ? 'Yeni sinyal bildirimini kapat' : 'Dismiss new signals notification'}
    >
      {count} {isTR ? 'yeni' : 'new'}
      <X className="w-3 h-3" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Sparkline (raw SVG, no library)
// ---------------------------------------------------------------------------

function Sparkline({ data, meta }: { data: number[]; meta?: { timeline_start: string; timeline_end: string } }) {
  const max = Math.max(...data, 1);
  const points = data.map((v, i) => `${i * 8},${16 - (v / max) * 14}`).join(' ');
  const tooltip = meta?.timeline_start && meta?.timeline_end
    ? `Evidence trend: ${meta.timeline_start} — ${meta.timeline_end}`
    : 'Evidence trend (30 days)';
  return (
    <svg viewBox="0 0 56 16" className="w-14 h-4" aria-label={tooltip} role="img">
      <title>{tooltip}</title>
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-accent-info/60"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Compact signal card for the list pane
// ---------------------------------------------------------------------------

function SignalCard({
  signal,
  selected,
  onSelect,
  onOpenEvidence,
  isFollowing,
  onToggleFollow,
  isAuthenticated,
  isTR,
}: {
  signal: SignalItem;
  selected: boolean;
  onSelect: (id: string) => void;
  onOpenEvidence?: (id: string) => void;
  isFollowing?: boolean;
  onToggleFollow?: (id: string) => void;
  isAuthenticated?: boolean;
  isTR: boolean;
}) {
  const style = STATUS_STYLES[signal.status] || STATUS_STYLES.candidate;
  const domainLabel = (isTR ? DOMAIN_LABELS_TR : DOMAIN_LABELS)[signal.domain] || signal.domain;
  const statusLabel = isTR ? (STATUS_LABELS_TR[signal.status] || style.label) : style.label;

  const timeSinceFirstSeen = useMemo(() => {
    const first = new Date(signal.first_seen_at);
    const now = new Date();
    const days = Math.floor((now.getTime() - first.getTime()) / (1000 * 60 * 60 * 24));
    if (days === 0) return isTR ? 'bugun' : 'today';
    if (days === 1) return isTR ? '1g once' : '1d ago';
    if (days < 30) return isTR ? `${days}g once` : `${days}d ago`;
    return isTR ? `${Math.floor(days / 30)}ay once` : `${Math.floor(days / 30)}mo ago`;
  }, [signal.first_seen_at, isTR]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(signal.id)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSelect(signal.id); }}
      className={cn(
        'w-full text-left px-4 py-3.5 transition-colors border-b border-border/20 last:border-0 cursor-pointer',
        'hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-info/50',
        selected && 'bg-muted/30 border-l-2 border-l-accent-info'
      )}
    >
      {/* Top row */}
      <div className="flex items-center gap-2 mb-2">
        <span className={`px-1.5 py-0.5 text-[9px] font-medium rounded-full ${style.bg} ${style.text}`}>
          {statusLabel}
        </span>
        <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">
          {domainLabel}
        </span>
        {signal.evidence_timeline && signal.evidence_timeline.length > 0 && (
          <Sparkline data={signal.evidence_timeline} meta={signal.evidence_timeline_meta} />
        )}
        <span className="text-[9px] text-muted-foreground/40 ml-auto flex items-center gap-0.5">
          <Clock className="w-2.5 h-2.5" />
          {timeSinceFirstSeen}
        </span>
      </div>

      {/* Claim */}
      <p className="text-sm text-foreground leading-snug mb-2 line-clamp-2">
        {signal.claim}
      </p>

      {/* Metrics + action icons */}
      <div className="flex items-center gap-3">
        <MetricBadge label={isTR ? 'Guv' : 'Conv'} value={signal.conviction} format="percent" />
        <MetricBadge
          label={isTR ? 'Mom' : 'Mom'}
          value={signal.momentum}
          format="delta"
          icon={signal.momentum > 0 ? TrendingUp : signal.momentum < 0 ? TrendingDown : undefined}
        />
        <div className="flex items-center gap-1 ml-auto" onClick={e => e.stopPropagation()}>
          {signal.explain && (
            <ExplainPopover explain={signal.explain} region={isTR ? 'turkey' : 'global'} />
          )}
          <Link
            href={`/signals/${signal.id}`}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground/60 hover:text-accent-info hover:bg-muted/20 transition-colors"
          >
            {isTR ? 'Derin inceleme' : 'Deep dive'} <ChevronRight className="w-3 h-3" />
          </Link>
          {onOpenEvidence && (
            <button
              onClick={() => onOpenEvidence(signal.id)}
              className="p-1 rounded hover:bg-muted/30 transition-colors"
              aria-label={isTR ? 'Kanitlari gor' : 'View evidence'}
            >
              <BarChart3 className="w-3.5 h-3.5 text-muted-foreground/50 hover:text-muted-foreground" />
            </button>
          )}
          {onToggleFollow && (
            <FollowButton
              signalId={signal.id}
              isFollowing={!!isFollowing}
              onToggle={onToggleFollow}
              isAuthenticated={!!isAuthenticated}
              isTR={isTR}
            />
          )}
          <span className="text-[10px] text-muted-foreground/40 tabular-nums ml-1">
            {signal.evidence_count}
          </span>
        </div>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 hidden lg:block" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter bar (pill buttons)
// ---------------------------------------------------------------------------

function PillButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-2.5 py-1 text-[11px] rounded-full transition-colors whitespace-nowrap',
        active
          ? 'bg-accent-info/10 text-accent-info border border-accent-info/25'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/25 border border-transparent'
      )}
    >
      {children}
    </button>
  );
}

function FilterBar({
  sort,
  onSortChange,
  domain,
  onDomainChange,
  status,
  onStatusChange,
  stats,
  isTR,
}: {
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  domain: string | null;
  onDomainChange: (d: string | null) => void;
  status: string | null;
  onStatusChange: (s: string | null) => void;
  stats: SignalsSummaryResponse['stats'];
  isTR: boolean;
}) {
  const sortOptions = isTR ? SORT_OPTIONS_TR : SORT_OPTIONS;
  const domainLabels = isTR ? DOMAIN_LABELS_TR : DOMAIN_LABELS;
  return (
    <div className="space-y-3 pb-4 border-b border-border/30">
      {/* Sort */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider w-10 shrink-0">{isTR ? 'Sirala' : 'Sort'}</span>
        <div className="flex flex-wrap gap-1">
          {sortOptions.map(opt => (
            <PillButton key={opt.value} active={sort === opt.value} onClick={() => onSortChange(opt.value)}>
              {opt.label}
            </PillButton>
          ))}
        </div>
      </div>

      {/* Domain */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider w-10 shrink-0">{isTR ? 'Odak' : 'Lens'}</span>
        <div className="flex flex-wrap gap-1">
          <PillButton active={domain === null} onClick={() => onDomainChange(null)}>{isTR ? 'Tum' : 'All'}</PillButton>
          {Object.entries(domainLabels).map(([key, label]) => (
            <PillButton key={key} active={domain === key} onClick={() => onDomainChange(key)}>
              {label}
              {stats.by_domain[key] != null && (
                <span className="ml-1 opacity-50">{stats.by_domain[key]}</span>
              )}
            </PillButton>
          ))}
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider w-10 shrink-0">{isTR ? 'Durum' : 'State'}</span>
        <div className="flex flex-wrap gap-1">
          <PillButton active={status === null} onClick={() => onStatusChange(null)}>{isTR ? 'Tum' : 'All'}</PillButton>
          {STATUS_ORDER.map(s => {
            const st = STATUS_STYLES[s];
            const label = isTR ? (STATUS_LABELS_TR[s] || st.label) : st.label;
            return (
              <PillButton key={s} active={status === s} onClick={() => onStatusChange(s)}>
                {label}
                {stats.by_status[s] != null && (
                  <span className="ml-1 opacity-50">{stats.by_status[s]}</span>
                )}
              </PillButton>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List skeleton
// ---------------------------------------------------------------------------

function ListSkeleton() {
  return (
    <div className="animate-pulse">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="px-4 py-4 border-b border-border/20">
          <div className="flex gap-2 mb-2">
            <div className="h-4 w-16 bg-muted/30 rounded-full" />
            <div className="h-4 w-12 bg-muted/30 rounded" />
          </div>
          <div className="h-4 w-full bg-muted/30 rounded mb-1" />
          <div className="h-4 w-3/4 bg-muted/30 rounded mb-2" />
          <div className="flex gap-3">
            <div className="h-3 w-16 bg-muted/30 rounded" />
            <div className="h-3 w-16 bg-muted/30 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function getRecommendationReasonTag(params: {
  reasonType?: SignalRecommendation['reason_type'];
  overlapCount?: number;
  isTR: boolean;
}): string {
  if (params.reasonType === 'watchlist_overlap') {
    const overlap = Number(params.overlapCount || 0);
    if (overlap > 0) {
      return params.isTR
        ? `Izleme listenle eslesme (${overlap})`
        : `Watchlist match (${overlap})`;
    }
    return params.isTR ? 'Izleme listene benzer' : 'Watchlist-adjacent';
  }
  if (params.reasonType === 'high_impact_fallback') {
    return params.isTR ? 'Bolgende yuksek etki' : 'High impact in your region';
  }
  if (params.reasonType === 'graph_investor_overlap') {
    return params.isTR ? 'Yatirimci grafi eslesmesi' : 'Investor graph match';
  }
  if (params.reasonType === 'memory_momentum') {
    return params.isTR ? 'Hafiza momentumu' : 'Memory momentum';
  }
  return params.isTR ? 'Senin icin onerildi' : 'Recommended for you';
}

// ---------------------------------------------------------------------------
// Dynamic signals view — two-pane layout
// ---------------------------------------------------------------------------

function DynamicSignalsView({ dynamicSignals, region }: { dynamicSignals: SignalsSummaryResponse; region?: string }) {
  const isTR = normalizeDatasetRegion(region) === 'turkey';
  const l = isTR
    ? {
      title: 'Sinyal Istihbarati',
      headline: 'AI altyapisinda canli pattern benimseme sinyalleri',
      tracked: 'aktif sinyal izleniyor',
      domains: 'alan',
      rising: 'sinyal yukseliste',
      recommended: 'Takip onerileri',
      whyForYou: 'Neden senin icin',
      loadingRecommendations: 'Oneriler yukleniyor...',
      notRelevant: 'Ilgili degil',
      moreLikeThis: 'Buna benzer daha fazla',
      lessFromDomain: 'Bu alandan daha az',
      noMatches: 'Filtrelere uyan sinyal yok',
      signalDetail: 'Sinyal Detayi',
    }
    : {
      title: 'Signal Intelligence',
      headline: 'Live pattern adoption signals across AI infrastructure',
      tracked: 'active signals tracked across',
      domains: 'domains',
      rising: 'signals rising',
      recommended: 'Recommended to Follow',
      whyForYou: 'Why this for you',
      loadingRecommendations: 'Loading recommendations...',
      notRelevant: 'Not relevant',
      moreLikeThis: 'More like this',
      lessFromDomain: 'Less from this domain',
      noMatches: 'No signals match your filters',
      signalDetail: 'Signal Detail',
    };
  const isDesktop = useIsDesktop();
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user?.id;
  const { stats } = dynamicSignals;
  const searchParams = useSearchParams();
  const router = useRouter();

  // URL-persisted selection (2.1)
  const selectedId = searchParams.get('id');

  // Build initial flat list from summary (all three arrays)
  const initialSignals = useMemo(() => {
    const all = [...dynamicSignals.rising, ...dynamicSignals.established, ...dynamicSignals.decaying];
    // Dedupe by id
    const seen = new Set<string>();
    return all.filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
  }, [dynamicSignals]);

  // Filter / sort state
  const [sort, setSort] = useState<SortKey>('momentum');
  const [domain, setDomain] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [sector, setSector] = useState<string | null>(null);

  // Fetched signals (null = using initial data)
  const [fetchedSignals, setFetchedSignals] = useState<SignalItem[] | null>(null);
  const [listLoading, setListLoading] = useState(false);

  // Mobile sheet
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  // Evidence drawer
  const [evidenceDrawerSignalId, setEvidenceDrawerSignalId] = useState<string | null>(null);

  // Follow state
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());

  // Notification state
  const [newCount, setNewCount] = useState(0);
  const [recommendations, setRecommendations] = useState<SignalRecommendation[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [recommendationRequestId, setRecommendationRequestId] = useState<string | null>(null);
  const [recommendationAlgorithmVersion, setRecommendationAlgorithmVersion] = useState<string>(RECOMMENDATION_ALGO_FALLBACK);
  const [hiddenRecommendationIds, setHiddenRecommendationIds] = useState<Set<string>>(new Set());
  const [domainRecommendationWeights, setDomainRecommendationWeights] = useState<Record<string, number>>({});
  const trackedRecommendationListViewsRef = useRef<Set<string>>(new Set());
  const trackedRecommendationImpressionsRef = useRef<Set<string>>(new Set());

  // Fetch user follows on mount (auth-gated)
  useEffect(() => {
    if (!isAuthenticated) return;
    fetch('/api/signals/follows')
      .then(r => r.json())
      .then(data => {
        if (data.signal_ids) setFollowedIds(new Set(data.signal_ids));
      })
      .catch(() => {});
  }, [isAuthenticated]);

  // Fetch "new since last visit" count (auth-gated, no auto-mark-seen)
  useEffect(() => {
    if (!isAuthenticated || !session?.user) return;
    const lastSeen = (session.user as any).last_seen_signals_at;
    if (!lastSeen) return;

    const params = new URLSearchParams({ since: lastSeen });
    if (region) params.set('region', region);

    fetch(`/api/signals/updates?${params.toString()}`)
      .then(r => r.json())
      .then(data => {
        if (data.new_count) setNewCount(data.new_count);
      })
      .catch(() => {});
  }, [isAuthenticated, session, region]);

  // Fetch recommended follows (auth-gated)
  useEffect(() => {
    let cancelled = false;
    if (!isAuthenticated) {
      setRecommendations([]);
      setRecommendationRequestId(null);
      setRecommendationAlgorithmVersion(RECOMMENDATION_ALGO_FALLBACK);
      return;
    }

    const params = new URLSearchParams({ limit: '6' });
    if (region) params.set('region', region);

    setRecommendationsLoading(true);
    fetch(`/api/signals/recommendations?${params.toString()}`)
      .then(r => r.json())
      .then((data: SignalRecommendationsResponse) => {
        if (cancelled) return;
        setRecommendations(Array.isArray(data.recommendations) ? data.recommendations : []);
        setRecommendationRequestId(typeof data.request_id === 'string' && data.request_id ? data.request_id : null);
        setRecommendationAlgorithmVersion(
          typeof data.algorithm_version === 'string' && data.algorithm_version
            ? data.algorithm_version
            : RECOMMENDATION_ALGO_FALLBACK,
        );
        setRecommendationsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setRecommendations([]);
        setRecommendationRequestId(null);
        setRecommendationAlgorithmVersion(RECOMMENDATION_ALGO_FALLBACK);
        setRecommendationsLoading(false);
      });

    return () => { cancelled = true; };
  }, [isAuthenticated, region]);

  const handleToggleFollow = useCallback((signalId: string, context?: RecommendationFollowContext) => {
    const wasFollowing = followedIds.has(signalId);
    const interactionSource = context?.source || 'signal_list';

    // Optimistic update
    setFollowedIds(prev => {
      const next = new Set(prev);
      if (next.has(signalId)) next.delete(signalId);
      else next.add(signalId);
      return next;
    });

    fetch(`/api/signals/${signalId}/follow`, { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        // Reconcile with server state
        setFollowedIds(prev => {
          const next = new Set(prev);
          if (data.following) next.add(signalId);
          else next.delete(signalId);
          return next;
        });
        if (data.following) {
          setRecommendations(prev => prev.filter(rec => rec.signal.id !== signalId));
        }
        trackEvent('signal_follow_toggle', {
          signal_id: signalId,
          following: !!data.following,
          previous_following: wasFollowing,
          region: region || 'global',
          source: interactionSource,
          recommendation_request_id: context?.recommendation_request_id,
          recommendation_position: context?.recommendation_position,
          recommendation_reason_type: context?.recommendation_reason_type,
          recommendation_algorithm_version: context?.recommendation_algorithm_version,
        });

        if (data.following && interactionSource === 'recommendation') {
          trackEvent('reco_item_followed', {
            surface: RECOMMENDATION_SURFACE,
            region: region || 'global',
            item_type: 'signal',
            item_id: signalId,
            position: context?.recommendation_position,
            reason_type: context?.recommendation_reason_type || 'watchlist_overlap',
            request_id: context?.recommendation_request_id || recommendationRequestId || 'unknown',
            algorithm_version: context?.recommendation_algorithm_version || recommendationAlgorithmVersion,
            is_authenticated: true,
          });
        }
      })
      .catch(() => {
        // Revert on error
        setFollowedIds(prev => {
          const next = new Set(prev);
          if (next.has(signalId)) next.delete(signalId);
          else next.add(signalId);
          return next;
        });
        trackEvent('signal_follow_toggle_failed', {
          signal_id: signalId,
          previous_following: wasFollowing,
          region: region || 'global',
          source: interactionSource,
          recommendation_request_id: context?.recommendation_request_id,
          recommendation_position: context?.recommendation_position,
          recommendation_reason_type: context?.recommendation_reason_type,
          recommendation_algorithm_version: context?.recommendation_algorithm_version,
        });
      });
  }, [followedIds, region, recommendationRequestId, recommendationAlgorithmVersion]);

  const handleDismissNew = useCallback(() => {
    fetch('/api/signals/seen', { method: 'PATCH' }).catch(() => {});
    trackEvent('signals_new_dismiss', {
      new_count: newCount,
      region: region || 'global',
    });
    setNewCount(0);
  }, [newCount, region]);

  // Determine if we need to re-fetch (filters changed from default)
  const isDefaultFilters = sort === 'momentum' && domain === null && status === null && sector === null;

  // Fetch signals when filters change
  useEffect(() => {
    if (isDefaultFilters) {
      setFetchedSignals(null);
      return;
    }

    let cancelled = false;
    setListLoading(true);

    const params = new URLSearchParams();
    if (region) params.set('region', region);
    if (domain) params.set('domain', domain);
    if (status) params.set('status', status);
    if (sector) params.set('sector', sector);
    params.set('sort', sort);
    params.set('limit', '50');

    fetch(`/api/signals?${params.toString()}`)
      .then(r => r.json())
      .then((data: SignalsListResponse) => {
        if (!cancelled) {
          setFetchedSignals(data.signals);
          setListLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setListLoading(false);
      });

    return () => { cancelled = true; };
  }, [sort, domain, status, sector, region, isDefaultFilters]);

  // Current signals list (use fetched or initial)
  const signals = fetchedSignals || initialSignals;

  // Evidence drawer signal lookup (must come after signals is defined)
  const evidenceDrawerSignal = useMemo(
    () => evidenceDrawerSignalId ? signals.find(s => s.id === evidenceDrawerSignalId) : undefined,
    [evidenceDrawerSignalId, signals]
  );

  // Group signals by status for the list sections
  const groupedSignals = useMemo(() => {
    const groups: Record<string, SignalItem[]> = {};
    for (const s of signals) {
      if (!groups[s.status]) groups[s.status] = [];
      groups[s.status].push(s);
    }
    return groups;
  }, [signals]);

  // Ordered status sections to display
  const visibleSections = useMemo(() => {
    return STATUS_ORDER.filter(s => groupedSignals[s]?.length);
  }, [groupedSignals]);

  // Auto-select first signal only when no ?id= param present
  useEffect(() => {
    if (signals.length > 0 && (!selectedId || !signals.find(s => s.id === selectedId))) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('id', signals[0].id);
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [signals, selectedId, searchParams, router]);

  const handleSelectSignal = useCallback((id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('id', id);
    router.replace(`?${params.toString()}`, { scroll: false });
    if (!isDesktop) setMobileSheetOpen(true);
  }, [searchParams, router, isDesktop]);

  const selectedSignal = useMemo(
    () => signals.find(s => s.id === selectedId),
    [signals, selectedId]
  );

  const visibleRecommendations = useMemo(
    () => recommendations
      .filter(rec => !followedIds.has(rec.signal.id) && !hiddenRecommendationIds.has(rec.signal.id))
      .sort((a, b) => {
        const weightA = domainRecommendationWeights[a.signal.domain] || 0;
        const weightB = domainRecommendationWeights[b.signal.domain] || 0;
        if (weightA !== weightB) return weightB - weightA;
        return (b.overlap_count || 0) - (a.overlap_count || 0);
      }),
    [recommendations, followedIds, hiddenRecommendationIds, domainRecommendationWeights]
  );
  const displayedRecommendations = useMemo(
    () => visibleRecommendations.slice(0, 4),
    [visibleRecommendations]
  );

  useEffect(() => {
    if (!isAuthenticated || recommendationsLoading || displayedRecommendations.length === 0) return;

    const requestId = recommendationRequestId || 'unknown';
    const algorithmVersion = recommendationAlgorithmVersion || RECOMMENDATION_ALGO_FALLBACK;

    if (!trackedRecommendationListViewsRef.current.has(requestId)) {
      trackedRecommendationListViewsRef.current.add(requestId);
      trackEvent('reco_list_viewed', {
        surface: RECOMMENDATION_SURFACE,
        region: region || 'global',
        algorithm_version: algorithmVersion,
        request_id: requestId,
        item_count: displayedRecommendations.length,
        is_authenticated: true,
      });
    }

    displayedRecommendations.forEach((rec, index) => {
      const impressionKey = `${requestId}:${rec.signal.id}`;
      if (trackedRecommendationImpressionsRef.current.has(impressionKey)) return;
      trackedRecommendationImpressionsRef.current.add(impressionKey);
      trackEvent('reco_item_impression', {
        surface: RECOMMENDATION_SURFACE,
        region: region || 'global',
        item_type: 'signal',
        item_id: rec.signal.id,
        position: index + 1,
        reason_type: rec.reason_type || 'watchlist_overlap',
        algorithm_version: algorithmVersion,
        request_id: requestId,
        is_authenticated: true,
      });
    });
  }, [
    isAuthenticated,
    recommendationsLoading,
    displayedRecommendations,
    recommendationRequestId,
    recommendationAlgorithmVersion,
    region,
  ]);

  const handleRecommendationClick = useCallback((rec: SignalRecommendation, position: number) => {
    const requestId = recommendationRequestId || 'unknown';
    const algorithmVersion = recommendationAlgorithmVersion || RECOMMENDATION_ALGO_FALLBACK;

    trackEvent('reco_item_clicked', {
      surface: RECOMMENDATION_SURFACE,
      region: region || 'global',
      item_type: 'signal',
      item_id: rec.signal.id,
      position,
      reason_type: rec.reason_type || 'watchlist_overlap',
      algorithm_version: algorithmVersion,
      request_id: requestId,
      is_authenticated: true,
    });

    handleSelectSignal(rec.signal.id);
  }, [handleSelectSignal, recommendationRequestId, recommendationAlgorithmVersion, region]);

  const handleRecommendationFeedback = useCallback((
    rec: SignalRecommendation,
    position: number,
    feedbackType: RecommendationFeedbackType,
  ) => {
    const requestId = recommendationRequestId || 'unknown';
    const algorithmVersion = recommendationAlgorithmVersion || RECOMMENDATION_ALGO_FALLBACK;

    trackEvent('reco_feedback_submitted', {
      surface: RECOMMENDATION_SURFACE,
      region: region || 'global',
      item_type: 'signal',
      item_id: rec.signal.id,
      position,
      reason_type: rec.reason_type || 'watchlist_overlap',
      feedback_type: feedbackType,
      request_id: requestId,
      algorithm_version: algorithmVersion,
      is_authenticated: true,
    });

    // Best-effort persistence (server-side auth + API key); UI remains responsive even if this fails.
    void fetch('/api/signals/recommendations/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feedback_type: feedbackType,
        signal_id: rec.signal.id,
        domain: rec.signal.domain,
        region: region || 'global',
        position,
        reason_type: rec.reason_type || 'watchlist_overlap',
        request_id: requestId,
        algorithm_version: algorithmVersion,
      }),
    }).catch(() => null);

    if (feedbackType === 'not_relevant') {
      setHiddenRecommendationIds(prev => {
        const next = new Set(prev);
        next.add(rec.signal.id);
        return next;
      });
      trackEvent('reco_item_dismissed', {
        surface: RECOMMENDATION_SURFACE,
        region: region || 'global',
        item_type: 'signal',
        item_id: rec.signal.id,
        position,
        reason_type: rec.reason_type || 'watchlist_overlap',
        dismiss_reason: 'not_relevant',
        request_id: requestId,
        algorithm_version: algorithmVersion,
        is_authenticated: true,
      });
      return;
    }

    if (feedbackType === 'less_from_domain') {
      setDomainRecommendationWeights(prev => ({
        ...prev,
        [rec.signal.domain]: (prev[rec.signal.domain] || 0) - 1,
      }));
      setHiddenRecommendationIds(prev => {
        const next = new Set(prev);
        next.add(rec.signal.id);
        return next;
      });
      trackEvent('reco_item_dismissed', {
        surface: RECOMMENDATION_SURFACE,
        region: region || 'global',
        item_type: 'signal',
        item_id: rec.signal.id,
        position,
        reason_type: rec.reason_type || 'watchlist_overlap',
        dismiss_reason: 'less_from_domain',
        request_id: requestId,
        algorithm_version: algorithmVersion,
        is_authenticated: true,
      });
      return;
    }

    setDomainRecommendationWeights(prev => ({
      ...prev,
      [rec.signal.domain]: (prev[rec.signal.domain] || 0) + 1,
    }));
  }, [recommendationRequestId, recommendationAlgorithmVersion, region]);

  const listRef = useRef<HTMLDivElement>(null);

  return (
    <>
      {/* Header */}
      <header className="briefing-header">
        <span className="briefing-date">{l.title}</span>
        <h1 className="briefing-headline">
          {l.headline}
        </h1>
        <p className="briefing-subhead">
          {stats.total} {l.tracked} {Object.keys(stats.by_domain).length} {l.domains}.
          {dynamicSignals.rising.length > 0 && (
            <span className="text-accent-info"> {dynamicSignals.rising.length} {l.rising}.</span>
          )}
        </p>
      </header>

      {/* Filter bar + notification pill */}
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <FilterBar
            sort={sort}
            onSortChange={setSort}
            domain={domain}
            onDomainChange={setDomain}
            status={status}
            onStatusChange={setStatus}
            stats={stats}
            isTR={isTR}
          />
          <SectorFilter region={region} value={sector} onChange={setSector} />
        </div>
        {isAuthenticated && newCount > 0 && (
          <div className="pt-1">
            <NotificationPill count={newCount} onDismiss={handleDismissNew} isTR={isTR} />
          </div>
        )}
      </div>

      {isAuthenticated && (recommendationsLoading || displayedRecommendations.length > 0) && (
        <section className="mt-3 p-3 border border-border/30 rounded-lg bg-muted/10">
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb className="w-3.5 h-3.5 text-accent-info" />
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {l.recommended}
            </span>
          </div>
          {recommendationsLoading ? (
            <div className="text-xs text-muted-foreground/60">{l.loadingRecommendations}</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {displayedRecommendations.map((rec, index) => {
                const style = STATUS_STYLES[rec.signal.status] || STATUS_STYLES.candidate;
                const domainLabel = DOMAIN_LABELS[rec.signal.domain] || rec.signal.domain;
                return (
                  <div key={rec.signal.id} className="p-2.5 border border-border/30 rounded-md bg-card/50">
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => handleRecommendationClick(rec, index + 1)}
                        className="text-left text-xs text-foreground hover:text-accent-info transition-colors line-clamp-2 flex-1"
                      >
                        {rec.signal.claim}
                      </button>
                      <FollowButton
                        signalId={rec.signal.id}
                        isFollowing={followedIds.has(rec.signal.id)}
                        onToggle={(id) => handleToggleFollow(id, {
                          source: 'recommendation',
                          recommendation_request_id: recommendationRequestId || 'unknown',
                          recommendation_position: index + 1,
                          recommendation_reason_type: rec.reason_type || 'watchlist_overlap',
                          recommendation_algorithm_version: recommendationAlgorithmVersion || RECOMMENDATION_ALGO_FALLBACK,
                        })}
                        isAuthenticated={isAuthenticated}
                        isTR={isTR}
                      />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="px-1.5 py-0.5 text-[9px] rounded-full border border-accent-info/30 bg-accent-info/10 text-accent-info">
                        {l.whyForYou}
                      </span>
                      <span className="px-1.5 py-0.5 text-[9px] rounded-full border border-border/40 text-muted-foreground">
                        {getRecommendationReasonTag({
                          reasonType: rec.reason_type,
                          overlapCount: rec.overlap_count,
                          isTR,
                        })}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">{rec.reason}</p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className={`px-1.5 py-0.5 text-[9px] rounded-full ${style.bg} ${style.text}`}>
                        {isTR ? (STATUS_LABELS_TR[rec.signal.status] || style.label) : style.label}
                      </span>
                      <span className="text-[9px] text-muted-foreground uppercase tracking-wider">
                        {(isTR ? DOMAIN_LABELS_TR : DOMAIN_LABELS)[rec.signal.domain] || domainLabel}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleRecommendationFeedback(rec, index + 1, 'not_relevant')}
                        className="px-1.5 py-0.5 text-[10px] rounded border border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors"
                      >
                        {l.notRelevant}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRecommendationFeedback(rec, index + 1, 'more_like_this')}
                        className="px-1.5 py-0.5 text-[10px] rounded border border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors"
                      >
                        {l.moreLikeThis}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRecommendationFeedback(rec, index + 1, 'less_from_domain')}
                        className="px-1.5 py-0.5 text-[10px] rounded border border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors"
                      >
                        {l.lessFromDomain}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Two-pane layout */}
      <div className={cn(
        'mt-4',
        isDesktop && 'flex gap-0 min-h-[600px]'
      )}>
        {/* Left pane: signal list */}
        <div
          ref={listRef}
          className={cn(
            'overflow-y-auto',
            isDesktop
              ? 'w-[380px] shrink-0 border-r border-border/20 max-h-[calc(100vh-280px)]'
              : 'w-full'
          )}
        >
          {listLoading ? (
            <ListSkeleton />
          ) : signals.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground/60">
              {l.noMatches}
            </div>
          ) : (
            visibleSections.map(statusKey => {
              const sectionSignals = groupedSignals[statusKey];
              const style = STATUS_STYLES[statusKey];
              const StatusIcon = statusKey === 'accelerating' ? TrendingUp
                : statusKey === 'decaying' ? TrendingDown
                : Activity;
              const iconColor = statusKey === 'accelerating' ? 'text-accent-info'
                : statusKey === 'decaying' ? 'text-destructive'
                : 'text-muted-foreground/60';

              return (
                <div key={statusKey}>
                  <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm px-4 py-2 flex items-center gap-2 border-b border-border/10">
                    <StatusIcon className={cn('w-3 h-3', iconColor)} />
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                      {isTR ? (STATUS_LABELS_TR[statusKey] || style.label) : style.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground/40">
                      ({sectionSignals.length})
                    </span>
                  </div>
                  {sectionSignals.map(signal => (
                    <SignalCard
                      key={signal.id}
                      signal={signal}
                      selected={signal.id === selectedId}
                      onSelect={handleSelectSignal}
                      onOpenEvidence={setEvidenceDrawerSignalId}
                      isFollowing={followedIds.has(signal.id)}
                      onToggleFollow={handleToggleFollow}
                      isAuthenticated={isAuthenticated}
                      isTR={isTR}
                    />
                  ))}
                </div>
              );
            })
          )}
        </div>

        {/* Right pane: inspector (desktop only) */}
        {isDesktop && (
          <div className="flex-1 sticky top-20 self-start max-h-[calc(100vh-280px)] overflow-y-auto border-l border-border/20">
            {selectedId ? (
              <SignalInspector
                signalId={selectedId}
                listSignal={selectedSignal}
                allSignals={signals}
                onSelectSignal={handleSelectSignal}
                region={isTR ? 'turkey' : 'global'}
              />
            ) : (
              <InspectorEmpty region={isTR ? 'turkey' : 'global'} />
            )}
          </div>
        )}
      </div>

      {/* Mobile inspector sheet */}
      {!isDesktop && (
        <Sheet
          open={mobileSheetOpen}
          onOpenChange={setMobileSheetOpen}
          side="right"
          className="w-[340px] max-w-[90vw]"
        >
          <SheetHeader onClose={() => setMobileSheetOpen(false)}>
            {l.signalDetail}
          </SheetHeader>
          <SheetContent>
            {selectedId ? (
              <SignalInspector
                signalId={selectedId}
                listSignal={selectedSignal}
                allSignals={signals}
                onSelectSignal={handleSelectSignal}
                region={isTR ? 'turkey' : 'global'}
              />
            ) : (
              <InspectorEmpty region={isTR ? 'turkey' : 'global'} />
            )}
          </SheetContent>
        </Sheet>
      )}

      {/* Evidence drawer */}
      {evidenceDrawerSignalId && (
        <EvidenceDrawer
          open={!!evidenceDrawerSignalId}
          onOpenChange={(open) => { if (!open) setEvidenceDrawerSignalId(null); }}
          signalId={evidenceDrawerSignalId}
          signalClaim={evidenceDrawerSignal?.claim || ''}
          region={isTR ? 'turkey' : 'global'}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Static signals view (original, used as fallback — unchanged)
// ---------------------------------------------------------------------------

function FallbackBanner({ reason }: { reason?: 'api_empty' | 'api_error' }) {
  if (!reason) return null;
  return (
    <div className="mb-6 px-4 py-3 rounded-lg border border-border/30 bg-muted/30 text-sm text-muted-foreground">
      Signal engine has not produced data yet. Showing pattern analysis from monthly batch.
    </div>
  );
}

function StaticSignalsView({
  patterns,
  correlations,
  totalDeals,
  region,
  emergingPatterns = [],
  categories = [],
  fallbackReason,
}: Omit<StaticModeProps, 'mode'>) {
  const regionKey = normalizeDatasetRegion(region);
  const withRegion = (href: string) => {
    if (regionKey === 'global') return href;
    const [path, query] = href.split('?');
    const params = new URLSearchParams(query || '');
    params.set('region', regionKey);
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  };

  const [cohortModal, setCohortModal] = useState<{
    isOpen: boolean;
    patternName: string;
    companies: StartupAnalysis[];
  }>({
    isOpen: false,
    patternName: '',
    companies: [],
  });

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const filteredPatterns = useMemo(() => {
    if (!selectedCategory) return patterns;
    const category = categories.find(c => c.name === selectedCategory);
    if (!category) return patterns;
    const patternNames = new Set(category.patterns);
    return patterns.filter(p => patternNames.has(p.name));
  }, [patterns, selectedCategory, categories]);

  const filteredEmergingPatterns = useMemo(() => {
    if (!selectedCategory) return emergingPatterns;
    return emergingPatterns.filter(p => p.category === selectedCategory);
  }, [emergingPatterns, selectedCategory]);

  const openCohort = useCallback((pattern: PatternData) => {
    setCohortModal({
      isOpen: true,
      patternName: pattern.name,
      companies: pattern.companies,
    });
  }, []);

  const closeCohort = useCallback(() => {
    setCohortModal(prev => ({ ...prev, isOpen: false }));
  }, []);

  const handleMatrixCellClick = useCallback(
    (patternA: string, patternB: string) => {
      const patternDataA = patterns.find(p => p.name === patternA);
      const companySlugsA = new Set(
        patternDataA?.companies.map(c => c.company_slug) || []
      );

      const patternDataB = patterns.find(p => p.name === patternB);
      const bothPatterns = patternDataB?.companies.filter(c =>
        companySlugsA.has(c.company_slug)
      ) || [];

      setCohortModal({
        isOpen: true,
        patternName: `${patternA} + ${patternB}`,
        companies: bothPatterns,
      });
    },
    [patterns]
  );

  const patternNames = patterns.map(p => p.name);

  return (
    <>
      <FallbackBanner reason={fallbackReason} />

      {/* Page Header */}
      <header className="briefing-header">
        <span className="briefing-date">Signals</span>
        <h1 className="briefing-headline">
          Architectural patterns shaping the next generation of AI infrastructure
        </h1>
        <p className="briefing-subhead">
          Analysis of {totalDeals} deals reveals conviction levels across{' '}
          {patterns.length} distinct build patterns.
          {emergingPatterns.length > 0 && (
            <span className="text-accent-info"> {emergingPatterns.length} emerging patterns discovered.</span>
          )}
        </p>
      </header>

      {/* Category Tabs */}
      {categories.length > 0 && (
        <div className="mb-8">
          <div className="flex flex-wrap gap-2 pb-4 border-b border-border/30">
            <button
              onClick={() => setSelectedCategory(null)}
              className={`px-3 py-1.5 text-xs rounded-full transition-colors ${
                selectedCategory === null
                  ? 'bg-accent-info/10 text-accent-info border border-accent-info/25'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/25 border border-transparent'
              }`}
            >
              All Patterns
            </button>
            {categories.slice(0, 8).map(cat => (
              <button
                key={cat.name}
                onClick={() => setSelectedCategory(cat.name)}
                className={`px-3 py-1.5 text-xs rounded-full transition-colors ${
                  selectedCategory === cat.name
                    ? 'bg-accent-info/10 text-accent-info border border-accent-info/25'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/25 border border-transparent'
                }`}
              >
                {cat.name}
                <span className="ml-1 opacity-60">({cat.count})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Emerging Patterns Section */}
      {filteredEmergingPatterns.length > 0 && (
        <section className="section mb-8">
          <div className="section-header">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-accent-info" />
              <span className="section-title">Emerging Patterns</span>
            </div>
            <span className="text-xs text-muted-foreground">
              High-novelty approaches discovered this period
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredEmergingPatterns.slice(0, 6).map((pattern, index) => (
              <div
                key={index}
                className="p-4 border border-border/30 rounded-lg hover:border-accent-info/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <h4 className="text-sm font-medium text-foreground">{pattern.name}</h4>
                    <span className="text-xs text-muted-foreground">{pattern.category}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="w-3 h-3 text-accent-info" />
                    <span className="text-xs px-1.5 py-0.5 bg-accent-info/10 text-accent-info rounded">
                      {pattern.avgNovelty.toFixed(1)}/10
                    </span>
                  </div>
                </div>

                {pattern.whyNotable && (
                  <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
                    {pattern.whyNotable}
                  </p>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {pattern.count} {pattern.count === 1 ? 'company' : 'companies'}
                  </span>
                  <button
                    onClick={() => setCohortModal({
                      isOpen: true,
                      patternName: pattern.name,
                      companies: pattern.companies,
                    })}
                    className="text-xs text-accent-info hover:text-accent-info/80 transition-colors"
                  >
                    View companies →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Patterns List */}
      <div className="space-y-0">
        {filteredPatterns.slice(0, 8).map(pattern => (
          <div key={pattern.name} className="signal-item">
            <div className="signal-header">
              <h3 className="signal-name">{pattern.name}</h3>
              <div className="signal-conviction">
                <span className={`signal-conviction-dot ${pattern.conviction}`} />
                <span className="text-muted-foreground capitalize">
                  {pattern.conviction}
                </span>
              </div>
            </div>

            <p className="signal-thesis">{pattern.thesis}</p>

            <div className="intel-callout">
              <span className="intel-callout-label">What This Enables</span>
              <p className="intel-callout-text">{pattern.enables}</p>
            </div>

            <div className="signal-meta mt-6">
              <div className="signal-meta-item">
                <span className="signal-meta-label">Time Horizon</span>
                <span className="signal-meta-value">{pattern.horizon}</span>
              </div>
              <div className="signal-meta-item">
                <span className="signal-meta-label">Primary Risk</span>
                <span className="signal-meta-value max-w-xs">{pattern.risk}</span>
              </div>
              <div className="signal-meta-item">
                <span className="signal-meta-label">Companies</span>
                <span className="signal-meta-value">{pattern.count}</span>
              </div>
            </div>

            <div className="flex items-center gap-4 mt-6 pt-4 border-t border-border/20">
              <button
                onClick={() => openCohort(pattern)}
                className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Users className="w-3.5 h-3.5" />
                View {pattern.count} companies
                <ArrowRight className="w-3 h-3" />
              </button>

              <Link
                href={withRegion(`/dealbook?pattern=${encodeURIComponent(pattern.name)}`)}
                className="inline-flex items-center gap-2 text-xs text-accent-info hover:text-accent-info/80 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Browse in Dealbook
              </Link>

              {pattern.companies.length > 0 && (
                <span className="text-xs text-muted-foreground/60">
                  Top: {pattern.companies
                    .slice(0, 3)
                    .map(c => c.company_name)
                    .join(', ')}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Co-occurrence Matrix */}
      <section className="section mt-12">
        <div className="section-header">
          <span className="section-title">Pattern Relationships</span>
        </div>
        <CoOccurrenceMatrix
          correlations={correlations}
          patterns={patternNames}
          onCellClick={handleMatrixCellClick}
        />

        <div className="mt-4 p-4 border border-border/30 rounded-lg bg-muted/10">
          <div className="flex items-start gap-3">
            <Lightbulb className="w-4 h-4 text-accent-info mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-foreground font-medium mb-1">Pattern Insight</p>
              <p className="text-xs text-muted-foreground">
                {getTopCorrelationInsight(correlations)}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pattern Cohort Modal */}
      <PatternCohortTable
        isOpen={cohortModal.isOpen}
        onClose={closeCohort}
        patternName={cohortModal.patternName}
        companies={cohortModal.companies}
        region={regionKey}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Main export — dispatches between dynamic and static modes
// ---------------------------------------------------------------------------

export function InteractiveSignals(props: InteractiveSignalsProps) {
  if (props.mode === 'dynamic') {
    return <DynamicSignalsView dynamicSignals={props.dynamicSignals} region={props.region} />;
  }

  return (
    <StaticSignalsView
      patterns={props.patterns}
      correlations={props.correlations}
      totalDeals={props.totalDeals}
      region={props.region}
      emergingPatterns={props.emergingPatterns}
      categories={props.categories}
      fallbackReason={props.fallbackReason}
    />
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTopCorrelationInsight(correlations: PatternCorrelation[]): string {
  if (correlations.length === 0) {
    return 'Not enough pattern data to compute correlations.';
  }

  const top = correlations[0];
  const percentage = (top.correlation * 100).toFixed(0);

  return `${top.patternA} and ${top.patternB} appear together in ${top.coOccurrenceCount} companies (${percentage}% correlation). This suggests these patterns may complement each other in production AI systems.`;
}
