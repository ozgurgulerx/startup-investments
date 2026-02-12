import { Suspense } from 'react';
import { getMonthlyStats, getAvailablePeriods, getStartups } from '@/lib/data';
import {
  detectOutlierRounds,
  computeConcentrationMetrics,
  detectStageAnomalies,
  computeLorenzCurve,
  computeParetoCurve,
} from '@/lib/data/anomalies';
import { normalizeDatasetRegion } from '@/lib/region';
import { InteractiveCapital, type InvestorMomentumEntry } from './interactive-capital';
import type { MonthlyStats } from '@startup-intelligence/shared';

const FALLBACK_PERIOD = '2026-01';

/**
 * Compute investor rank-change momentum across periods.
 */
function computeInvestorMomentum(
  currentStats: MonthlyStats,
  multiPeriodStats: MonthlyStats[],
): InvestorMomentumEntry[] {
  const currentInvestors = currentStats.top_investors || [];
  if (currentInvestors.length === 0 || multiPeriodStats.length < 2) return [];

  // Find the previous period's investors
  const prevStats = multiPeriodStats[multiPeriodStats.length - 2];
  const prevInvestors = prevStats?.top_investors || [];

  const prevRankMap = new Map<string, number>();
  prevInvestors.forEach((inv, i) => prevRankMap.set(inv.name, i + 1));

  return currentInvestors.map((inv, i) => {
    const currentRank = i + 1;
    const prevRank = prevRankMap.get(inv.name) ?? null;
    const isNew = prevRank === null;
    const rankChange = prevRank != null ? prevRank - currentRank : 0;

    return { name: inv.name, currentRank, prevRank, rankChange, isNew };
  });
}

async function CapitalContent({
  selectedMonth,
  region,
}: {
  selectedMonth?: string;
  region?: string;
}) {
  const regionKey = normalizeDatasetRegion(region);

  const periods = await getAvailablePeriods(region);
  const latestPeriod = periods[0]?.period || FALLBACK_PERIOD;
  const period =
    selectedMonth && periods.some((p) => p.period === selectedMonth)
      ? selectedMonth
      : latestPeriod;
  const availableMonths = periods.map((p) => p.period);

  // Load up to 6 periods for trends/sparklines
  const trendPeriods = periods.slice(0, 6).map((p) => p.period).reverse();
  const previousPeriod = trendPeriods.length >= 2 ? trendPeriods[trendPeriods.length - 2] : null;

  // Parallel data loading
  const [stats, startups, multiPeriodStats, prevStartups] = await Promise.all([
    getMonthlyStats(period, region),
    getStartups(period, region),
    Promise.all(trendPeriods.map((tp) => getMonthlyStats(tp, region))),
    previousPeriod ? getStartups(previousPeriod, region) : Promise.resolve([]),
  ]);

  const previousStats = previousPeriod
    ? multiPeriodStats[multiPeriodStats.length - 2] || null
    : null;

  // Compute derived metrics
  const outliers = detectOutlierRounds(startups, stats);
  const concentrationMetrics = computeConcentrationMetrics(startups);
  const stageAnomalies = detectStageAnomalies(startups, stats);
  const lorenzData = computeLorenzCurve(startups);
  const paretoData = computeParetoCurve(startups, 15);
  const investorMomentum = computeInvestorMomentum(stats, multiPeriodStats);

  // Turkey data for Compare tab (only load if viewing global)
  let turkeyStats: MonthlyStats | null = null;
  let turkeyStartups: any[] = [];
  if (regionKey === 'global') {
    try {
      const turkeyPeriods = await getAvailablePeriods('turkey');
      if (turkeyPeriods.some((p) => p.period === period)) {
        [turkeyStats, turkeyStartups] = await Promise.all([
          getMonthlyStats(period, 'turkey'),
          getStartups(period, 'turkey'),
        ]);
      }
    } catch {
      // Turkey data optional
    }
  }

  return (
    <InteractiveCapital
      multiPeriodStats={multiPeriodStats}
      currentStats={stats}
      previousStats={previousStats}
      startups={startups}
      prevStartups={prevStartups}
      concentrationMetrics={concentrationMetrics}
      lorenzData={lorenzData}
      paretoData={paretoData}
      outliers={outliers}
      stageAnomalies={stageAnomalies}
      investorMomentum={investorMomentum}
      availableMonths={availableMonths}
      currentPeriod={period}
      region={regionKey}
      turkeyStats={turkeyStats}
      turkeyStartups={turkeyStartups}
    />
  );
}

function CapitalLoading() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <div className="h-4 w-24 animate-pulse rounded bg-muted mb-2" />
          <div className="h-8 w-56 animate-pulse rounded bg-muted" />
        </div>
        <div className="flex gap-2">
          <div className="h-8 w-32 animate-pulse rounded-full bg-muted" />
          <div className="h-8 w-24 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="h-10 w-full animate-pulse rounded bg-muted" />
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {[...Array(7)].map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    </div>
  );
}

export default async function CapitalPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; region?: string; tab?: string }>;
}) {
  const { month, region } = await searchParams;
  return (
    <Suspense fallback={<CapitalLoading />}>
      <CapitalContent selectedMonth={month} region={region} />
    </Suspense>
  );
}
