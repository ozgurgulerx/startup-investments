import Link from 'next/link';
import { getLatestNewsEditionDate, getNewsEdition, getNewsTopics } from '@/lib/data/news';
import { PageContainer } from '@/components/layout/page-container';
import { NewsHeroCard } from '@/components/news/news-hero-card';
import { NewsCard } from '@/components/news/news-card';
import { TopicChipBar } from '@/components/news/topic-chip-bar';
import { NewsSubscriptionCard } from '@/components/news/news-subscription-card';
import { NewsNav } from '@/components/news/news-nav';

export const dynamic = 'force-dynamic';

interface TopicNewsPageProps {
  params: {
    topic: string;
  };
  searchParams?: {
    date?: string;
  };
}

function normalizeTopic(value: string): string {
  try {
    return decodeURIComponent(value || '').trim();
  } catch {
    return (value || '').trim();
  }
}

export default async function TopicNewsPage({ params, searchParams }: TopicNewsPageProps) {
  const topic = normalizeTopic(params.topic);
  const dateParam = searchParams?.date;
  const fallbackDate = dateParam || (await getLatestNewsEditionDate()) || undefined;
  const edition = await getNewsEdition({ date: fallbackDate, topic, limit: 40 });
  const topics = await getNewsTopics({ date: fallbackDate, limit: 24 });

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <NewsNav activeRegion="global" activePeriod="daily" />
      <main className="flex-1 pb-16 pt-12">
        <PageContainer>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="label-xs text-accent-info">Topic Lens</p>
            <h1 className="mt-2 text-3xl font-light tracking-tight text-foreground">{topic || 'Startup'} News</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Ranked stories for the selected topic from the latest generated edition.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Link href="/news" className="rounded border border-border/50 px-3 py-1.5 text-foreground hover:bg-muted/30">
              All News
            </Link>
            <Link href="/" className="rounded border border-border/50 px-3 py-1.5 text-foreground hover:bg-muted/30">
              Home
            </Link>
          </div>
        </div>

        <section className="rounded-xl border border-border/40 bg-card/60 p-4">
          <TopicChipBar topics={topics} activeTopic={topic} />
        </section>

        {!edition || edition.items.length === 0 ? (
          <section className="mt-6 rounded-2xl border border-border/40 bg-card/60 p-8 text-center">
            <h2 className="text-xl font-medium text-foreground">No stories found for this topic</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Try another topic from the chip bar or view the full daily feed.
            </p>
          </section>
        ) : (
          <>
            <section className="mt-6 grid gap-4 lg:grid-cols-5">
              <div className="lg:col-span-3">
                <NewsHeroCard item={edition.items[0]} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-2">
                {edition.items.slice(1, 5).map((item) => (
                  <NewsCard key={item.id} item={item} />
                ))}
              </div>
            </section>

            <section className="mt-6 grid gap-4 md:grid-cols-2">
              {edition.items.slice(5).map((item) => (
                <NewsCard key={item.id} item={item} />
              ))}
            </section>

            <section className="mt-8">
              <NewsSubscriptionCard region="global" />
            </section>
          </>
        )}
        </PageContainer>
      </main>
    </div>
  );
}
