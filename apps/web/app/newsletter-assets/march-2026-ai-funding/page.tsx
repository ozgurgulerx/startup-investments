import type { Metadata } from 'next';
import { Source_Serif_4, Space_Grotesk } from 'next/font/google';
import fundingPack from '@/data/linkedin/march-2026-ai-funding-pack.json';
import { LinkedinFundingArtboards } from '@/components/newsletter/linkedin-funding-artboards';
import type { LinkedinFundingPackData } from '@/lib/linkedin-funding-pack';

const display = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
});

const serif = Source_Serif_4({
  subsets: ['latin'],
  weight: ['400', '600'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'March 2026 AI Funding Artboards',
  description:
    'White-background editorial visuals for a LinkedIn newsletter, built from a processed March 2026 AI funding workbook.',
};

export default async function March2026AiFundingPage({
  searchParams,
}: {
  searchParams: Promise<{ asset?: string }>;
}) {
  const { asset } = await searchParams;

  return (
    <LinkedinFundingArtboards
      data={fundingPack as LinkedinFundingPackData}
      asset={asset}
      displayClassName={display.className}
      serifClassName={serif.className}
    />
  );
}
