import Link from 'next/link';
import { Suspense } from 'react';
import { getNewsEdition, getNewsTopics, getPeriodicBrief } from '@/lib/data/news';
import { InteractiveRadar } from '@/components/news/interactive-radar';
import { NewsNav } from '@/components/news/news-nav';
import { withTimeout } from '@/lib/with-timeout';

export const dynamic = 'force-dynamic';

function briefToPreview(brief: Awaited<ReturnType<typeof getPeriodicBrief>>) {
  if (!brief) return null;
  return {
    period_type: brief.period_type,
    period_start: brief.period_start,
    period_end: brief.period_end,
    title: brief.title,
    story_count: brief.story_count,
    executive_summary: brief.narrative?.executive_summary ?? undefined,
  };
}

export default async function TurkeySignalFeedPage() {
  const edition = await getNewsEdition({ limit: 40, region: 'turkey' });
  const [topics, weeklyBrief, monthlyBrief] = await Promise.all([
    edition ? getNewsTopics({ date: edition.edition_date, limit: 24, region: 'turkey' }) : Promise.resolve([]),
    withTimeout(getPeriodicBrief({ periodType: 'weekly', region: 'turkey' }), 2000).catch(() => null),
    withTimeout(getPeriodicBrief({ periodType: 'monthly', region: 'turkey' }), 2000).catch(() => null),
  ]);

  return (
    <div className="flex h-screen flex-col bg-background">
      <NewsNav activeRegion="turkey" activePeriod="daily" />

      {/* Content */}
      {!edition ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="max-w-md rounded-2xl border border-border/40 bg-card/60 p-10 text-center">
            <p className="label-xs text-accent-info">Turkey Signal Feed</p>
            <h1 className="mt-3 text-3xl font-light tracking-tight text-foreground">No edition available</h1>
            <p className="mt-4 text-sm text-muted-foreground">
              The ingestion workflow has not produced a daily edition yet.
            </p>
            <div className="mt-8 flex justify-center gap-3">
              <Link href="/" className="rounded border border-border/50 px-4 py-2 text-sm text-foreground hover:bg-muted/30">
                Back to Home
              </Link>
              <Link href="/methodology" className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90">
                How the pipeline works
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="mx-auto w-full max-w-6xl px-6 pt-3">
            <div className="rounded-xl border border-accent-info/25 bg-accent-info/10 px-4 py-2.5 text-xs text-foreground">
              Turkey edition: ranked stories from the local startup ecosystem, plus global coverage when it is explicitly Turkey-related.
            </div>
          </div>
          <Suspense fallback={null}>
            <InteractiveRadar
              initialEdition={edition}
              initialTopics={topics}
              region="turkey"
              periodicBriefs={{ weeklyBrief: briefToPreview(weeklyBrief), monthlyBrief: briefToPreview(monthlyBrief) }}
            />
          </Suspense>
        </>
      )}
    </div>
  );
}
