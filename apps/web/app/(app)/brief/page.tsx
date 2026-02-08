import { Suspense } from 'react';
import { IntelligenceBrief } from '@/components/features';
import { getMonthlyBrief } from '@/lib/data/generate-monthly-brief';
import { getAvailablePeriods, getMonthlyStats } from '@/lib/data';
import { StaticSignalStrip } from '@/components/features/signal-strip';
import { formatCurrency } from '@/lib/utils';
import { ReadingWrapper } from '@/components/ui/reading-wrapper';

const FALLBACK_PERIOD = '2026-01';

async function BriefContent({ region }: { region?: string }) {
  // Dynamically resolve latest period
  const allPeriods = await getAvailablePeriods(region);
  const latestPeriod = allPeriods[0]?.period || FALLBACK_PERIOD;

  // Load brief and stats only - startups loaded lazily in drawer
  const [brief, stats] = await Promise.all([
    getMonthlyBrief(latestPeriod, region),
    getMonthlyStats(latestPeriod, region),
  ]);

  // Filter to periods with newsletters/briefs
  const availablePeriods = allPeriods
    .filter(p => p.has_newsletter)
    .map(p => p.period);

  // Find top deal for signal strip
  const topDeal = stats.top_deals?.[0];

  return (
    <>
      {/* Signal Strip */}
      <StaticSignalStrip
        metrics={{
          totalFunding: formatCurrency(stats.deal_summary.total_funding_usd, true),
          totalDeals: stats.deal_summary.total_deals,
          genaiAdoption: `${(stats.genai_analysis.genai_adoption_rate * 100).toFixed(0)}%`,
          topDeal: topDeal ? {
            name: topDeal.name,
            amount: formatCurrency(topDeal.funding_usd, true),
            slug: topDeal.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          } : undefined,
        }}
      />

      <IntelligenceBrief
        initialBrief={brief}
        availablePeriods={availablePeriods}
        region={region}
      />
    </>
  );
}

function BriefLoading() {
  return (
    <div className="animate-pulse space-y-8">
      {/* Header skeleton */}
      <div className="space-y-4">
        <div className="h-8 w-48 bg-muted rounded" />
        <div className="h-12 w-3/4 bg-muted rounded" />
        <div className="h-6 w-1/2 bg-muted rounded" />
      </div>

      {/* Metrics skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="p-4 border border-border/30 rounded-lg">
            <div className="h-8 w-20 bg-muted rounded mb-2" />
            <div className="h-4 w-16 bg-muted rounded" />
          </div>
        ))}
      </div>

      {/* Sections skeleton */}
      {[...Array(4)].map((_, i) => (
        <div key={i} className="space-y-4">
          <div className="h-6 w-40 bg-muted rounded" />
          <div className="h-24 bg-muted rounded" />
        </div>
      ))}
    </div>
  );
}

export default async function BriefPage({
  searchParams,
}: {
  searchParams: Promise<{ region?: string }>;
}) {
  const { region } = await searchParams;

  return (
    <Suspense fallback={<BriefLoading />}>
      <ReadingWrapper>
        <BriefContent region={region} />
      </ReadingWrapper>
    </Suspense>
  );
}
