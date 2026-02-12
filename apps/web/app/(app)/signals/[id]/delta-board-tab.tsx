'use client';

import { TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';
import { KpiCard } from '@/components/ui/kpi-card';
import type { SignalItem, DeepDiveContent } from '@/lib/api/client';

interface DeltaBoardTabProps {
  signal: SignalItem;
  content: DeepDiveContent;
  diff: { diff_json: Record<string, any> } | null;
}

export function DeltaBoardTab({ signal, content, diff }: DeltaBoardTabProps) {
  const diffData = diff?.diff_json || {};

  return (
    <div className="space-y-8">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Companies tracked"
          value={String(signal.unique_company_count)}
          trend={diffData.samples_added?.length ? {
            value: diffData.samples_added.length,
            isPositive: true,
            suffix: ' new',
          } : undefined}
        />
        <KpiCard
          label="Conviction"
          value={`${(signal.conviction * 100).toFixed(0)}%`}
        />
        <KpiCard
          label="Evidence items"
          value={String(signal.evidence_count)}
        />
        <KpiCard
          label="Momentum"
          value={`${signal.momentum >= 0 ? '+' : ''}${(signal.momentum * 100).toFixed(0)}%`}
        />
      </div>

      {/* TLDR */}
      {content.tldr && (
        <div className="p-4 border border-border/30 rounded-lg bg-card">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2">
            Summary
          </p>
          <p className="text-sm text-foreground leading-relaxed">
            {content.tldr}
          </p>
        </div>
      )}

      {/* Watchlist - companies to watch */}
      {content.watchlist && content.watchlist.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
            Watchlist
          </h3>
          <div className="space-y-2">
            {content.watchlist.map((item, i) => (
              <div
                key={i}
                className="flex items-start gap-3 p-3 border border-border/20 rounded-lg hover:border-border/40 transition-colors"
              >
                <TrendingUp className="w-4 h-4 text-accent-info mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <a
                    href={`/company/${item.startup_slug}`}
                    className="text-sm font-medium text-foreground hover:text-accent-info transition-colors"
                  >
                    {item.startup_slug}
                  </a>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {item.why}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Patterns / Archetypes preview */}
      {content.patterns && content.patterns.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
            Archetypes Identified
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {content.patterns.map((pattern, i) => (
              <div
                key={i}
                className="p-3 border border-border/20 rounded-lg"
              >
                <p className="text-sm font-medium text-foreground">
                  {pattern.archetype}
                </p>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {pattern.description}
                </p>
                {pattern.startups.length > 0 && (
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {pattern.startups.slice(0, 3).map((slug) => (
                      <a
                        key={slug}
                        href={`/company/${slug}`}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {slug}
                      </a>
                    ))}
                    {pattern.startups.length > 3 && (
                      <span className="text-[10px] px-1.5 py-0.5 text-muted-foreground/60">
                        +{pattern.startups.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Diff details */}
      {diff && (
        <div className="space-y-3">
          <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
            Changes Since Last Version
          </h3>
          <div className="grid gap-2 md:grid-cols-3">
            {diffData.samples_added?.length > 0 && (
              <div className="p-3 border border-border/20 rounded-lg">
                <div className="flex items-center gap-2 text-xs text-accent-info">
                  <TrendingUp className="w-3 h-3" />
                  {diffData.samples_added.length} companies added
                </div>
              </div>
            )}
            {diffData.samples_removed?.length > 0 && (
              <div className="p-3 border border-border/20 rounded-lg">
                <div className="flex items-center gap-2 text-xs text-destructive">
                  <TrendingDown className="w-3 h-3" />
                  {diffData.samples_removed.length} companies dropped
                </div>
              </div>
            )}
            {diffData.case_studies_count_new !== undefined && (
              <div className="p-3 border border-border/20 rounded-lg">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <BarChart3 className="w-3 h-3" />
                  {diffData.case_studies_count_new} case studies (was {diffData.case_studies_count_old})
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
