import { Suspense } from 'react';
import { getDeepDive } from '@/lib/api/client';
import { DeepDivePage } from './deep-dive-page';

function DeepDiveLoading() {
  return (
    <div className="animate-pulse space-y-8 max-w-6xl mx-auto">
      <div className="h-4 w-20 bg-muted rounded" />
      <div className="space-y-3">
        <div className="h-3 w-32 bg-muted rounded" />
        <div className="h-8 w-3/4 bg-muted rounded" />
        <div className="h-4 w-1/2 bg-muted rounded" />
      </div>
      <div className="flex gap-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-9 w-28 bg-muted rounded-full" />
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-24 bg-muted rounded-lg" />
        ))}
      </div>
    </div>
  );
}

async function DeepDiveContent({ id }: { id: string }) {
  try {
    const data = await getDeepDive(id);

    if (!data.deep_dive || !data.signal) {
      return (
        <div className="max-w-6xl mx-auto py-12 text-center">
          <p className="text-muted-foreground">No deep dive available for this signal yet.</p>
          <p className="text-sm text-muted-foreground/60 mt-2">
            Deep dives are generated weekly for signals with sufficient evidence.
          </p>
        </div>
      );
    }

    return <DeepDivePage data={data} />;
  } catch {
    return (
      <div className="max-w-6xl mx-auto py-12 text-center">
        <p className="text-muted-foreground">Failed to load deep dive.</p>
      </div>
    );
  }
}

export default async function SignalDeepDivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={<DeepDiveLoading />}>
      <DeepDiveContent id={id} />
    </Suspense>
  );
}
