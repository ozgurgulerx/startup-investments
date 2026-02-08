import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getNewsEdition, getNewsTopics } from '@/lib/data/news';
import { InteractiveRadar } from '@/components/news/interactive-radar';
import { NewsNav } from '@/components/news/news-nav';

export const dynamic = 'force-dynamic';

interface TurkeyNewsArchivePageProps {
  params: {
    date: string;
  };
}

function isValidDateParam(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
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
      <NewsNav activeRegion="turkey" activePeriod="daily" archiveDate={edition.edition_date} />

      <Suspense fallback={null}>
        <InteractiveRadar initialEdition={edition} initialTopics={topics} isArchive region="turkey" />
      </Suspense>
    </div>
  );
}
