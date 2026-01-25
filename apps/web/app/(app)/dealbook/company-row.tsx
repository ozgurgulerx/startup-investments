'use client';

import Link from 'next/link';
import { WatchlistButton } from '@/components/ui/watchlist-button';
import { formatCurrency } from '@/lib/utils';

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
    build_patterns?: Array<{ name: string; confidence: number }>;
  };
}

export function CompanyRow({ startup }: CompanyRowProps) {
  // Get top pattern (max 1)
  const topPattern = startup.build_patterns
    ?.sort((a, b) => b.confidence - a.confidence)[0];

  return (
    <div className="startup-row group relative">
      <Link
        href={`/company/${startup.company_slug}`}
        className="flex-1 min-w-0 block"
      >
        <div className="flex items-baseline gap-3">
          <h3 className="startup-name group-hover:text-accent transition-colors">
            {startup.company_name}
          </h3>
          {topPattern && (
            <span className="text-xs text-muted-foreground/60">
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
            <span>{startup.vertical.replace(/_/g, ' ')}</span>
          )}
          {startup.funding_stage && (
            <span>{startup.funding_stage.replace(/_/g, ' ')}</span>
          )}
        </div>
      </Link>

      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right">
          <span className="startup-amount">
            {formatCurrency(startup.funding_amount || 0, true)}
          </span>
          {startup.uses_genai && (
            <p className="text-xs text-muted-foreground/60 mt-1">
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
