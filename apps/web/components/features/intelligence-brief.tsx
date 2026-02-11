'use client';

import { useEffect, useState, useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MonthlyBrief } from '@/lib/types/monthly-brief';
import { MonthSwitcher } from '@/components/ui/month-switcher';
import { KpiCard } from '@/components/ui/kpi-card';
import { formatCurrency } from '@/lib/utils';
import { normalizeDatasetRegion } from '@/lib/region';
import type { BriefSnapshot, BriefSnapshotDeltas, SignalRef, BuilderAction } from '@startup-intelligence/shared';

function DeltaCell({ value, suffix = '%' }: { value?: number | null; suffix?: string }) {
  if (value == null || value === 0) return <span className="text-muted-foreground/50">—</span>;
  if (Math.abs(value) < 1) return <span className="text-muted-foreground/50">—</span>;
  const color = value > 0 ? 'text-success' : 'text-destructive';
  return (
    <span className={`text-xs tabular-nums ${color}`}>
      {value > 0 ? '+' : ''}{value}{suffix}
    </span>
  );
}

interface IntelligenceBriefProps {
  initialBrief: MonthlyBrief;
  availablePeriods: string[];
  region?: string;
  snapshot?: BriefSnapshot;
}

function briefCacheKey(region: string, period: string): string {
  return `${region}:${period}`;
}

function withRegionHref(href: string, region: string): string {
  if (!region || region === 'global') return href;
  const [path, query] = href.split('?');
  const params = new URLSearchParams(query || '');
  params.set('region', region);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

// Cache for fetched briefs (keyed by region+period)
const briefCache = new Map<string, MonthlyBrief>();

export function IntelligenceBrief({
  initialBrief,
  availablePeriods,
  region,
  snapshot,
}: IntelligenceBriefProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [urlMonth, setUrlMonth] = useState<string | null>(null);
  const regionKey = normalizeDatasetRegion(region);

  // Get current period from URL or default to initial
  const currentPeriod = urlMonth || initialBrief.monthKey;
  const validPeriod = availablePeriods.includes(currentPeriod)
    ? currentPeriod
    : availablePeriods[0] || initialBrief.monthKey;

  // State for brief data
  const [brief, setBrief] = useState<MonthlyBrief>(() => {
    briefCache.set(briefCacheKey(regionKey, initialBrief.monthKey), initialBrief);
    return initialBrief;
  });
  const [isLoading, setIsLoading] = useState(false);

  // Initialize + keep URL month in sync on browser back/forward.
  useEffect(() => {
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search || '');
      setUrlMonth(params.get('month'));
    };

    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, []);

  // Handle month change
  const handleMonthChange = useCallback(
    async (newPeriod: string) => {
      if (newPeriod === validPeriod) return;
      setIsLoading(true);

      try {
        startTransition(() => {
          const params = new URLSearchParams(window.location.search || '');
          params.set('month', newPeriod);
          router.push(`?${params.toString()}`, { scroll: false });
        });
        setUrlMonth(newPeriod);

        // Check cache first
        const key = briefCacheKey(regionKey, newPeriod);
        if (briefCache.has(key)) {
          setBrief(briefCache.get(key)!);
        } else {
          // Try new snapshot API first, fall back to legacy
          const params = new URLSearchParams();
          if (regionKey !== 'global') params.set('region', regionKey);
          params.set('period_key', newPeriod);
          let fetched = false;
          try {
            const snapResponse = await fetch(`/api/v1/brief?${params.toString()}`);
            if (snapResponse.ok) {
              const snapData = await snapResponse.json();
              // Convert snapshot to MonthlyBrief format for rendering
              if (snapData && snapData.metrics) {
                const { snapshotToMonthlyBrief: convert } = await import('@/lib/types/monthly-brief');
                const converted = convert(snapData);
                briefCache.set(key, converted);
                setBrief(converted);
                fetched = true;
              }
            }
          } catch { /* fall through to legacy */ }

          if (!fetched) {
            const legacyParams = new URLSearchParams();
            legacyParams.set('period', newPeriod);
            if (regionKey !== 'global') legacyParams.set('region', regionKey);
            const response = await fetch(`/api/brief?${legacyParams.toString()}`);
            if (response.ok) {
              const data = await response.json();
              briefCache.set(key, data);
              setBrief(data);
            }
          }
        }
      } catch (error) {
        console.error('Failed to load brief:', error);
      } finally {
        setIsLoading(false);
      }
    },
    [validPeriod, router, regionKey]
  );

  // Ensure brief data stays consistent with URL (e.g. browser back/forward).
  useEffect(() => {
    if (brief.monthKey === validPeriod) return;

    let cancelled = false;
    const run = async () => {
      setIsLoading(true);
      try {
        const key = briefCacheKey(regionKey, validPeriod);
        if (briefCache.has(key)) {
          if (!cancelled) setBrief(briefCache.get(key)!);
          return;
        }
        // Try new snapshot API first, fall back to legacy
        const params = new URLSearchParams();
        if (regionKey !== 'global') params.set('region', regionKey);
        params.set('period_key', validPeriod);
        let fetched = false;
        try {
          const snapResponse = await fetch(`/api/v1/brief?${params.toString()}`);
          if (snapResponse.ok) {
            const snapData = await snapResponse.json();
            if (snapData && snapData.metrics) {
              const { snapshotToMonthlyBrief: convert } = await import('@/lib/types/monthly-brief');
              const converted = convert(snapData);
              briefCache.set(key, converted);
              if (!cancelled) setBrief(converted);
              fetched = true;
            }
          }
        } catch { /* fall through */ }

        if (!fetched) {
          const legacyParams = new URLSearchParams();
          legacyParams.set('period', validPeriod);
          if (regionKey !== 'global') legacyParams.set('region', regionKey);
          const response = await fetch(`/api/brief?${legacyParams.toString()}`);
          if (response.ok) {
            const data = await response.json();
            briefCache.set(key, data);
            if (!cancelled) setBrief(data);
          }
        }
      } catch (error) {
        console.error('Failed to load brief:', error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [validPeriod, brief.monthKey, regionKey]);

  const fadeClass = isLoading ? 'opacity-60' : 'opacity-100';
  const periodDeltas = snapshot?.deltas ?? null;

  return (
    <div className={`space-y-12 transition-opacity duration-150 ${fadeClass}`}>
      {/* Header Section */}
      <BriefHeader
        brief={brief}
        availablePeriods={availablePeriods}
        currentPeriod={validPeriod}
        onMonthChange={handleMonthChange}
      />

      {/* Executive Summary */}
      <ExecutiveSummary summary={brief.executiveSummary} />

      {/* Signals behind this brief */}
      {snapshot?.topSignals && snapshot.topSignals.length > 0 && (
        <SignalsBehindBrief signals={snapshot.topSignals} region={regionKey} />
      )}

      {/* Builder Actions */}
      {snapshot?.builderActions && snapshot.builderActions.length > 0 && (
        <BuilderActionsSection actions={snapshot.builderActions} region={regionKey} />
      )}

      {/* By the Numbers */}
      <MetricsSection metrics={brief.metrics} region={regionKey} periodDeltas={periodDeltas} />

      {/* This Month's Theme */}
      <ThemeSection theme={brief.theme} />

      {/* Pattern Landscape */}
      <PatternLandscape patterns={brief.patternLandscape} region={regionKey} patternShifts={periodDeltas?.patternShifts} />

      {/* Market Landscape - Funding by Stage */}
      <FundingByStageSection stages={brief.fundingByStage} stageShifts={periodDeltas?.stageShifts} />

      {/* Top Deals */}
      <TopDealsSection deals={brief.topDeals} region={regionKey} />

      {/* In the News (when snapshot has news context) */}
      {snapshot?.newsContext && snapshot.newsContext.clusters.length > 0 && (
        <NewsContextSection clusters={snapshot.newsContext.clusters} region={regionKey} />
      )}

      {/* Geographic Intelligence */}
      <GeographicSection
        geography={brief.geography}
        usDominance={brief.usDominance}
        emergingHubs={brief.emergingHubs}
      />

      {/* Investor Intelligence */}
      <InvestorSection investors={brief.investors} />

      {/* Featured Spotlight */}
      {brief.spotlight && <SpotlightSection spotlight={brief.spotlight} region={regionKey} />}

      {/* Implications & What We're Watching */}
      <Implications
        lessons={brief.builderLessons}
        watching={brief.whatWatching}
      />

      {/* Methodology */}
      <MethodologySection methodology={brief.methodology} />

      {/* Footer CTA */}
      <FooterCTA />
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function BriefHeader({
  brief,
  availablePeriods,
  currentPeriod,
  onMonthChange,
}: {
  brief: MonthlyBrief;
  availablePeriods: string[];
  currentPeriod: string;
  onMonthChange: (period: string) => void;
}) {
  return (
    <header className="briefing-header">
      <div className="flex items-center gap-4 mb-4">
        <MonthSwitcher
          availableMonths={availablePeriods}
          value={currentPeriod}
          onChange={onMonthChange}
        />
        <Link
          href="/brief/archive"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          View archive →
        </Link>
      </div>
      <h1 className="briefing-headline">{brief.title}</h1>
      <p className="text-sm text-accent-info mb-2">{brief.subtitle}</p>
      <p className="briefing-subhead">{brief.hook}</p>
      <p className="text-xs text-muted-foreground mt-4">
        Generated: {new Date(brief.generatedAt).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })}
      </p>
    </header>
  );
}

function ExecutiveSummary({ summary }: { summary: string }) {
  return (
    <section className="section">
      <div className="section-header">
        <span className="section-title">Executive Summary</span>
      </div>
      <p className="body-md max-w-prose leading-relaxed">{summary}</p>
    </section>
  );
}

function MetricsSection({ metrics, region, periodDeltas }: { metrics: MonthlyBrief['metrics']; region: string; periodDeltas?: BriefSnapshotDeltas | null }) {
  return (
    <section className="section">
      <div className="section-header">
        <span className="section-title">By the Numbers</span>
        <Link href={withRegionHref('/dealbook', region)} className="section-link">
          View all deals
        </Link>
      </div>

      {/* KPI Strip - Links to dealbook */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <Link href={withRegionHref('/dealbook?sortBy=funding&sortOrder=desc', region)}>
          <KpiCard
            label="Total Funding"
            value={formatCurrency(metrics.totalFunding, true)}
            trend={periodDeltas?.totalFunding ? { value: periodDeltas.totalFunding.pct, isPositive: periodDeltas.totalFunding.pct > 0 } : undefined}
          />
        </Link>
        <Link href={withRegionHref('/dealbook', region)}>
          <KpiCard
            label="Total Deals"
            value={metrics.totalDeals.toString()}
            trend={periodDeltas?.dealCount ? { value: periodDeltas.dealCount.pct, isPositive: periodDeltas.dealCount.pct > 0 } : undefined}
          />
        </Link>
        <Link href={withRegionHref('/dealbook?sortBy=funding&sortOrder=desc', region)}>
          <KpiCard
            label="Average Deal"
            value={formatCurrency(metrics.avgDeal, true)}
            trend={periodDeltas?.avgDeal ? { value: periodDeltas.avgDeal.pct, isPositive: periodDeltas.avgDeal.pct > 0 } : undefined}
          />
        </Link>
        <Link href={withRegionHref('/dealbook?sortBy=funding&sortOrder=desc', region)}>
          <KpiCard
            label="Median Deal"
            value={formatCurrency(metrics.medianDeal, true)}
          />
        </Link>
        <Link
          href={withRegionHref(
            `/company/${metrics.largestDeal.company.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            region
          )}
        >
          <KpiCard
            label="Largest Deal"
            value={formatCurrency(metrics.largestDeal.amount, true)}
            subtext={metrics.largestDeal.company}
          />
        </Link>
        <Link href={withRegionHref('/dealbook?usesGenai=true', region)}>
          <KpiCard
            label="GenAI Adoption"
            value={`${metrics.genaiAdoptionPct}%`}
            trend={periodDeltas?.genaiAdoptionRate ? { value: periodDeltas.genaiAdoptionRate.ppChange, isPositive: periodDeltas.genaiAdoptionRate.ppChange > 0, suffix: 'pp' } : undefined}
          />
        </Link>
      </div>

      {/* Compact Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/30">
              <th className="text-left py-2 text-muted-foreground font-medium">
                Metric
              </th>
              <th className="text-right py-2 text-muted-foreground font-medium">
                Value
              </th>
              {periodDeltas && (
                <th className="text-right py-2 text-muted-foreground font-medium">
                  vs Prev
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border/20">
              <td className="py-2">Total Funding</td>
              <td className="text-right tabular-nums">
                {formatCurrency(metrics.totalFunding, true)}
              </td>
              {periodDeltas && (
                <td className="text-right"><DeltaCell value={periodDeltas.totalFunding?.pct} /></td>
              )}
            </tr>
            <tr className="border-b border-border/20">
              <td className="py-2">Total Deals</td>
              <td className="text-right tabular-nums">{metrics.totalDeals}</td>
              {periodDeltas && (
                <td className="text-right"><DeltaCell value={periodDeltas.dealCount?.pct} /></td>
              )}
            </tr>
            <tr className="border-b border-border/20">
              <td className="py-2">Average Deal Size</td>
              <td className="text-right tabular-nums">
                {formatCurrency(metrics.avgDeal, true)}
              </td>
              {periodDeltas && (
                <td className="text-right"><DeltaCell value={periodDeltas.avgDeal?.pct} /></td>
              )}
            </tr>
            <tr className="border-b border-border/20">
              <td className="py-2">Median Deal Size</td>
              <td className="text-right tabular-nums">
                {formatCurrency(metrics.medianDeal, true)}
              </td>
              {periodDeltas && <td className="text-right"><DeltaCell value={null} /></td>}
            </tr>
            <tr className="border-b border-border/20">
              <td className="py-2">Largest Deal</td>
              <td className="text-right tabular-nums">
                {formatCurrency(metrics.largestDeal.amount, true)} (
                {metrics.largestDeal.company})
              </td>
              {periodDeltas && <td className="text-right"><DeltaCell value={null} /></td>}
            </tr>
            <tr>
              <td className="py-2">GenAI Adoption Rate</td>
              <td className="text-right tabular-nums">
                {metrics.genaiAdoptionPct}%
              </td>
              {periodDeltas && (
                <td className="text-right"><DeltaCell value={periodDeltas.genaiAdoptionRate?.ppChange} suffix="pp" /></td>
              )}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

// MetricCard is now replaced by KpiCard from @/components/ui/kpi-card

function ThemeSection({ theme }: { theme: MonthlyBrief['theme'] }) {
  return (
    <section className="section">
      <div className="section-header">
        <span className="section-title">This Month&apos;s Theme</span>
      </div>
      <div className="p-6 border border-accent-info/30 rounded-lg bg-accent-info/5">
        <h3 className="text-xl font-medium text-foreground mb-4">{theme.name}</h3>
        <ul className="space-y-3">
          {theme.summaryBullets.map((bullet, i) => (
            <li key={i} className="flex gap-3 text-sm text-muted-foreground">
              <span className="text-accent-info">•</span>
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function PatternLandscape({
  patterns,
  region,
  patternShifts,
}: {
  patterns: MonthlyBrief['patternLandscape'];
  region: string;
  patternShifts?: BriefSnapshotDeltas['patternShifts'];
}) {
  // Top 3 signals for callout cards
  const topSignals = patterns.slice(0, 3);
  const shiftMap = patternShifts ? new Map(patternShifts.map(s => [s.pattern, s.deltaPp])) : null;

  return (
    <section className="section">
      <div className="section-header">
        <span className="section-title">Pattern Landscape</span>
        <Link href={withRegionHref('/signals', region)} className="section-link">
          Full signal analysis
        </Link>
      </div>

      {/* Pattern Table */}
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/30">
              <th className="text-left py-2 text-muted-foreground font-medium">
                Pattern
              </th>
              <th className="text-right py-2 text-muted-foreground font-medium">
                Prevalence
              </th>
              {shiftMap && (
                <th className="text-right py-2 text-muted-foreground font-medium hidden md:table-cell">
                  Shift
                </th>
              )}
              <th className="text-right py-2 text-muted-foreground font-medium">
                Startups
              </th>
              <th className="text-left py-2 pl-6 text-muted-foreground font-medium hidden md:table-cell">
                Signal
              </th>
            </tr>
          </thead>
          <tbody>
            {patterns.map((p, i) => (
              <tr key={i} className="border-b border-border/20">
                <td className="py-3 font-medium">{p.pattern}</td>
                <td className="text-right tabular-nums">{p.prevalencePct}%</td>
                {shiftMap && (
                  <td className="text-right hidden md:table-cell">
                    <DeltaCell value={shiftMap.get(p.pattern)} suffix="pp" />
                  </td>
                )}
                <td className="text-right tabular-nums">{p.startupCount}</td>
                <td className="text-left pl-6 text-muted-foreground hidden md:table-cell">
                  {p.signal}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Top 3 Builder Signals */}
      <div className="grid md:grid-cols-3 gap-4">
        {topSignals.map((signal, i) => (
          <div
            key={i}
            className="p-4 border border-border/30 rounded-lg bg-muted/20"
          >
            <p className="text-xs text-accent-info mb-1">
              #{i + 1} Signal
            </p>
            <p className="font-medium text-sm mb-2">{signal.pattern}</p>
            <p className="text-xs text-muted-foreground">{signal.signal}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function FundingByStageSection({
  stages,
  stageShifts,
}: {
  stages: MonthlyBrief['fundingByStage'];
  stageShifts?: BriefSnapshotDeltas['stageShifts'];
}) {
  const maxAmount = Math.max(...stages.map(s => s.amount));
  const shiftMap = stageShifts ? new Map(stageShifts.map(s => [s.stage, s.deltaPp])) : null;

  return (
    <section className="section">
      <div className="section-header">
        <span className="section-title">Market Landscape</span>
      </div>

      <div className="space-y-3 mb-4">
        {stages.slice(0, 6).map((stage, i) => (
          <div key={i} className="flex items-center gap-4">
            <span className="w-24 text-sm text-muted-foreground">
              {stage.stage}
            </span>
            <div className="flex-1 h-6 bg-muted/30 rounded overflow-hidden">
              <div
                className="h-full bg-accent-info/60 rounded"
                style={{ width: `${(stage.amount / maxAmount) * 100}%` }}
              />
            </div>
            <span className="w-20 text-sm tabular-nums text-right">
              {formatCurrency(stage.amount, true)}
            </span>
            <span className="w-16 text-xs text-muted-foreground text-right">
              {stage.deals} deals
            </span>
            {shiftMap && (
              <span className="w-12 text-right">
                <DeltaCell value={shiftMap.get(stage.stage)} suffix="pp" />
              </span>
            )}
          </div>
        ))}
      </div>

      <p className="text-sm text-muted-foreground">
        <strong>The Insight:</strong> Late-stage dominates dollar volume (
        {stages[0]?.pct}%), but seed deals dominate count (
        {stages.find(s => s.stage === 'Seed')?.deals || 0} deals). The market is
        bifurcating: mega-rounds for proven winners, active seed for exploration.
      </p>
    </section>
  );
}

function TopDealsSection({ deals, region }: { deals: MonthlyBrief['topDeals']; region: string }) {
  return (
    <section className="section">
      <div className="section-header">
        <span className="section-title">Top Deals</span>
        <Link href={withRegionHref('/dealbook', region)} className="section-link">
          View all companies
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/30">
              <th className="text-left py-2 text-muted-foreground font-medium w-12">
                #
              </th>
              <th className="text-left py-2 text-muted-foreground font-medium">
                Company
              </th>
              <th className="text-right py-2 text-muted-foreground font-medium">
                Funding
              </th>
              <th className="text-left py-2 pl-4 text-muted-foreground font-medium hidden md:table-cell">
                Stage
              </th>
              <th className="text-left py-2 pl-4 text-muted-foreground font-medium hidden lg:table-cell">
                Location
              </th>
            </tr>
          </thead>
          <tbody>
            {deals.map((deal) => (
              <tr key={deal.rank} className="border-b border-border/20">
                <td className="py-3 text-muted-foreground">{deal.rank}</td>
                <td className="py-3">
                  <Link
                    href={withRegionHref(`/company/${deal.slug}`, region)}
                    className="font-medium hover:text-accent-info transition-colors"
                  >
                    {deal.company}
                  </Link>
                </td>
                <td className="text-right tabular-nums">
                  {formatCurrency(deal.amount, true)}
                </td>
                <td className="pl-4 text-muted-foreground hidden md:table-cell">
                  {deal.stage}
                </td>
                <td className="pl-4 text-muted-foreground hidden lg:table-cell">
                  {deal.location}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GeographicSection({
  geography,
  usDominance,
  emergingHubs,
}: {
  geography: MonthlyBrief['geography'];
  usDominance: MonthlyBrief['usDominance'];
  emergingHubs: MonthlyBrief['emergingHubs'];
}) {
  return (
    <section className="section">
      <div className="section-header">
        <span className="section-title">Geographic Intelligence</span>
      </div>

      {/* Regional Table */}
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/30">
              <th className="text-left py-2 text-muted-foreground font-medium">
                Region
              </th>
              <th className="text-right py-2 text-muted-foreground font-medium">
                Deals
              </th>
              <th className="text-right py-2 text-muted-foreground font-medium">
                Total Funding
              </th>
              <th className="text-right py-2 text-muted-foreground font-medium hidden md:table-cell">
                Avg Deal
              </th>
            </tr>
          </thead>
          <tbody>
            {geography.map((g, i) => (
              <tr key={i} className="border-b border-border/20">
                <td className="py-3 font-medium">{g.region}</td>
                <td className="text-right tabular-nums">{g.deals}</td>
                <td className="text-right tabular-nums">
                  {formatCurrency(g.totalFunding, true)}
                </td>
                <td className="text-right tabular-nums hidden md:table-cell">
                  {formatCurrency(g.avgDeal, true)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* US Dominance & Emerging Hubs */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="p-4 border border-border/30 rounded-lg">
          <h4 className="text-sm font-medium text-foreground mb-3">
            US Dominance
          </h4>
          <p className="text-2xl font-light tabular-nums mb-2">
            {formatCurrency(usDominance.californiaTotal, true)}
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            California alone ({usDominance.californiaPct}% of all funding)
          </p>
          <div className="space-y-1">
            {usDominance.cities.slice(0, 4).map((city, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{city.city}</span>
                <span className="tabular-nums">
                  {formatCurrency(city.totalFunding, true)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 border border-border/30 rounded-lg">
          <h4 className="text-sm font-medium text-foreground mb-3">
            Emerging Hubs
          </h4>
          <div className="space-y-2">
            {emergingHubs.slice(0, 4).map((hub, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span>{hub.city}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatCurrency(hub.totalFunding, true)} ({hub.deals} deals)
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function InvestorSection({
  investors,
}: {
  investors: MonthlyBrief['investors'];
}) {
  return (
    <section className="section">
      <div className="section-header">
        <span className="section-title">Investor Intelligence</span>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Most Active */}
        <div>
          <h4 className="text-sm font-medium text-foreground mb-3">
            Most Active Investors
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="text-left py-2 text-muted-foreground font-medium">
                    Investor
                  </th>
                  <th className="text-right py-2 text-muted-foreground font-medium">
                    Deals
                  </th>
                  <th className="text-right py-2 text-muted-foreground font-medium">
                    Deployed
                  </th>
                </tr>
              </thead>
              <tbody>
                {investors.mostActive.map((inv, i) => (
                  <tr key={i} className="border-b border-border/20">
                    <td className="py-2 font-medium">{inv.name}</td>
                    <td className="text-right tabular-nums">{inv.deals}</td>
                    <td className="text-right tabular-nums">
                      {formatCurrency(inv.totalDeployed, true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mega-Check Writers */}
        <div>
          <h4 className="text-sm font-medium text-foreground mb-3">
            Mega-Check Writers
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="text-left py-2 text-muted-foreground font-medium">
                    Investor
                  </th>
                  <th className="text-right py-2 text-muted-foreground font-medium">
                    Investment
                  </th>
                  <th className="text-left py-2 pl-4 text-muted-foreground font-medium">
                    Company
                  </th>
                </tr>
              </thead>
              <tbody>
                {investors.megaCheckWriters.map((inv, i) => (
                  <tr key={i} className="border-b border-border/20">
                    <td className="py-2 font-medium">{inv.name}</td>
                    <td className="text-right tabular-nums">
                      {formatCurrency(inv.singleInvestment, true)}
                    </td>
                    <td className="pl-4 text-muted-foreground">{inv.company}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function SpotlightSection({
  spotlight,
  region,
}: {
  spotlight: NonNullable<MonthlyBrief['spotlight']>;
  region: string;
}) {
  return (
    <section className="section">
      <div className="section-header">
        <span className="section-title">Featured Spotlight</span>
      </div>

      <div className="p-6 border border-accent-info/30 rounded-lg bg-accent-info/5">
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <Link
            href={withRegionHref(`/company/${spotlight.slug}`, region)}
            className="text-xl font-medium text-foreground hover:text-accent-info transition-colors"
          >
            {spotlight.company}
          </Link>
          <span className="text-sm text-muted-foreground">
            {formatCurrency(spotlight.amount, true)} {spotlight.stage}
          </span>
          <span className="text-sm text-muted-foreground">
            {spotlight.location}
          </span>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          {spotlight.whyThisMatters}
        </p>

        {spotlight.buildPatterns.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {spotlight.buildPatterns.map((pattern, i) => (
              <span
                key={i}
                className="px-2 py-1 text-xs bg-muted/50 rounded text-muted-foreground"
              >
                {pattern}
              </span>
            ))}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4 pt-4 border-t border-border/30">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Risk</p>
            <p className="text-sm">{spotlight.risk}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Key Takeaway</p>
            <p className="text-sm">{spotlight.builderTakeaway}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Implications({
  lessons,
  watching,
}: {
  lessons: MonthlyBrief['builderLessons'];
  watching: MonthlyBrief['whatWatching'];
}) {
  return (
    <section className="section">
      <div className="grid md:grid-cols-2 gap-8">
        {/* Implications */}
        <div>
          <h3 className="text-lg font-medium text-foreground mb-4">
            Implications
          </h3>
          <div className="space-y-4">
            {lessons.map((lesson, i) => (
              <div key={i} className="p-4 border border-border/30 rounded-lg">
                <p className="text-sm font-medium text-foreground mb-2">
                  {i + 1}. {lesson.title}
                </p>
                <p className="text-sm text-muted-foreground">{lesson.text}</p>
                {lesson.howToApply && (
                  <p className="text-xs text-accent-info mt-2">
                    How to apply: {lesson.howToApply}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* What We're Watching */}
        <div>
          <h3 className="text-lg font-medium text-foreground mb-4">
            What We&apos;re Watching
          </h3>
          <ul className="space-y-3">
            {watching.map((item, i) => (
              <li
                key={i}
                className="flex gap-3 text-sm text-muted-foreground"
              >
                <span className="text-accent-info">→</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function MethodologySection({
  methodology,
}: {
  methodology: MonthlyBrief['methodology'];
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section className="section">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <span
          className={`transform transition-transform ${isOpen ? 'rotate-90' : ''}`}
        >
          →
        </span>
        <span>Methodology</span>
      </button>

      {isOpen && (
        <div className="mt-4 p-4 border border-border/30 rounded-lg bg-muted/10">
          <ul className="space-y-1">
            {methodology.bullets.map((bullet, i) => (
              <li key={i} className="text-xs text-muted-foreground">
                • {bullet}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function SignalsBehindBrief({ signals, region }: { signals: SignalRef[]; region: string }) {
  if (!signals || signals.length === 0) return null;

  return (
    <section className="section">
      <div className="section-header">
        <span className="section-title">Signals behind this brief</span>
        <Link href={withRegionHref('/news', region)} className="section-link">
          Full radar
        </Link>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        The top news signals that informed this brief&apos;s narrative and analysis.
      </p>
      <div className="space-y-3">
        {signals.map((signal) => (
          <div key={signal.clusterId} className="p-4 border border-border/30 rounded-lg">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{signal.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{signal.builderTakeaway}</p>
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0 uppercase tracking-wider">
                {signal.storyType}
              </span>
            </div>
            {signal.linkedSlugs.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {signal.linkedSlugs.slice(0, 3).map((slug) => (
                  <Link key={slug} href={withRegionHref(`/company/${slug}`, region)}
                    className="text-[10px] px-1.5 py-0.5 bg-muted/50 rounded text-muted-foreground hover:text-accent-info transition-colors">
                    {slug}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function BuilderActionsSection({ actions, region }: { actions: BuilderAction[]; region: string }) {
  if (!actions || actions.length === 0) return null;

  return (
    <section className="section">
      <div className="section-header">
        <span className="section-title">Builder Actions</span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Next 7 days</span>
      </div>
      <div className="space-y-3">
        {actions.map((action, i) => (
          <div key={i} className="p-4 border border-border/30 rounded-lg">
            <p className="text-sm font-medium text-foreground">{action.action}</p>
            {action.rationale && (
              <p className="text-xs text-muted-foreground mt-1">{action.rationale}</p>
            )}
            {action.refs.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {action.refs.map((ref, j) => (
                  <Link key={j} href={withRegionHref(ref.url, region)}
                    className="text-[10px] px-1.5 py-0.5 bg-muted/50 rounded text-muted-foreground hover:text-accent-info transition-colors">
                    {ref.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function NewsContextSection({
  clusters,
  region,
}: {
  clusters: Array<{
    id: string;
    title: string;
    summary: string;
    storyType: string;
    publishedAt: string;
    linkedStartupSlugs: string[];
    rankScore: number;
  }>;
  region: string;
}) {
  return (
    <section className="section">
      <div className="section-header">
        <span className="section-title">In the News</span>
        <Link href={withRegionHref('/news', region)} className="section-link">
          Full radar
        </Link>
      </div>

      <div className="space-y-3">
        {clusters.slice(0, 5).map((cluster) => (
          <div key={cluster.id} className="p-4 border border-border/30 rounded-lg">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{cluster.title}</p>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{cluster.summary}</p>
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0 uppercase tracking-wider">
                {cluster.storyType}
              </span>
            </div>
            {cluster.linkedStartupSlugs.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {cluster.linkedStartupSlugs.slice(0, 3).map((slug) => (
                  <Link
                    key={slug}
                    href={withRegionHref(`/company/${slug}`, region)}
                    className="text-[10px] px-1.5 py-0.5 bg-muted/50 rounded text-muted-foreground hover:text-accent-info transition-colors"
                  >
                    {slug}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function FooterCTA() {
  return (
    <div className="pt-8 border-t border-border/30">
      <Link
        href="/library"
        className="inline-flex items-center gap-2 text-accent-info hover:text-accent-info/80 transition-colors"
      >
        Read the full report in Library
        <span>→</span>
      </Link>
    </div>
  );
}
