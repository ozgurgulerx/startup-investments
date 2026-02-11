import { Suspense } from 'react';
import Link from 'next/link';
import { listBriefEditions } from '@/lib/api/brief';
import { formatCurrency } from '@/lib/utils';
import { ReadingWrapper } from '@/components/ui/reading-wrapper';

export const dynamic = 'force-dynamic';

async function ArchiveContent({ region, periodType }: { region: string; periodType: string }) {
  const { items, total } = await listBriefEditions({
    region,
    periodType,
    limit: 50,
    offset: 0,
  });

  if (items.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-muted-foreground">
          No {periodType} briefs available yet. Briefs are generated daily.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-4">{total} brief{total !== 1 ? 's' : ''} available</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/30">
              <th className="text-left py-2 text-muted-foreground font-medium">Period</th>
              <th className="text-right py-2 text-muted-foreground font-medium">Last Updated</th>
              <th className="text-right py-2 text-muted-foreground font-medium hidden sm:table-cell">Rev</th>
              <th className="text-right py-2 text-muted-foreground font-medium">Deals</th>
              <th className="text-right py-2 text-muted-foreground font-medium hidden md:table-cell">Funding</th>
              <th className="text-right py-2 text-muted-foreground font-medium hidden sm:table-cell">Kind</th>
              <th className="text-right py-2 text-muted-foreground font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const params = new URLSearchParams();
              if (region !== 'global') params.set('region', region);
              params.set('edition_id', item.editionId);
              const href = `/brief?${params.toString()}`;

              return (
                <tr key={item.editionId} className="border-b border-border/20 hover:bg-muted/10 transition-colors">
                  <td className="py-3">
                    <Link href={href} className="font-medium hover:text-accent-info transition-colors">
                      {item.periodLabel}
                    </Link>
                  </td>
                  <td className="text-right text-muted-foreground">
                    {new Date(item.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </td>
                  <td className="text-right tabular-nums text-muted-foreground hidden sm:table-cell">
                    {item.revisionNumber}
                  </td>
                  <td className="text-right tabular-nums">{item.dealCount}</td>
                  <td className="text-right tabular-nums hidden md:table-cell">
                    {formatCurrency(item.totalFunding, true)}
                  </td>
                  <td className="text-right hidden sm:table-cell">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {item.kind}
                    </span>
                  </td>
                  <td className="text-right">
                    <span className={`text-[10px] uppercase tracking-wider ${
                      item.status === 'sealed' ? 'text-muted-foreground' : 'text-accent-info'
                    }`}>
                      {item.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ArchiveLoading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-4 w-24 bg-muted rounded" />
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-10 bg-muted rounded" />
      ))}
    </div>
  );
}

export default async function BriefArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ region?: string; period_type?: string }>;
}) {
  const params = await searchParams;
  const region = params.region || 'global';
  const periodType = params.period_type || 'monthly';

  return (
    <ReadingWrapper>
      <header className="mb-8">
        <Link href="/brief" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          ← Back to Brief
        </Link>
        <h1 className="text-2xl font-light tracking-tight text-foreground mt-4">Brief Archive</h1>
        <p className="text-sm text-muted-foreground mt-1">Browse past intelligence briefs</p>

        {/* Period type tabs */}
        <div className="flex gap-4 mt-4 border-b border-border/30">
          {(['monthly', 'weekly'] as const).map((type) => {
            const isActive = periodType === type;
            const tabParams = new URLSearchParams();
            tabParams.set('period_type', type);
            if (region !== 'global') tabParams.set('region', region);
            return (
              <Link
                key={type}
                href={`/brief/archive?${tabParams.toString()}`}
                className={`pb-2 text-sm capitalize transition-colors ${
                  isActive
                    ? 'text-foreground border-b-2 border-accent-info'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {type}
              </Link>
            );
          })}
        </div>
      </header>

      <Suspense fallback={<ArchiveLoading />}>
        <ArchiveContent region={region} periodType={periodType} />
      </Suspense>
    </ReadingWrapper>
  );
}
