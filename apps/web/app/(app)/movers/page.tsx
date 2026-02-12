import { Suspense } from 'react';
import { isAPIConfigured, getMoversSummary, getDeltaFeed } from '@/lib/api/client';
import { normalizeDatasetRegion } from '@/lib/region';
import { MoversFeed } from './movers-feed';

function MoversLoading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="space-y-2">
        <div className="h-7 w-32 bg-muted rounded" />
        <div className="h-4 w-72 bg-muted rounded" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-[72px] rounded-lg bg-muted" />
        ))}
      </div>
      <div className="flex gap-1.5">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-7 w-20 rounded-full bg-muted" />
        ))}
      </div>
      <div className="space-y-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-[76px] rounded-lg bg-muted" />
        ))}
      </div>
    </div>
  );
}

async function MoversContent({ region }: { region: string }) {
  if (!isAPIConfigured()) {
    return (
      <div className="text-sm text-muted-foreground">
        Movers data requires a configured API connection.
      </div>
    );
  }

  try {
    const [summary, feed] = await Promise.all([
      getMoversSummary({ region, limit: 10 }),
      getDeltaFeed({ region, limit: 25 }),
    ]);
    return <MoversFeed initialSummary={summary} initialFeed={feed} region={region} />;
  } catch {
    return (
      <div className="text-sm text-muted-foreground">
        Unable to load movers data. The API may be temporarily unavailable.
      </div>
    );
  }
}

export default async function MoversPage({
  searchParams,
}: {
  searchParams: Promise<{ region?: string }>;
}) {
  const { region: rawRegion } = await searchParams;
  const region = normalizeDatasetRegion(rawRegion);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Movers</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Significant changes in startup state — funding, patterns, scores, and more.
        </p>
      </div>
      <Suspense fallback={<MoversLoading />}>
        <MoversContent region={region} />
      </Suspense>
    </div>
  );
}
