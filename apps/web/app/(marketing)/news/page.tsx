import Link from 'next/link';
import { Suspense } from 'react';
import { getNewsEdition, getNewsTopics } from '@/lib/data/news';
import { InteractiveRadar } from '@/components/news/interactive-radar';

export const dynamic = 'force-dynamic';

export default async function DailyNewsPage() {
  const edition = await getNewsEdition({ limit: 40 });
  const topics = edition
    ? await getNewsTopics({ date: edition.edition_date, limit: 24 })
    : [];

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Nav */}
      <nav className="shrink-0 border-b border-border/30 bg-background/95 backdrop-blur-sm">
        <div className="absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r from-accent/60 via-accent to-accent/60" />
        <div className="mx-auto flex h-14 max-w-[1680px] items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-accent" />
            <span className="text-base font-medium tracking-tight text-foreground">Build Atlas</span>
          </Link>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link href="/methodology" className="hover:text-foreground transition-colors">Methodology</Link>
            <div className="flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/15 p-0.5">
              <Link
                href="/news"
                className="rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider text-accent-info bg-accent-info/10 border border-accent-info/25"
              >
                Global
              </Link>
              <Link
                href="/news/turkey"
                className="rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-muted/25 transition-colors"
              >
                Turkey
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Content */}
      {!edition ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="max-w-md rounded-2xl border border-border/40 bg-card/60 p-10 text-center">
            <p className="label-xs text-accent-info">Signal Feed</p>
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
        <Suspense fallback={null}>
          <InteractiveRadar initialEdition={edition} initialTopics={topics} />
        </Suspense>
      )}
    </div>
  );
}
