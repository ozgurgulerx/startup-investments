import Link from 'next/link';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getNewsEdition, getNewsTopics } from '@/lib/data/news';
import { InteractiveRadar } from '@/components/news/interactive-radar';

export const dynamic = 'force-dynamic';

interface TurkeyNewsArchivePageProps {
  params: {
    date: string;
  };
}

function isValidDateParam(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatEditionDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default async function TurkeyNewsArchivePage({ params }: TurkeyNewsArchivePageProps) {
  if (!isValidDateParam(params.date)) {
    notFound();
  }

  const edition = await getNewsEdition({ date: params.date, limit: 40, region: 'turkey' });
  if (!edition) {
    notFound();
  }

  const topics = await getNewsTopics({ date: edition.edition_date, limit: 24, region: 'turkey' });

  return (
    <div className="flex h-screen flex-col bg-background">
      <nav className="shrink-0 border-b border-border/30 bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-accent" />
            <span className="text-base font-medium tracking-tight text-foreground">Build Atlas</span>
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">{formatEditionDate(edition.edition_date)}</span>
            <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/15 p-0.5">
              <Link
                href={`/news/${edition.edition_date}`}
                className="rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-muted/25 transition-colors"
              >
                Global
              </Link>
              <Link
                href={`/news/turkey/${edition.edition_date}`}
                className="rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider text-accent-info bg-accent-info/10 border border-accent-info/25"
              >
                Turkey
              </Link>
            </div>
            <Link
              href="/news/turkey/archive"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Archive
            </Link>
            <Link
              href="/news/turkey"
              className="rounded border border-border/50 px-3 py-1.5 text-foreground hover:bg-muted/30 transition-colors"
            >
              Latest Turkey Edition
            </Link>
          </div>
        </div>
      </nav>

      <Suspense fallback={null}>
        <InteractiveRadar initialEdition={edition} initialTopics={topics} isArchive region="turkey" />
      </Suspense>
    </div>
  );
}
