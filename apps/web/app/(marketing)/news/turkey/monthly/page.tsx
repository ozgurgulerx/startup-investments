import { notFound } from 'next/navigation';
import { getPeriodicBrief, getPeriodicBriefArchive } from '@/lib/data/news';
import { PeriodicBriefView } from '@/components/news/periodic-brief-view';
import { NewsNav } from '@/components/news/news-nav';
import { withTimeout } from '@/lib/with-timeout';

export const dynamic = 'force-dynamic';

export default async function TurkeyMonthlyBriefPage() {
  const [brief, archive] = await Promise.all([
    withTimeout(getPeriodicBrief({ periodType: 'monthly', region: 'turkey' }), 5000).catch(() => null),
    getPeriodicBriefArchive({ periodType: 'monthly', region: 'turkey', limit: 20 }),
  ]);

  if (!brief) {
    return (
      <div className="flex h-screen flex-col bg-background">
        <NewsNav activeRegion="turkey" activePeriod="monthly" />
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="max-w-md rounded-2xl border border-border/40 bg-card/60 p-10 text-center">
            <p className="label-xs text-accent-info">Turkiye Aylik Bulten</p>
            <h1 className="mt-3 text-3xl font-light tracking-tight text-foreground">Aylik bulten henuz yok</h1>
            <p className="mt-4 text-sm text-muted-foreground">
              Aylik bultenler her ayin 1&apos;inde uretilir. Kisa sure sonra tekrar kontrol edin.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NewsNav activeRegion="turkey" activePeriod="monthly" />
      <PeriodicBriefView brief={brief} region="turkey" archive={archive} />
    </div>
  );
}
