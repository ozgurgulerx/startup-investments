'use client';

import type { NewsItemCard } from '@startup-intelligence/shared';
import { deltaTypeBadgeClass, getStrategyImplication, getDecisionTags } from '@/lib/strategy-templates';

interface DecisionHeaderProps {
  item: NewsItemCard;
  region?: 'global' | 'turkey';
}

function extractChangeSummary(item: NewsItemCard): string {
  const text = item.llm_summary || item.summary || '';
  // First sentence (up to first period followed by space or end)
  const match = text.match(/^(.+?\.)\s/);
  return match ? match[1] : text.slice(0, 120) + (text.length > 120 ? '...' : '');
}

export function DecisionHeader({ item, region = 'global' }: DecisionHeaderProps) {
  const deltaType = item.delta_type || 'Market Signal';
  const badgeClass = deltaTypeBadgeClass(deltaType);
  const primaryEntity = item.entity_links?.[0]?.entity_name || item.entities?.[0];
  const implication = getStrategyImplication(deltaType, primaryEntity);
  const tags = getDecisionTags(deltaType);
  const changeSummary = extractChangeSummary(item);

  return (
    <div className="mb-2 space-y-1.5">
      {/* Delta type badge */}
      <div className="flex items-center gap-2">
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider font-medium ${badgeClass}`}>
          {deltaType}
        </span>
      </div>

      {/* Change summary */}
      {changeSummary && (
        <p className="text-[11px] text-foreground/80 leading-snug line-clamp-2">
          {changeSummary}
        </p>
      )}

      {/* Strategy implication */}
      <p className="text-[11px] text-accent-info/80 italic leading-snug">
        {implication}
      </p>

      {/* Decision tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-border/30 bg-muted/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/70"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
