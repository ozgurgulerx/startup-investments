'use client';

import { WatchlistButton } from '@/components/ui/watchlist-button';

interface CompanyActionsProps {
  companySlug: string;
  companyName: string;
}

export function CompanyActions({ companySlug, companyName }: CompanyActionsProps) {
  return (
    <div className="flex items-center gap-2">
      <WatchlistButton
        companySlug={companySlug}
        companyName={companyName}
        variant="button"
      />
    </div>
  );
}
