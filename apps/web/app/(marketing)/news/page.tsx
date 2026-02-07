import Link from 'next/link';
import { getNewsArchive, getNewsEdition, getNewsTopics } from '@/lib/data/news';
import { sectionNewsItems } from '@/lib/news/section-items';
import { NewsHeroCard } from '@/components/news/news-hero-card';
import { NewsCard } from '@/components/news/news-card';
import { SectionHeader } from '@/components/news/section-header';
import { BreakingSection } from '@/components/news/breaking-section';
import { TopicTabSection } from '@/components/news/topic-tab-section';
import { TopicChipBar } from '@/components/news/topic-chip-bar';
import { ArchiveTimeline } from '@/components/news/archive-timeline';
import { NewsSubscriptionCard } from '@/components/news/news-subscription-card';
import { DailyBriefCard } from '@/components/news/daily-brief-card';

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
  const archive = await getNewsArchive({ limit: 30, offset: 0 });

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
            {/* Hero masthead */}
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

            {edition.brief ? <DailyBriefCard brief={edition.brief} /> : null}

            <section className="mt-8">
              <TopicChipBar topics={topics} />
            </section>

            {/* Editorial sections */}
            <EditorialSections edition={edition} />

            {/* Footer */}
            <section className="mt-8 grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <NewsSubscriptionCard />
              </div>
              <ArchiveTimeline initialItems={archive} pageSize={20} />
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function EditorialSections({
  edition,
}: {
  edition: NonNullable<Awaited<ReturnType<typeof getNewsEdition>>>;
}) {
  const sections = sectionNewsItems(edition.items, edition.generated_at);

  return (
    <>
      {/* Top Stories */}
      {sections.topStories.length > 0 && (
        <section className="mt-8">
          <SectionHeader label="Top Stories" count={sections.topStories.length} />
          <div className="mt-4 grid gap-4 lg:grid-cols-5">
            {sections.topStories[0] && (
              <div className="lg:col-span-3">
                <NewsHeroCard item={sections.topStories[0]} />
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-2">
              {sections.topStories.slice(1).map((item) => (
                <NewsCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Breaking */}
      {sections.breaking.length > 0 && (
        <section className="mt-8">
          <BreakingSection items={sections.breaking} />
        </section>
      )}

      {/* Deep Reads */}
      {sections.deepReads.length > 0 && (
        <section className="mt-8">
          <SectionHeader label="Deep Reads" indicator="signal" count={sections.deepReads.length} />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {sections.deepReads.map((item) => (
              <NewsCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* By Topic */}
      {sections.topicOrder.length > 0 && (
        <section id="by-topic" className="mt-8">
          <SectionHeader label="By Topic" />
          <TopicTabSection byTopic={sections.byTopic} topicOrder={sections.topicOrder} />
        </section>
      )}

      {/* More Stories */}
      {sections.remaining.length > 0 && (
        <section className="mt-8">
          <SectionHeader label="More Stories" count={sections.remaining.length} />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {sections.remaining.map((item) => (
              <NewsCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
