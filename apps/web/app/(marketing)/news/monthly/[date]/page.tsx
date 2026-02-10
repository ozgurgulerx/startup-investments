import { notFound } from 'next/navigation';
import { getPeriodicBrief, getPeriodicBriefArchive } from '@/lib/data/news';
import { PeriodicBriefView } from '@/components/news/periodic-brief-view';
import { NewsNav } from '@/components/news/news-nav';
import { withTimeout } from '@/lib/with-timeout';

export const dynamic = 'force-dynamic';

export default async function GlobalMonthlyBriefArchivePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const [brief, archive] = await Promise.all([
    withTimeout(getPeriodicBrief({ periodType: 'monthly', region: 'global', date }), 5000).catch(() => null),
    getPeriodicBriefArchive({ periodType: 'monthly', region: 'global', limit: 20 }),
  ]);

  if (!brief) notFound();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NewsNav activeRegion="global" activePeriod="monthly" />
      <PeriodicBriefView brief={brief} region="global" archive={archive} />
    </div>
  );
}
