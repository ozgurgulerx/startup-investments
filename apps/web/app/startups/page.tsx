import { Suspense } from 'react';
import { DashboardLayout } from '@/components/layout';
import { StartupCard } from '@/components/features';
import { Card, Input, Badge } from '@/components/ui';
import { getStartups, getMonthlyStats, getAvailablePeriods } from '@/lib/data';
import { formatCurrency } from '@/lib/utils';

const DEFAULT_PERIOD = '2026-01';

async function StartupsContent() {
  const [startups, stats, periods] = await Promise.all([
    getStartups(DEFAULT_PERIOD),
    getMonthlyStats(DEFAULT_PERIOD),
    getAvailablePeriods(),
  ]);

  // Get unique verticals and stages for filters
  const verticals = [...new Set(startups.map((s) => s.vertical))].filter(Boolean);
  const stages = [...new Set(startups.map((s) => s.funding_stage))].filter(Boolean);

  return (
    <DashboardLayout
      initialPeriod={DEFAULT_PERIOD}
      availablePeriods={periods.map((p) => p.period)}
    >
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Startups</h1>
            <p className="text-muted-foreground">
              {startups.length} startups analyzed · {formatCurrency(stats.deal_summary.total_funding_usd, true)} total funding
            </p>
          </div>
        </div>

        {/* Filters */}
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <Input
              type="search"
              placeholder="Search startups..."
              className="max-w-xs"
            />
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Stage:</span>
              <div className="flex flex-wrap gap-1">
                {stages.slice(0, 5).map((stage) => stage && (
                  <Badge key={stage} variant="outline" className="cursor-pointer hover:bg-muted">
                    {stage.replace(/_/g, ' ')}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Vertical:</span>
              <div className="flex flex-wrap gap-1">
                {verticals.slice(0, 5).map((vertical) => vertical && (
                  <Badge key={vertical} variant="outline" className="cursor-pointer hover:bg-muted">
                    {vertical.replace(/_/g, ' ')}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Startup Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {startups.map((startup) => (
            <StartupCard key={startup.company_slug} startup={startup} />
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}

function StartupsLoading() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-16 animate-pulse rounded-xl bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(9)].map((_, i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-xl bg-muted"
            />
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}

export default function StartupsPage() {
  return (
    <Suspense fallback={<StartupsLoading />}>
      <StartupsContent />
    </Suspense>
  );
}
