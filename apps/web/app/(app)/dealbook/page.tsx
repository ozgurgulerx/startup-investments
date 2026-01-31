import { Suspense } from 'react';
import { getStartups, getMonthlyStats } from '@/lib/data';
import { formatCurrency } from '@/lib/utils';
import { CompanyRow } from './company-row';

const DEFAULT_PERIOD = '2026-01';

async function DealbookContent() {
  const [startups, stats] = await Promise.all([
    getStartups(DEFAULT_PERIOD),
    getMonthlyStats(DEFAULT_PERIOD),
  ]);

  // Sort by funding amount
  const sortedStartups = [...startups].sort(
    (a, b) => (b.funding_amount || 0) - (a.funding_amount || 0)
  );

  return (
    <>
      {/* Page Header */}
      <header className="briefing-header">
        <span className="briefing-date">Dealbook</span>
        <h1 className="briefing-headline">
          {stats.deal_summary.total_deals} deals tracked this period
        </h1>
        <p className="briefing-subhead">
          {formatCurrency(stats.deal_summary.total_funding_usd, true)} total capital deployed across {stats.deal_summary.total_deals} rounds.
        </p>
      </header>

      {/* Company List */}
      <div className="space-y-0">
        {sortedStartups.map((startup) => (
          <CompanyRow key={startup.company_slug} startup={startup} />
        ))}
      </div>
    </>
  );
}

function DealbookLoading() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="space-y-4">
        <div className="h-3 w-32 bg-muted rounded" />
        <div className="h-8 w-2/3 bg-muted rounded" />
        <div className="h-4 w-1/2 bg-muted rounded" />
      </div>
      <div className="h-px bg-border" />
      <div className="space-y-0">
        {[...Array(10)].map((_, i) => (
          <div key={i} className="py-6 border-b border-border/30">
            <div className="h-5 w-1/3 bg-muted rounded mb-2" />
            <div className="h-4 w-2/3 bg-muted rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DealbookPage() {
  return (
    <Suspense fallback={<DealbookLoading />}>
      <DealbookContent />
    </Suspense>
  );
}
