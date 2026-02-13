'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatCurrency } from '@/lib/utils';
import { timeAgo } from '@/lib/news-utils';

interface SignalRelevanceRound {
  funding_round_id: string;
  startup_id: string;
  startup_name: string;
  startup_slug: string | null;
  round_type: string;
  amount_usd: number | null;
  announced_date: string | null;
  lead_investor: string | null;
  occurrence_score: number;
  score: number;
  why?: string[];
}

interface SignalRelevancePattern {
  pattern: string;
  count: number;
  score: number;
  why?: string[];
  example_startups?: Array<{ slug: string; name: string }>;
}

interface SignalRelevanceRelatedSignal {
  signal: {
    id: string;
    claim: string;
    domain: string;
    status: string;
    conviction: number;
    momentum: number;
    impact: number;
    adoption_velocity: number;
    region: 'global' | 'turkey';
    evidence_count: number;
    unique_company_count: number;
    first_seen_at: string;
    last_evidence_at: string | null;
  };
  overlap_count: number;
  score?: number;
  why?: string[];
}

interface SignalRelevanceResponse {
  signal_id: string;
  region: 'global' | 'turkey';
  window_days: number;
  relevant_rounds: SignalRelevanceRound[];
  related_patterns: SignalRelevancePattern[];
  related_signals: SignalRelevanceRelatedSignal[];
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
      {children}
    </h3>
  );
}

export function RelevanceTab({ signalId, region }: { signalId: string; region: 'global' | 'turkey' }) {
  const [data, setData] = useState<SignalRelevanceResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const regionQS = region !== 'global' ? `?region=${encodeURIComponent(region)}` : '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const params = new URLSearchParams();
    params.set('region', region);
    params.set('window_days', '90');
    params.set('limit', '10');

    fetch(`/api/signals/${signalId}/relevance?${params.toString()}`)
      .then(r => r.json())
      .then((payload: SignalRelevanceResponse) => {
        if (cancelled) return;
        setData(payload && typeof payload === 'object' ? payload : null);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setData(null);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [signalId, region]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 max-w-3xl">
        <div className="h-3 w-32 bg-muted rounded" />
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-14 bg-muted/30 rounded-lg" />
          ))}
        </div>
        <div className="h-3 w-28 bg-muted rounded" />
        <div className="flex gap-2 flex-wrap">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-6 w-24 bg-muted/30 rounded-full" />
          ))}
        </div>
      </div>
    );
  }

  const rounds = data?.relevant_rounds || [];
  const patterns = data?.related_patterns || [];
  const signals = data?.related_signals || [];

  if (rounds.length === 0 && patterns.length === 0 && signals.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">No relevance bundle available yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-10 max-w-3xl">
      {rounds.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>Relevant Funding Rounds (90d)</SectionTitle>
          <div className="space-y-2">
            {rounds.map((r) => (
              <div
                key={r.funding_round_id}
                className="p-3 border border-border/20 rounded-lg hover:border-border/40 transition-colors bg-card"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    {r.startup_slug ? (
                      <Link
                        href={`/company/${r.startup_slug}${regionQS}`}
                        className="text-sm font-medium text-foreground hover:text-accent-info transition-colors"
                      >
                        {r.startup_name}
                      </Link>
                    ) : (
                      <p className="text-sm font-medium text-foreground">{r.startup_name}</p>
                    )}
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground/70 flex-wrap">
                      <span className="uppercase tracking-wider">{r.round_type}</span>
                      {r.amount_usd != null && r.amount_usd > 0 && (
                        <>
                          <span className="text-muted-foreground/40">·</span>
                          <span className="tabular-nums">{formatCurrency(r.amount_usd, true)}</span>
                        </>
                      )}
                      {r.lead_investor && (
                        <>
                          <span className="text-muted-foreground/40">·</span>
                          <span className="truncate">Lead: {r.lead_investor}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-[10px] text-muted-foreground/50 tabular-nums">
                    {r.announced_date ? timeAgo(r.announced_date, region) : ''}
                  </div>
                </div>
                {r.why && r.why.length > 0 && (
                  <div className="mt-2 text-[10px] text-muted-foreground/60">
                    {r.why.slice(0, 3).join(' · ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {patterns.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>Related Patterns</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {patterns.map((p) => {
              const href = region !== 'global'
                ? `/dealbook?region=${encodeURIComponent(region)}&pattern=${encodeURIComponent(p.pattern)}`
                : `/dealbook?pattern=${encodeURIComponent(p.pattern)}`;
              return (
                <Link
                  key={p.pattern}
                  href={href}
                  className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-accent-info/25 bg-accent-info/10 text-accent-info hover:bg-accent-info/15 transition-colors"
                  title={p.why?.[0] || ''}
                >
                  {p.pattern}
                  <span className="ml-1 opacity-70 tabular-nums">({p.count})</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {signals.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>Related Signals (Evidence Overlap)</SectionTitle>
          <div className="space-y-2">
            {signals.map((s) => (
              <Link
                key={s.signal.id}
                href={`/signals/${s.signal.id}${regionQS}`}
                className="block p-3 border border-border/20 rounded-lg hover:border-border/40 hover:bg-muted/10 transition-colors"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground line-clamp-2">
                      {s.signal.claim}
                    </p>
                    <div className="mt-1 text-[10px] text-muted-foreground/60 flex items-center gap-2">
                      <span className="uppercase tracking-wider">{s.signal.domain}</span>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="tabular-nums">{s.overlap_count} startups overlap</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

