import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getNewsArchive, getNewsEdition, getNewsTopics } from '@/lib/data/news';
import { sectionNewsItems } from '@/lib/news/section-items';
import { NewsHeroCard } from '@/components/news/news-hero-card';
import { NewsCard } from '@/components/news/news-card';
import { SectionHeader } from '@/components/news/section-header';
import { BreakingSection } from '@/components/news/breaking-section';
import { TopicTabSection } from '@/components/news/topic-tab-section';
import { TopicChipBar } from '@/components/news/topic-chip-bar';
import { ArchiveTimeline } from '@/components/news/archive-timeline';
import { DailyBriefCard } from '@/components/news/daily-brief-card';
import { NewsSubscriptionCard } from '@/components/news/news-subscription-card';

export const dynamic = 'force-dynamic';

interface NewsArchivePageProps {
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

export default async function NewsArchivePage({ params }: NewsArchivePageProps) {
  if (!isValidDateParam(params.date)) {
    notFound();
  }

  const edition = await getNewsEdition({ date: params.date, limit: 40 });
  if (!edition) {
    notFound();
  }

  const topics = await getNewsTopics({ date: edition.edition_date, limit: 24 });
  const archive = await getNewsArchive({ limit: 20, offset: 0 });
  const sections = sectionNewsItems(edition.items, edition.generated_at);

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-6xl px-6 pb-16 pt-12">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="label-xs text-accent">Archive Edition</p>
            <h1 className="mt-2 text-3xl font-light tracking-tight text-foreground">{formatEditionDate(edition.edition_date)}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Snapshot of ranked startup stories for this date.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Link href="/news" className="rounded border border-border/50 px-3 py-1.5 text-foreground hover:bg-muted/30">
              Latest Edition
            </Link>
            <Link href="/" className="rounded border border-border/50 px-3 py-1.5 text-foreground hover:bg-muted/30">
              Home
            </Link>
          </div>
        </div>

        <section className="rounded-xl border border-border/40 bg-card/60 p-4">
          <TopicChipBar topics={topics} />
        </section>

        {edition.brief ? <DailyBriefCard brief={edition.brief} /> : null}

        {/* Top Stories */}
        {sections.topStories.length > 0 && (
          <section className="mt-6">
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
          <section className="mt-6">
            <BreakingSection items={sections.breaking} />
          </section>
        )}

        {/* Deep Reads */}
        {sections.deepReads.length > 0 && (
          <section className="mt-6">
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
          <section id="by-topic" className="mt-6">
            <SectionHeader label="By Topic" />
            <TopicTabSection byTopic={sections.byTopic} topicOrder={sections.topicOrder} />
          </section>
        )}

        {/* More Stories */}
        {sections.remaining.length > 0 && (
          <section className="mt-6">
            <SectionHeader label="More Stories" count={sections.remaining.length} />
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {sections.remaining.map((item) => (
                <NewsCard key={item.id} item={item} />
              ))}
            </div>
          </section>
        )}

        <section className="mt-8">
          <NewsSubscriptionCard />
        </section>

        <section className="mt-8">
          <ArchiveTimeline initialItems={archive} pageSize={20} />
        </section>
      </main>
    </div>
  );
}
