import Link from 'next/link';
import { getAvailablePeriods } from '@/lib/data';
import { formatCurrency } from '@/lib/utils';
import { ArrowRight, Calendar } from 'lucide-react';

// Format YYYY-MM to "January 2026"
function formatMonthLabel(period: string): string {
  const [year, month] = period.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// Group periods by year
function groupByYear(periods: Array<{ period: string; deal_count: number; total_funding: number }>) {
  const groups: Record<string, typeof periods> = {};

  for (const p of periods) {
    const year = p.period.split('-')[0];
    if (!groups[year]) {
      groups[year] = [];
    }
    groups[year].push(p);
  }

  return Object.entries(groups)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, months]) => ({
      year,
      months: months.sort((a, b) => b.period.localeCompare(a.period)),
    }));
}

export default async function ArchivePage() {
  const periods = await getAvailablePeriods();
  const groupedPeriods = groupByYear(periods);

  // Compute totals
  const totalDeals = periods.reduce((sum, p) => sum + p.deal_count, 0);
  const totalFunding = periods.reduce((sum, p) => sum + p.total_funding, 0);

  const latestPeriod = periods[0]?.period;

  return (
    <>
      {/* Header */}
      <header className="briefing-header">
        <span className="briefing-date">Archive</span>
        <h1 className="briefing-headline">Dealbook Archive</h1>
        <p className="briefing-subhead">
          {totalDeals.toLocaleString()} deals tracked across {periods.length} months
          {' · '}
          {formatCurrency(totalFunding, true)} total capital mapped
        </p>
      </header>

      {/* Quick action: View Latest */}
      {latestPeriod && (
        <Link
          href="/dealbook"
          className="flex items-center justify-between p-4 mb-8 rounded-lg bg-accent/5 border border-accent/20 hover:bg-accent/10 transition-colors group"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent/10">
              <Calendar className="h-5 w-5 text-accent" />
            </div>
            <div>
              <div className="font-medium text-foreground">View Latest</div>
              <div className="text-sm text-muted-foreground">{formatMonthLabel(latestPeriod)}</div>
            </div>
          </div>
          <ArrowRight className="h-5 w-5 text-accent opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
        </Link>
      )}

      {/* All-time summary */}
      <Link
        href="/dealbook?month=all"
        className="flex items-center justify-between p-4 mb-8 rounded-lg bg-muted/30 border border-border/30 hover:bg-muted/50 transition-colors group"
      >
        <div>
          <div className="font-medium text-foreground">All Time View</div>
          <div className="text-sm text-muted-foreground">View all deals across all periods</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium text-foreground">{totalDeals.toLocaleString()} deals</div>
          <div className="text-xs text-muted-foreground">{formatCurrency(totalFunding, true)}</div>
        </div>
      </Link>

      {/* Archive by Year */}
      <div className="space-y-8">
        {groupedPeriods.map(({ year, months }) => (
          <section key={year}>
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-4">
              {year}
            </h2>
            <div className="space-y-0 border-t border-border/30">
              {months.map((period) => {
                const isLatest = period.period === latestPeriod;

                return (
                  <Link
                    key={period.period}
                    href={`/dealbook?month=${period.period}`}
                    className="flex items-center justify-between py-4 border-b border-border/30 hover:bg-muted/20 transition-colors group -mx-4 px-4"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-foreground font-medium">
                        {formatMonthLabel(period.period)}
                      </span>
                      {isLatest && (
                        <span className="text-[10px] uppercase tracking-wider text-accent px-1.5 py-0.5 bg-accent/10 rounded">
                          Latest
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <span className="text-muted-foreground">
                        {period.deal_count} deals
                      </span>
                      <span className="text-muted-foreground w-24 text-right">
                        {formatCurrency(period.total_funding, true)}
                      </span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* Empty state */}
      {periods.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg">No archived periods available</p>
          <p className="text-sm mt-2">Data will appear here once periods are processed</p>
        </div>
      )}
    </>
  );
}
