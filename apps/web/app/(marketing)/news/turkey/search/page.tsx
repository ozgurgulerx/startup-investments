import Link from 'next/link';
import { NewsNav } from '@/components/news/news-nav';
import { NewsSearchView } from '@/components/news/news-search-view';

export const dynamic = 'force-dynamic';

export default function TurkeyNewsSearchPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NewsNav activeRegion="turkey" activePeriod="daily" />
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <div className="mb-8">
          <p className="label-xs text-accent-info">Turkey News Intelligence</p>
          <h1 className="mt-2 text-3xl font-light tracking-tight text-foreground">Search</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground leading-relaxed">
            Search across all Turkey news coverage. Filter by story type, date range, or topic.
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
        <NewsSearchView region="turkey" />
      </div>
    </div>
  );
}
