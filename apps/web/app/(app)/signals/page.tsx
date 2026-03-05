import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { InteractiveSignals } from './interactive-signals';
import { getSignalsSummary, isAPIConfigured } from '@/lib/api/client';
import type { SignalsSummaryResponse } from '@/lib/api/types';
import { normalizeDatasetRegion } from '@/lib/region';

const DISABLE_STATIC_FALLBACK = process.env.NEXT_PUBLIC_SIGNALS_DISABLE_STATIC_FALLBACK !== 'false';

function emptySummary(staleReason: string): SignalsSummaryResponse {
  return {
    rising: [],
    established: [],
    decaying: [],
    stats: { total: 0, by_status: {}, by_domain: {} },
    stale: true,
    stale_reason: staleReason,
    last_pipeline_run_at: null,
  };
}

async function SignalsContent({ region }: { region?: string }) {
  const normalizedRegion = normalizeDatasetRegion(region);
  const legacyHref = normalizedRegion === 'global'
    ? '/signals/legacy'
    : `/signals/legacy?region=${encodeURIComponent(normalizedRegion)}`;

  if (!isAPIConfigured()) {
    if (!DISABLE_STATIC_FALLBACK) {
      redirect(legacyHref);
    }
    return (
      <InteractiveSignals
        mode="dynamic"
        dynamicSignals={emptySummary('Signal API is not configured in this environment.')}
        region={normalizedRegion}
      />
    );
  }

  try {
    const summary = await getSignalsSummary(normalizedRegion);
    if (!DISABLE_STATIC_FALLBACK && summary.stats.total === 0) {
      redirect(legacyHref);
    }
    return (
      <InteractiveSignals
        mode="dynamic"
        dynamicSignals={summary}
        region={normalizedRegion}
      />
    );
  } catch {
    if (!DISABLE_STATIC_FALLBACK) {
      redirect(legacyHref);
    }
    return (
      <InteractiveSignals
        mode="dynamic"
        dynamicSignals={emptySummary('Unable to fetch latest signal pipeline state.')}
        region={normalizedRegion}
      />
    );
  }
}

function SignalsLoading() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="space-y-4">
        <div className="h-3 w-24 bg-muted rounded" />
        <div className="h-8 w-3/4 bg-muted rounded" />
        <div className="h-4 w-1/2 bg-muted rounded" />
      </div>
      <div className="h-px bg-border" />
      <div className="space-y-8">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="py-8 border-b border-border/30">
            <div className="h-6 w-1/3 bg-muted rounded mb-4" />
            <div className="h-16 w-2/3 bg-muted rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<{ region?: string }>;
}) {
  const { region } = await searchParams;
  return (
    <Suspense fallback={<SignalsLoading />}>
      <SignalsContent region={region} />
    </Suspense>
  );
}
