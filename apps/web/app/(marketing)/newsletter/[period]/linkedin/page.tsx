import { notFound } from 'next/navigation';
import { promises as fs } from 'fs';
import path from 'path';
import { LinkedInExport } from './linkedin-export';

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
    title: `LinkedIn Export — ${period} | BuildAtlas`,
  };
}

export default async function LinkedInPage({ params }: { params: Promise<Params> }) {
  const { period } = await params;
  const data = await getNewsletterData(period);

  if (!data) {
    notFound();
  }

  return <LinkedInExport data={data} />;
}
