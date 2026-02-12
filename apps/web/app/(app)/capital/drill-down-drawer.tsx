'use client';

import { Sheet, SheetHeader, SheetContent } from '@/components/ui/sheet';
import { formatCurrency } from '@/lib/utils';
import Link from 'next/link';
import type { StartupAnalysis } from '@startup-intelligence/shared';
import { ArrowRight } from 'lucide-react';

export type DrillDownFilter =
  | { type: 'stage'; value: string }
  | { type: 'pattern'; value: string }
  | { type: 'geo'; value: string }
  | { type: 'vertical'; value: string }
  | { type: 'period'; value: string }
  | null;

interface DrillDownDrawerProps {
  filter: DrillDownFilter;
  startups: StartupAnalysis[];
  onClose: () => void;
  region?: string;
  currentPeriod?: string;
}

function filterStartups(startups: StartupAnalysis[], filter: NonNullable<DrillDownFilter>) {
  switch (filter.type) {
    case 'stage': {
      const stage = filter.value.toLowerCase().replace(/ /g, '_');
      return startups.filter(
        (s) => (s.funding_stage || '').toLowerCase().replace(/ /g, '_') === stage
      );
    }
    case 'pattern':
      return startups.filter((s) =>
        s.build_patterns?.some((p) => p.name === filter.value)
      );
    case 'geo':
      return startups.filter((s) =>
        (s.location || '').toLowerCase().includes(filter.value.toLowerCase())
      );
    case 'vertical':
      return startups.filter(
        (s) => (s.vertical || '').toLowerCase() === filter.value.toLowerCase()
      );
    case 'period':
      // All startups are already from the period — show them all
      return startups;
    default:
      return startups;
  }
}

function formatLabel(filter: NonNullable<DrillDownFilter>) {
  const { type, value } = filter;
  const pretty = value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());
  return `${type.charAt(0).toUpperCase() + type.slice(1)}: ${pretty}`;
}

export function DrillDownDrawer({
  filter,
  startups,
  onClose,
  region,
  currentPeriod,
}: DrillDownDrawerProps) {
  if (!filter) return null;

  const filtered = filterStartups(startups, filter)
    .sort((a, b) => (b.funding_amount || 0) - (a.funding_amount || 0));

  const totalFunding = filtered.reduce((s, c) => s + (c.funding_amount || 0), 0);

  // Top investors in this slice
  const investorCounts = new Map<string, number>();
  for (const s of filtered) {
    const investors = (s as any).lead_investors || (s as any).investors;
    if (Array.isArray(investors)) {
      for (const inv of investors) {
        const name = typeof inv === 'string' ? inv : inv?.name;
        if (name) investorCounts.set(name, (investorCounts.get(name) || 0) + 1);
      }
    }
  }
  const topInvestors = [...investorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Build dealbook link
  const dealbookParams = new URLSearchParams();
  if (currentPeriod) dealbookParams.set('month', currentPeriod);
  if (region && region !== 'global') dealbookParams.set('region', region);
  if (filter.type === 'stage') dealbookParams.set('stage', filter.value);
  if (filter.type === 'pattern') dealbookParams.set('pattern', filter.value);
  if (filter.type === 'geo') dealbookParams.set('continent', filter.value);
  const dealbookHref = `/dealbook${dealbookParams.toString() ? '?' + dealbookParams.toString() : ''}`;

  return (
    <Sheet open={!!filter} onOpenChange={() => onClose()} side="right" className="w-[360px] max-w-[90vw]">
      <SheetHeader onClose={onClose}>
        <span className="text-sm">{formatLabel(filter)}</span>
      </SheetHeader>
      <SheetContent>
        <div className="space-y-4">
          {/* Summary */}
          <div className="text-sm text-muted-foreground">
            {filtered.length} deal{filtered.length !== 1 ? 's' : ''} ·{' '}
            {formatCurrency(totalFunding, true)} total
            {filtered.length > 0 && (
              <> · Avg {formatCurrency(totalFunding / filtered.length, true)}</>
            )}
          </div>

          {/* Deal list */}
          <div className="space-y-2">
            {filtered.slice(0, 25).map((s) => (
              <Link
                key={s.company_slug}
                href={`/company/${s.company_slug}`}
                className="block p-2.5 rounded-lg border border-border/30 bg-card hover:border-border/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{s.company_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.funding_stage?.replace(/_/g, ' ')}
                      {s.vertical && ` · ${s.vertical.replace(/_/g, ' ')}`}
                    </p>
                  </div>
                  {s.funding_amount && (
                    <span className="text-sm font-medium tabular-nums text-accent-info flex-shrink-0">
                      {formatCurrency(s.funding_amount, true)}
                    </span>
                  )}
                </div>
              </Link>
            ))}
            {filtered.length > 25 && (
              <p className="text-xs text-muted-foreground text-center pt-1">
                +{filtered.length - 25} more
              </p>
            )}
          </div>

          {/* Top investors */}
          {topInvestors.length > 0 && (
            <div className="pt-3 border-t border-border/30">
              <p className="text-xs text-muted-foreground mb-2">Top Investors in this slice</p>
              <div className="flex flex-wrap gap-1.5">
                {topInvestors.map(([name, count]) => (
                  <span
                    key={name}
                    className="text-xs px-2 py-1 rounded-full bg-muted/30 border border-border/30"
                  >
                    {name} ({count})
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Dealbook link */}
          <Link
            href={dealbookHref}
            className="flex items-center gap-2 text-sm text-accent-info hover:underline pt-2"
          >
            Open in Dealbook
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
