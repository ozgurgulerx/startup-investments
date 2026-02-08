import { notFound } from 'next/navigation';
import { getPeriodicBrief, getPeriodicBriefArchive } from '@/lib/data/news';
import { PeriodicBriefView } from '@/components/news/periodic-brief-view';
import { NewsNav } from '@/components/news/news-nav';

export const dynamic = 'force-dynamic';

export default async function GlobalWeeklyBriefArchivePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const [brief, archive] = await Promise.all([
    getPeriodicBrief({ periodType: 'weekly', region: 'global', date }),
    getPeriodicBriefArchive({ periodType: 'weekly', region: 'global', limit: 20 }),
  ]);

  if (!brief) notFound();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NewsNav activeRegion="global" activePeriod="weekly" />
      <PeriodicBriefView brief={brief} region="global" archive={archive} />
    </div>
  );
}
