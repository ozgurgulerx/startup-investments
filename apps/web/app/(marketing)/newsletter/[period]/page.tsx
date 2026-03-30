import { notFound } from 'next/navigation';
import { promises as fs } from 'fs';
import path from 'path';
import { NewsNav } from '@/components/news/news-nav';
import { NewsletterContent } from './newsletter-content';

interface Params {
  period: string;
}

async function getNewsletterData(period: string) {
  const dataRoot = process.env.DATA_PATH || path.join(process.cwd(), 'data');
  const dataPath = path.join(
    dataRoot,
    period,
    'output',
    'newsletter_data.json'
  );

  try {
    const raw = await fs.readFile(dataPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { period } = await params;
  return {
    title: `AI Landscape Newsletter — ${period} | BuildAtlas`,
    description: `Monthly AI funding landscape report for ${period}. Capital flows, build patterns, and builder takeaways from hundreds of funded AI startups.`,
  };
}

export default async function NewsletterPage({ params }: { params: Promise<Params> }) {
  const { period } = await params;
  const data = await getNewsletterData(period);

  if (!data) {
    notFound();
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NewsNav activeRegion="global" activePeriod="monthly" />

      <main className="flex-1 px-4 sm:px-6 py-8">
        <div className="max-w-4xl mx-auto">
          <NewsletterContent data={data} />
        </div>
      </main>
    </div>
  );
}
