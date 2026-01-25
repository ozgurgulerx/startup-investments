import { Suspense } from 'react';
import { BriefingClient, type BriefingData } from '@/components/features';
import {
  getMonthlyStats,
  getAvailablePeriods,
  getTopDeals,
  getStartups,
} from '@/lib/data';
import { formatCurrency } from '@/lib/utils';

const DEFAULT_PERIOD = '2026-01';

// Generate insight sentence based on data
function generateInsight(stats: Awaited<ReturnType<typeof getMonthlyStats>>): string {
  const genaiRate = Math.round(stats.genai_analysis.genai_adoption_rate * 100);
  const patterns = Object.entries(stats.genai_analysis.pattern_distribution)
    .sort((a, b) => b[1] - a[1]);
  const topPattern = patterns[0]?.[0] || 'agentic architectures';

  if (genaiRate > 50) {
    return `Capital concentrated around ${topPattern.toLowerCase()}, with ${genaiRate}% of funded startups building on generative AI infrastructure.`;
  }
  return `Investment activity signals growing conviction in ${topPattern.toLowerCase()} as the dominant build pattern this period.`;
}

// Generate supporting context
function generateContext(stats: Awaited<ReturnType<typeof getMonthlyStats>>): string {
  const avgDeal = stats.deal_summary.average_deal_size;
  const avgDealFormatted = formatCurrency(avgDeal, true);

  return `Average deal size reached ${avgDealFormatted}, suggesting investors are concentrating bets on fewer, more capital-intensive infrastructure plays rather than spreading across application layer experiments.`;
}

async function BriefingContent() {
  const [stats, periods, topDeals, startups] = await Promise.all([
    getMonthlyStats(DEFAULT_PERIOD),
    getAvailablePeriods(),
    getTopDeals(DEFAULT_PERIOD, 10),
    getStartups(DEFAULT_PERIOD),
  ]);

  const insight = generateInsight(stats);
  const context = generateContext(stats);

  // Get top patterns with companies
  const patterns = Object.entries(stats.genai_analysis.pattern_distribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const topPatterns = patterns.map(([name, count]) => {
    const companies = startups
      .filter(s => s.build_patterns?.some(p => p.name === name))
      .sort((a, b) => (b.funding_amount || 0) - (a.funding_amount || 0))
      .slice(0, 3)
      .map(s => s.company_name);
    return { name, count, companies };
  });

  // Geographic distribution
  const totalFunding = stats.deal_summary.total_funding_usd;
  const geographicDistribution = Object.entries(stats.funding_by_continent)
    .sort((a, b) => b[1].total_usd - a[1].total_usd)
    .slice(0, 5)
    .map(([region, bucket]) => ({
      region,
      amount: bucket.total_usd,
      percentage: Math.round((bucket.total_usd / totalFunding) * 100),
    }));

  // Prepare initial briefing data for client component
  const initialData: BriefingData = {
    period: DEFAULT_PERIOD,
    insight,
    context,
    stats: {
      totalFunding: stats.deal_summary.total_funding_usd,
      totalDeals: stats.deal_summary.total_deals,
      genaiAdoptionRate: Math.round(stats.genai_analysis.genai_adoption_rate * 100),
    },
    topDeals: topDeals.map(deal => ({
      slug: deal.slug,
      name: deal.name,
      vertical: deal.vertical,
      funding: deal.funding,
    })),
    topPatterns,
    geographicDistribution,
  };

  // Available periods for the month switcher
  const availablePeriods = periods
    .filter(p => p.has_newsletter)
    .map(p => p.period);

  return (
    <BriefingClient
      initialData={initialData}
      availablePeriods={availablePeriods}
    />
  );
}

function BriefingLoading() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="space-y-4">
        <div className="h-3 w-24 bg-muted rounded" />
        <div className="h-8 w-3/4 bg-muted rounded" />
        <div className="h-4 w-1/2 bg-muted rounded" />
      </div>
      <div className="h-px bg-border" />
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-12 bg-muted rounded" />
        ))}
      </div>
    </div>
  );
}

export default function BriefPage() {
  return (
    <Suspense fallback={<BriefingLoading />}>
      <BriefingContent />
    </Suspense>
  );
}
