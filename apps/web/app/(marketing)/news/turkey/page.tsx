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
  const edition = await getNewsEdition({ limit: 50, region: 'turkey' });
  const [topics, weeklyBrief, monthlyBrief] = await Promise.all([
    edition ? getNewsTopics({ date: edition.edition_date, limit: 24, region: 'turkey' }) : Promise.resolve([]),
    withTimeout(getPeriodicBrief({ periodType: 'weekly', region: 'turkey' }), 2000).catch(() => null),
    withTimeout(getPeriodicBrief({ periodType: 'monthly', region: 'turkey' }), 2000).catch(() => null),
  ]);

  return (
    <div className="flex h-screen flex-col bg-background">
      <NewsNav activeRegion="turkey" activePeriod="daily" />

<<<<<<< Updated upstream
      {/* Content */}
      {!edition ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="max-w-md rounded-2xl border border-border/40 bg-card/60 p-10 text-center">
            <p className="label-xs text-accent-info">Turkiye Sinyal Akisi</p>
            <h1 className="mt-3 text-3xl font-light tracking-tight text-foreground">Bulten henuz hazir degil</h1>
=======
export default async function TurkeyNewsPage({
  searchParams,
}: {
  searchParams?: { confirmed?: string; unsubscribed?: string };
}) {
  const edition = await getNewsEdition({ limit: 40, region: 'turkey' });
  const topics = await getNewsTopics({ date: edition?.edition_date, limit: 24, region: 'turkey' });
  const archive = await getNewsArchive({ limit: 30, offset: 0, region: 'turkey' });
  const sources = await getActiveNewsSources({ region: 'turkey' });

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
            <Link href="/news" className="hover:text-foreground transition-colors">Daily News</Link>
            <span className="text-accent">Turkey Feed</span>
          </div>
        </div>
      </nav>

      <main className="px-6 pb-20 pt-28">
        {!edition ? (
          <div className="mx-auto max-w-3xl rounded-2xl border border-border/40 bg-card/60 p-10 text-center">
            <p className="label-xs text-accent">Turkey Signal Feed</p>
            <h1 className="mt-3 text-3xl font-light tracking-tight text-foreground">News edition is not ready yet</h1>
>>>>>>> Stashed changes
            <p className="mt-4 text-sm text-muted-foreground">
              Ingest sureci henuz gunluk baski uretmedi.
            </p>
            <div className="mt-8 flex justify-center gap-3">
              <Link href="/" className="rounded border border-border/50 px-4 py-2 text-sm text-foreground hover:bg-muted/30">
                Ana sayfaya don
              </Link>
              <Link href="/methodology" className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90">
                Boru hatti nasil calisir
              </Link>
            </div>
          </div>
<<<<<<< Updated upstream
        </div>
      ) : (
        <>
          <div className="mx-auto w-full max-w-6xl px-6 pt-3">
            <div className="rounded-xl border border-accent-info/25 bg-accent-info/10 px-4 py-2.5 text-xs text-foreground">
              Turkiye baskisi: yerel girisim ekosisteminden siralanmis haberler, yalnizca Turkiye ile acik baglantili oldugunda global kapsam.
            </div>
=======
        ) : (
          <div className="mx-auto max-w-6xl">
            <section className="relative overflow-hidden rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/15 via-card/80 to-card/30 p-8">
              <div className="absolute -left-16 top-0 h-44 w-44 rounded-full bg-accent/20 blur-3xl" />
              <div className="absolute right-0 top-0 h-36 w-36 rounded-full bg-success/20 blur-3xl" />
              <div className="relative">
                <p className="label-xs text-accent">Turkey Signal Feed</p>
                <h1 className="mt-2 text-4xl font-light tracking-tight text-foreground">Daily Startup News</h1>
                <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                  A Turkey-specific edition built from Turkey ecosystem sources (e.g. Webrazzi, Egirisim), ranked by impact and corroboration.
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

            {statusNotice(searchParams)}

            <section className="mt-6">
              <NewsSubscriptionCard region="turkey" />
            </section>

            {edition.brief ? <DailyBriefCard brief={edition.brief} /> : null}

            <section className="mt-8">
              <TopicChipBar topics={topics} />
            </section>

            <section className="mt-6 rounded-xl border border-border/40 bg-card/60 p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Active crawl/news sources</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {sources.slice(0, 24).map((source) => (
                  <span
                    key={source.key}
                    className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    {source.name}
                    <span className="opacity-60">({source.type})</span>
                  </span>
                ))}
              </div>
            </section>

            <section className="mt-8 grid gap-4 lg:grid-cols-5">
              {edition.items[0] ? (
                <div className="lg:col-span-3">
                  <NewsHeroCard item={edition.items[0]} />
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-2">
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

            <section className="mt-8 grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <div className="rounded-2xl border border-border/40 bg-card/60 p-5">
                  <p className="label-xs text-accent">Want the Global digest?</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Subscribe on the Global page.
                  </p>
                  <Link href="/news" className="mt-3 inline-flex text-sm text-accent hover:text-accent/80">
                    Open Global Daily News
                  </Link>
                </div>
              </div>
              <ArchiveTimeline initialItems={archive} pageSize={20} />
            </section>
>>>>>>> Stashed changes
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
