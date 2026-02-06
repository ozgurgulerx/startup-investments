import Link from 'next/link';
import { getNewsEdition, getNewsTopics } from '@/lib/data/news';
import { NewsHeroCard } from '@/components/news/news-hero-card';
import { NewsCard } from '@/components/news/news-card';
import { TopicChipBar } from '@/components/news/topic-chip-bar';

export const dynamic = 'force-dynamic';

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

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default async function DailyNewsPage() {
  const edition = await getNewsEdition({ limit: 40 });
  const topics = await getNewsTopics({ date: edition?.edition_date, limit: 24 });

  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed left-0 right-0 top-0 z-50 border-b border-border/30 bg-background/95 backdrop-blur-sm">
        <div className="absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r from-accent/60 via-accent to-accent/60" />
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-accent" />
            <span className="text-base font-medium tracking-tight text-foreground">Build Atlas</span>
          </Link>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
            <Link href="/methodology" className="hover:text-foreground transition-colors">Methodology</Link>
            <span className="text-accent">Daily News</span>
          </div>
        </div>
      </nav>

      <main className="px-6 pb-20 pt-28">
        {!edition ? (
          <div className="mx-auto max-w-3xl rounded-2xl border border-border/40 bg-card/60 p-10 text-center">
            <p className="label-xs text-accent">Daily Startup News</p>
            <h1 className="mt-3 text-3xl font-light tracking-tight text-foreground">News edition is not ready yet</h1>
            <p className="mt-4 text-sm text-muted-foreground">
              The ingestion workflow has not produced a daily edition yet. Run the news ingest workflow or check database connectivity.
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
        ) : (
          <div className="mx-auto max-w-6xl">
            <section className="relative overflow-hidden rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/15 via-card/80 to-card/30 p-8">
              <div className="absolute -left-16 top-0 h-44 w-44 rounded-full bg-accent/20 blur-3xl" />
              <div className="absolute right-0 top-0 h-36 w-36 rounded-full bg-success/20 blur-3xl" />
              <div className="relative">
                <p className="label-xs text-accent">Live Startup Intelligence</p>
                <h1 className="mt-2 text-4xl font-light tracking-tight text-foreground">Daily Startup News</h1>
                <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                  High-signal startup news clustered across global sources, ranked by freshness, trust score, and cross-source corroboration.
                </p>

                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-border/40 bg-background/70 p-3">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Edition Date</p>
                    <p className="mt-1 text-sm font-medium text-foreground">{formatEditionDate(edition.edition_date)}</p>
                  </div>
                  <div className="rounded-lg border border-border/40 bg-background/70 p-3">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Story Clusters</p>
                    <p className="mt-1 text-sm font-medium text-foreground tabular-nums">{edition.stats.total_clusters}</p>
                  </div>
                  <div className="rounded-lg border border-border/40 bg-background/70 p-3">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Last Refresh</p>
                    <p className="mt-1 text-sm font-medium text-foreground">{formatTimestamp(edition.generated_at)}</p>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Link href={`/news/${edition.edition_date}`} className="rounded-full border border-border/40 px-3 py-1 hover:border-accent/35 hover:text-foreground">
                    View date archive
                  </Link>
                </div>
              </div>
            </section>

            <section className="mt-8">
              <TopicChipBar topics={topics} />
            </section>

            <section className="mt-8 grid gap-4 lg:grid-cols-5">
              {edition.items[0] ? (
                <div className="lg:col-span-3">
                  <NewsHeroCard item={edition.items[0]} />
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-1">
                {edition.items.slice(1, 5).map((item) => (
                  <NewsCard key={item.id} item={item} />
                ))}
              </div>
            </section>

            <section className="mt-8 grid gap-4 md:grid-cols-2">
              {edition.items.slice(5).map((item) => (
                <NewsCard key={item.id} item={item} />
              ))}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
