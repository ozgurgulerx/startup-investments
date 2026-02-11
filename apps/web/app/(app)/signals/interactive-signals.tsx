'use client';

import { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Users, ArrowRight, Lightbulb, ExternalLink, Sparkles, TrendingUp, TrendingDown, Activity, BarChart3, Clock } from 'lucide-react';
import { PatternCohortTable } from '@/components/features/pattern-cohort-table';
import { CoOccurrenceMatrix } from '@/components/charts/co-occurrence-matrix';
import type { PatternData, EmergingPattern, CategoryData } from './page';
import type { PatternCorrelation } from '@/lib/data/signals';
import type { SignalItem, SignalsSummaryResponse } from '@/lib/api/client';
import type { StartupAnalysis } from '@startup-intelligence/shared';
import { normalizeDatasetRegion } from '@/lib/region';

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

// ---------------------------------------------------------------------------
// Signal card component (dynamic mode)
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

function SignalCard({ signal }: { signal: SignalItem }) {
  const style = STATUS_STYLES[signal.status] || STATUS_STYLES.candidate;
  const domainLabel = DOMAIN_LABELS[signal.domain] || signal.domain;

  const timeSinceFirstSeen = useMemo(() => {
    const first = new Date(signal.first_seen_at);
    const now = new Date();
    const days = Math.floor((now.getTime() - first.getTime()) / (1000 * 60 * 60 * 24));
    if (days === 0) return 'today';
    if (days === 1) return '1 day ago';
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }, [signal.first_seen_at]);

  return (
    <div className="py-6 border-b border-border/30 last:border-0">
      {/* Top row: status + domain + time */}
      <div className="flex items-center gap-2 mb-3">
        <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${style.bg} ${style.text}`}>
          {style.label}
        </span>
        <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
          {domainLabel}
        </span>
        <span className="text-[10px] text-muted-foreground/40 ml-auto flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" />
          {timeSinceFirstSeen}
        </span>
      </div>

      {/* Claim text */}
      <p className="text-sm text-foreground leading-relaxed mb-4">
        {signal.claim}
      </p>

      {/* Metrics row */}
      <div className="flex flex-wrap items-center gap-4">
        <MetricBadge
          label="Conviction"
          value={signal.conviction}
          format="percent"
        />
        <MetricBadge
          label="Momentum"
          value={signal.momentum}
          format="delta"
          icon={signal.momentum > 0 ? TrendingUp : signal.momentum < 0 ? TrendingDown : Activity}
        />
        <MetricBadge
          label="Impact"
          value={signal.impact}
          format="percent"
        />
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <BarChart3 className="w-3 h-3" />
          <span>{signal.evidence_count} evidence</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="w-3 h-3" />
          <span>{signal.unique_company_count} {signal.unique_company_count === 1 ? 'company' : 'companies'}</span>
        </div>
      </div>
    </div>
  );
}

function MetricBadge({
  label,
  value,
  format,
  icon: Icon,
}: {
  label: string;
  value: number;
  format: 'percent' | 'delta';
  icon?: any;
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

// ---------------------------------------------------------------------------
// Dynamic signals view
// ---------------------------------------------------------------------------

function DynamicSignalsView({ dynamicSignals, region }: { dynamicSignals: SignalsSummaryResponse; region?: string }) {
  const { rising, established, decaying, stats } = dynamicSignals;

  return (
    <>
      {/* Header */}
      <header className="briefing-header">
        <span className="briefing-date">Signal Intelligence</span>
        <h1 className="briefing-headline">
          Live pattern adoption signals across AI infrastructure
        </h1>
        <p className="briefing-subhead">
          {stats.total} active signals tracked across {Object.keys(stats.by_domain).length} domains.
          {rising.length > 0 && (
            <span className="text-accent-info"> {rising.length} signals rising.</span>
          )}
        </p>
      </header>

      {/* Stats strip */}
      <div className="flex flex-wrap gap-4 mb-8 pb-6 border-b border-border/30">
        {Object.entries(stats.by_status).map(([status, count]) => {
          const style = STATUS_STYLES[status] || STATUS_STYLES.candidate;
          return (
            <div key={status} className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${style.bg.replace('/10', '/40').replace('/30', '/40')}`} />
              <span className="text-xs text-muted-foreground capitalize">{status}</span>
              <span className="text-xs font-medium text-foreground">{count}</span>
            </div>
          );
        })}
      </div>

      {/* Rising signals */}
      {rising.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-accent-info" />
            <h2 className="text-sm font-medium text-foreground uppercase tracking-wider">Rising</h2>
            <span className="text-xs text-muted-foreground">({rising.length})</span>
          </div>
          <div className="divide-y divide-border/20">
            {rising.map(signal => (
              <SignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        </section>
      )}

      {/* Established signals */}
      {established.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-medium text-foreground uppercase tracking-wider">Established</h2>
            <span className="text-xs text-muted-foreground">({established.length})</span>
          </div>
          <div className="divide-y divide-border/20">
            {established.map(signal => (
              <SignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        </section>
      )}

      {/* Decaying signals */}
      {decaying.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <TrendingDown className="w-4 h-4 text-destructive" />
            <h2 className="text-sm font-medium text-foreground uppercase tracking-wider">Decaying</h2>
            <span className="text-xs text-muted-foreground">({decaying.length})</span>
          </div>
          <div className="divide-y divide-border/20">
            {decaying.map(signal => (
              <SignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Static signals view (original, used as fallback)
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
