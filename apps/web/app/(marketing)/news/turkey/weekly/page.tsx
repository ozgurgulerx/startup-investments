import { notFound } from 'next/navigation';
import { getPeriodicBrief, getPeriodicBriefArchive } from '@/lib/data/news';
import { PeriodicBriefView } from '@/components/news/periodic-brief-view';
import { NewsNav } from '@/components/news/news-nav';

export const dynamic = 'force-dynamic';

export default async function TurkeyWeeklyBriefPage() {
  const [brief, archive] = await Promise.all([
    getPeriodicBrief({ periodType: 'weekly', region: 'turkey' }),
    getPeriodicBriefArchive({ periodType: 'weekly', region: 'turkey', limit: 20 }),
  ]);

  if (!brief) {
    return (
      <div className="flex h-screen flex-col bg-background">
        <NewsNav activeRegion="turkey" activePeriod="weekly" />
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="max-w-md rounded-2xl border border-border/40 bg-card/60 p-10 text-center">
            <p className="label-xs text-accent-info">Turkey Weekly Brief</p>
            <h1 className="mt-3 text-3xl font-light tracking-tight text-foreground">No weekly brief available</h1>
            <p className="mt-4 text-sm text-muted-foreground">
              Weekly briefs are generated every Monday. Check back soon.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NewsNav activeRegion="turkey" activePeriod="weekly" />
      <PeriodicBriefView brief={brief} region="turkey" archive={archive} />
    </div>
  );
}
