'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import type { BriefEditionSummary } from '@startup-intelligence/shared';

interface BriefEditionSelectorProps {
  editions: BriefEditionSummary[];
  currentPeriodType: string;
  currentEditionId?: string;
  region: string;
}

export function BriefEditionSelector({
  editions,
  currentPeriodType,
  currentEditionId,
  region,
}: BriefEditionSelectorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handlePeriodTypeChange(type: string) {
    const params = new URLSearchParams();
    if (region !== 'global') params.set('region', region);
    params.set('period_type', type);
    router.push(`/brief?${params.toString()}`);
  }

  function handleEditionChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const editionId = e.target.value;
    if (!editionId) return;
    const params = new URLSearchParams();
    if (region !== 'global') params.set('region', region);
    params.set('edition_id', editionId);
    router.push(`/brief?${params.toString()}`);
  }

  const selectedId = currentEditionId || editions[0]?.editionId;

  return (
    <div className="flex items-center gap-4 mb-6">
      {/* Period type tabs */}
      <div className="flex gap-1 bg-muted/20 rounded-md p-0.5">
        {(['monthly', 'weekly'] as const).map((type) => (
          <button
            key={type}
            onClick={() => handlePeriodTypeChange(type)}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors capitalize ${
              currentPeriodType === type
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {type}
          </button>
        ))}
      </div>

      {/* Edition dropdown */}
      {editions.length > 0 && (
        <select
          value={selectedId || ''}
          onChange={handleEditionChange}
          className="bg-transparent border border-border/30 rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent-info"
        >
          {editions.map((ed) => (
            <option key={ed.editionId} value={ed.editionId}>
              {ed.periodLabel}
              {ed.kind === 'sealed' ? '' : ' (Live)'}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
