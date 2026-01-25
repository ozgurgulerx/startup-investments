import { Suspense } from 'react';
import { IntelligenceBrief } from '@/components/features';
import { getMonthlyBrief } from '@/lib/data/generate-monthly-brief';
import { getAvailablePeriods } from '@/lib/data';

const DEFAULT_PERIOD = '2026-01';

async function BriefContent() {
  const [brief, allPeriods] = await Promise.all([
    getMonthlyBrief(DEFAULT_PERIOD),
    getAvailablePeriods(),
  ]);

  // Filter to periods with newsletters/briefs
  const availablePeriods = allPeriods
    .filter(p => p.has_newsletter)
    .map(p => p.period);

  return (
    <IntelligenceBrief
      initialBrief={brief}
      availablePeriods={availablePeriods}
    />
  );
}

function BriefLoading() {
  return (
    <div className="animate-pulse space-y-8">
      {/* Header skeleton */}
      <div className="space-y-4">
        <div className="h-8 w-48 bg-muted rounded" />
        <div className="h-12 w-3/4 bg-muted rounded" />
        <div className="h-6 w-1/2 bg-muted rounded" />
      </div>

      {/* Metrics skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="p-4 border border-border/30 rounded-lg">
            <div className="h-8 w-20 bg-muted rounded mb-2" />
            <div className="h-4 w-16 bg-muted rounded" />
          </div>
        ))}
      </div>

      {/* Sections skeleton */}
      {[...Array(4)].map((_, i) => (
        <div key={i} className="space-y-4">
          <div className="h-6 w-40 bg-muted rounded" />
          <div className="h-24 bg-muted rounded" />
        </div>
      ))}
    </div>
  );
}

export default function BriefPage() {
  return (
    <Suspense fallback={<BriefLoading />}>
      <BriefContent />
    </Suspense>
  );
}
