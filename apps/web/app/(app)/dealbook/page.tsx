import { Suspense } from 'react';
import Link from 'next/link';
import { getStartups, getMonthlyStats } from '@/lib/data';
import { formatCurrency } from '@/lib/utils';

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
          {startups.length} companies analyzed this period
        </h1>
        <p className="briefing-subhead">
          {formatCurrency(stats.deal_summary.total_funding_usd, true)} total capital deployed across {stats.deal_summary.total_deals} rounds.
        </p>
      </header>

      {/* Company List */}
      <div className="space-y-0">
        {sortedStartups.map((startup) => {
          // Get top pattern (max 1)
          const topPattern = startup.build_patterns
            ?.sort((a, b) => b.confidence - a.confidence)[0];

          return (
            <Link
              key={startup.company_slug}
              href={`/company/${startup.company_slug}`}
              className="startup-row group"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-3">
                  <h3 className="startup-name group-hover:text-accent transition-colors">
                    {startup.company_name}
                  </h3>
                  {topPattern && (
                    <span className="text-xs text-muted-foreground/60">
                      {topPattern.name}
                    </span>
                  )}
                </div>

                {startup.description && (
                  <p className="startup-insight line-clamp-1">
                    {startup.description}
                  </p>
                )}

                <div className="startup-meta">
                  {startup.location && (
                    <span>{startup.location}</span>
                  )}
                  {startup.vertical && (
                    <span>{startup.vertical.replace(/_/g, ' ')}</span>
                  )}
                  {startup.funding_stage && (
                    <span>{startup.funding_stage.replace(/_/g, ' ')}</span>
                  )}
                </div>
              </div>

              <div className="text-right shrink-0">
                <span className="startup-amount">
                  {formatCurrency(startup.funding_amount || 0, true)}
                </span>
                {startup.uses_genai && (
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    GenAI
                  </p>
                )}
              </div>
            </Link>
          );
        })}
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
