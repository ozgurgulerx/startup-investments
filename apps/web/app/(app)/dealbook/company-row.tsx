'use client';

import Link from 'next/link';
import { WatchlistButton } from '@/components/ui/watchlist-button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { ConfidenceBadge } from '@/components/ui/confidence-badge';
import { formatCurrency, formatStageName } from '@/lib/utils';

interface CompanyRowProps {
  startup: {
    company_slug: string;
    company_name: string;
    description?: string;
    location?: string;
    vertical?: string;
    funding_stage?: string;
    funding_amount?: number;
    uses_genai?: boolean;
    confidence_score?: number;
    build_patterns?: Array<{ name: string; confidence: number }>;
  };
}

export function CompanyRow({ startup }: CompanyRowProps) {
  // Get top pattern (max 1)
  const topPattern = startup.build_patterns
    ?.slice()
    .sort((a, b) => b.confidence - a.confidence)[0];

  return (
    <div className="startup-row group relative">
      <CompanyLogo
        slug={startup.company_slug}
        companyName={startup.company_name}
        size="sm"
        variant="muted"
        className="rounded-md"
      />
      <Link
        href={`/company/${startup.company_slug}`}
        className="flex-1 min-w-0 block"
      >
        <div className="flex items-baseline gap-3">
          <h3 className="startup-name group-hover:text-accent transition-colors">
            {startup.company_name}
          </h3>
          {topPattern && (
            <span className="inline-flex items-center rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-accent/90">
              {topPattern.name}
            </span>
          )}
        </div>

        {startup.description && (
          <p className="startup-insight line-clamp-1">
            {startup.description}
          </p>
        )}

        <div className="startup-meta">
          {startup.location && (
            <span>{startup.location}</span>
          )}
          {startup.vertical && (
            <span>{formatStageName(startup.vertical)}</span>
          )}
          {startup.funding_stage && (
            <span>{formatStageName(startup.funding_stage)}</span>
          )}
        </div>
      </Link>

      <div className="flex items-center gap-3 shrink-0">
        {startup.confidence_score != null && (
          <ConfidenceBadge score={startup.confidence_score} size="sm" />
        )}
        <div className="text-right">
          <span className="startup-amount">
            {formatCurrency(startup.funding_amount || 0, true)}
          </span>
          {startup.uses_genai && (
            <p className="text-xs text-accent/90 mt-1">
              GenAI
            </p>
          )}
        </div>
        <WatchlistButton
          companySlug={startup.company_slug}
          companyName={startup.company_name}
          variant="icon"
        />
      </div>
    </div>
  );
}
