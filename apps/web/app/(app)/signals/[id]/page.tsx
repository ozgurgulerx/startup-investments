import { Suspense } from 'react';
import Link from 'next/link';
import { getDeepDive } from '@/lib/api/client';
import { DeepDivePage } from './deep-dive-page';
import { STATUS_STYLES, DOMAIN_LABELS } from './types';
import { ExplorerTab } from './explorer-tab';
import { cn } from '@/lib/utils';

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

    if (!data.signal) {
      return (
        <div className="max-w-6xl mx-auto py-12 text-center">
          <p className="text-muted-foreground">Signal not found.</p>
        </div>
      );
    }

    if (!data.deep_dive) {
      const signal = data.signal;
      const meta = data.meta || null;
      const statusStyle = STATUS_STYLES[signal.status] || STATUS_STYLES.candidate;
      const domainLabel = DOMAIN_LABELS[signal.domain] || signal.domain;

      const startupsEligible = meta?.startups_eligible ?? 0;
      const startupsWithEvidence = meta?.startups_with_evidence ?? signal.unique_company_count ?? 0;
      const unlinkedEvidence = meta?.unlinked_evidence_count ?? 0;
      const occurrencesTotal = meta?.occurrences_total ?? 0;

      const reasons: string[] = [];
      if (meta?.schema_missing) {
        reasons.push('Deep-dive schema is not available yet (migration pending).');
      }
      if (signal.status === 'candidate') {
        reasons.push('Deep dives are only generated for Emerging / Accelerating / Established signals.');
      }
      if (startupsEligible < 2) {
        reasons.push(`This signal currently has ${startupsEligible} startups with enough linked evidence (need at least 2).`);
      } else {
        reasons.push('Deep dives are generated daily at 05:15 UTC for a rotating set of top signals by conviction.');
      }
      if (unlinkedEvidence > 0) {
        reasons.push(`${unlinkedEvidence} evidence items are not linked to a startup yet (trend-level evidence).`);
      }
      if (meta?.latest_status && meta.latest_status !== 'ready') {
        reasons.push(`Latest deep-dive attempt status: ${meta.latest_status}.`);
      }
      if (occurrencesTotal === 0) {
        reasons.push('Explorer requires per-startup occurrence scoring; none are available yet for this signal.');
      }

      return (
        <div className="max-w-6xl mx-auto py-10 space-y-8">
          <div className="space-y-4">
            <Link
              href="/signals"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Signals
            </Link>

            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={cn(
                  'px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded-full',
                  statusStyle.bg,
                  statusStyle.text
                )}
              >
                {statusStyle.label}
              </span>
              <span className="px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded-full bg-muted/30 text-muted-foreground">
                {domainLabel}
              </span>
              <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-muted/20 text-muted-foreground">
                Deep Dive pending
              </span>
            </div>

            <div className="space-y-2">
              <h1 className="text-xl md:text-2xl font-light text-foreground leading-tight">
                {signal.claim}
              </h1>
              {signal.explain?.definition && (
                <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl">
                  {signal.explain.definition}
                </p>
              )}
            </div>

            <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground/70">
              <span>
                Evidence: <span className="text-foreground/80 tabular-nums">{signal.evidence_count}</span>
              </span>
              <span>
                Startups linked: <span className="text-foreground/80 tabular-nums">{startupsWithEvidence}</span>
              </span>
            </div>
          </div>

          <div className="p-4 border border-border/30 rounded-lg bg-card space-y-2">
            <p className="text-sm text-foreground">No deep dive available for this signal yet.</p>
            {reasons.length > 0 && (
              <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1">
                {reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
              Explorer
            </p>
            <ExplorerTab signalId={signal.id} />
          </div>
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
