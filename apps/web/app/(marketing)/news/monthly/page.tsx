import { notFound } from 'next/navigation';
import { getPeriodicBrief, getPeriodicBriefArchive } from '@/lib/data/news';
import { PeriodicBriefView } from '@/components/news/periodic-brief-view';
import { NewsNav } from '@/components/news/news-nav';
import { withTimeout } from '@/lib/with-timeout';

export const dynamic = 'force-dynamic';

export default async function GlobalMonthlyBriefPage() {
  const [brief, archive] = await Promise.all([
    withTimeout(getPeriodicBrief({ periodType: 'monthly', region: 'global' }), 5000).catch(() => null),
    getPeriodicBriefArchive({ periodType: 'monthly', region: 'global', limit: 20 }),
  ]);

  if (!brief) {
    return (
      <div className="flex h-screen flex-col bg-background">
        <NewsNav activeRegion="global" activePeriod="monthly" />
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="max-w-md rounded-2xl border border-border/40 bg-card/60 p-10 text-center">
            <p className="label-xs text-accent-info">Monthly Brief</p>
            <h1 className="mt-3 text-3xl font-light tracking-tight text-foreground">No monthly brief available</h1>
            <p className="mt-4 text-sm text-muted-foreground">
              Monthly briefs are generated on the 1st of each month. Check back soon.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NewsNav activeRegion="global" activePeriod="monthly" />
      <PeriodicBriefView brief={brief} region="global" archive={archive} />
    </div>
  );
}
