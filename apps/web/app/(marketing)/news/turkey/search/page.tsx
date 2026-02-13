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
          <p className="label-xs text-accent-info">Turkiye Haber Istihbarati</p>
          <h1 className="mt-2 text-3xl font-light tracking-tight text-foreground">Ara</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground leading-relaxed">
            Tum Turkiye haber kapsaminda arayin. Haber tipi, tarih araligi veya konuya gore filtreleyin.
          </p>
          <div className="mt-4">
            <Link
              href="/news/turkey"
              className="inline-flex items-center gap-1 text-sm text-accent-info hover:text-accent-info/80 transition-colors"
            >
              Canli akisa don
            </Link>
          </div>
        </div>
        <NewsSearchView region="turkey" />
      </div>
    </div>
  );
}
