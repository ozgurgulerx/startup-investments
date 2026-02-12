import { Suspense } from 'react';
import { IntelligenceBrief } from '@/components/features';
import { getMonthlyBrief } from '@/lib/data/generate-monthly-brief';
import { getAvailablePeriods, getMonthlyStats } from '@/lib/data';
import { StaticSignalStrip } from '@/components/features/signal-strip';
import { BriefHeaderStrip } from '@/components/features/brief-header-strip';
import { BriefDeltaSection } from '@/components/features/brief-delta-section';
import { BriefEditionSelector } from '@/components/features/brief-edition-selector';
import { getBriefSnapshot, listBriefEditions } from '@/lib/api/brief';
import { snapshotToMonthlyBrief } from '@/lib/types/monthly-brief';
import { formatCurrency } from '@/lib/utils';
import { ReadingWrapper } from '@/components/ui/reading-wrapper';
import { normalizeDatasetRegion } from '@/lib/region';

const FALLBACK_PERIOD = '2026-01';

async function BriefContent({
  region,
  periodType,
  periodStart,
  kind,
  editionId,
}: {
  region?: string;
  periodType?: string;
  periodStart?: string;
  kind?: string;
  editionId?: string;
}) {
  const regionKey = normalizeDatasetRegion(region);
  const ptKey = periodType || 'monthly';

  // Parallel fetch: snapshot + edition list
  const [snapshot, editionList] = await Promise.all([
    getBriefSnapshot({
      editionId,
      region: regionKey,
      periodType: ptKey,
      periodStart,
      kind,
    }),
    listBriefEditions({ region: regionKey, periodType: ptKey }),
  ]);

  if (snapshot) {
    const m = snapshot.metrics;

    // Compute revision delta highlight for header strip
    const revDelta = snapshot.revisionDeltas;
    const deltaHighlight = revDelta
      ? [
          revDelta.totalFunding ? `Funding ${revDelta.totalFunding.pct > 0 ? '+' : ''}${revDelta.totalFunding.pct}%` : null,
          revDelta.dealCount ? `${Math.abs(revDelta.dealCount.value)} new deal${Math.abs(revDelta.dealCount.value) !== 1 ? 's' : ''}` : null,
        ].filter(Boolean).join(', ') || null
      : null;

    return (
      <>
        {/* Edition selector */}
        <BriefEditionSelector
          editions={editionList.items}
          currentPeriodType={ptKey}
          currentEditionId={snapshot.editionId}
          region={regionKey}
        />

        {/* Header Strip — freshness indicator */}
        <BriefHeaderStrip
          generatedAt={snapshot.generatedAt}
          periodLabel={snapshot.periodLabel}
          revisionNumber={snapshot.revisionNumber}
          revisionDelta={deltaHighlight}
          kind={snapshot.kind}
        />

        {/* Signal Strip — metrics from snapshot (consistent) */}
        <StaticSignalStrip
          metrics={{
            totalFunding: formatCurrency(m.totalFunding, true),
            totalDeals: m.dealCount,
            genaiAdoption: `${m.genaiAdoptionRate}%`,
            topDeal: m.largestDeal.company !== 'N/A' ? {
              name: m.largestDeal.company,
              amount: formatCurrency(m.largestDeal.amount, true),
              slug: m.largestDeal.slug || undefined,
            } : undefined,
          }}
          deltas={snapshot.deltas}
        />

        {/* Delta Bullets — "What Changed" section */}
        <BriefDeltaSection bullets={snapshot.deltaBullets} revisionBullets={snapshot.revisionDeltaBullets} />

        {/* Main Brief — rendered from snapshot via adapter */}
        <IntelligenceBrief
          initialBrief={snapshotToMonthlyBrief(snapshot)}
          availablePeriods={[snapshot.periodKey]}
          region={region}
          snapshot={snapshot}
        />
      </>
    );
  }

  // Fallback: existing file-based path (pre-snapshot)
  const allPeriods = await getAvailablePeriods(region);
  const latestPeriod = allPeriods[0]?.period || FALLBACK_PERIOD;

  const [brief, stats] = await Promise.all([
    getMonthlyBrief(latestPeriod, region),
    getMonthlyStats(latestPeriod, region),
  ]);

  const availablePeriods = allPeriods
    .filter(p => p.has_newsletter)
    .map(p => p.period);

  const topDeal = stats.top_deals?.[0];

  return (
    <>
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
      <div className="space-y-4">
        <div className="h-8 w-48 bg-muted rounded" />
        <div className="h-12 w-3/4 bg-muted rounded" />
        <div className="h-6 w-1/2 bg-muted rounded" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="p-4 border border-border/30 rounded-lg">
            <div className="h-8 w-20 bg-muted rounded mb-2" />
            <div className="h-4 w-16 bg-muted rounded" />
          </div>
        ))}
      </div>

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
  searchParams: Promise<{
    region?: string;
    period_type?: string;
    period_start?: string;
    kind?: string;
    edition_id?: string;
  }>;
}) {
  const params = await searchParams;

  return (
    <Suspense fallback={<BriefLoading />}>
      <ReadingWrapper>
        <BriefContent
          region={params.region}
          periodType={params.period_type}
          periodStart={params.period_start}
          kind={params.kind}
          editionId={params.edition_id}
        />
      </ReadingWrapper>
    </Suspense>
  );
}
