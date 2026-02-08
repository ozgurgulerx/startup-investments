import Link from 'next/link';
import { getNewsArchive } from '@/lib/data/news';
import { ArchiveTimeline } from '@/components/news/archive-timeline';
import { NewsNav } from '@/components/news/news-nav';

export const dynamic = 'force-dynamic';

export default async function TurkeyNewsArchivePage() {
  const archive = await getNewsArchive({ limit: 60, region: 'turkey' });

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NewsNav activeRegion="turkey" activePeriod="daily" />

      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <p className="label-xs text-accent-info">Daily Editions</p>
          <h1 className="mt-2 text-3xl font-light tracking-tight text-foreground">Archive</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground leading-relaxed">
            Browse past Turkey daily editions to see how the local startup ecosystem evolved.
            Each entry links to the full edition with all stories and analysis.
          </p>
          <div className="mt-4">
            <Link
              href="/news/turkey"
              className="inline-flex items-center gap-1 text-sm text-accent-info hover:text-accent-info/80 transition-colors"
            >
              Back to live feed
            </Link>
          </div>
        </div>

        <ArchiveTimeline
          initialItems={archive}
          pageSize={30}
          region="turkey"
          hrefPrefix="/news/turkey"
        />
      </div>
    </div>
  );
}
