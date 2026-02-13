'use client';

import type { NewsItemCard } from '@startup-intelligence/shared';
import { frameLabel, impactDisplayMode } from '@/lib/news-utils';
import type { ViewMode } from './view-toggle';

interface ImpactBoxProps {
  item: NewsItemCard;
  compact?: boolean;
  region?: 'global' | 'turkey';
  viewMode?: ViewMode;
}

const TR_LABELS = {
  build: 'Geliştir:',
  invest: 'Yatırım:',
  watch: 'Dikkat:',
  verify: 'Doğrula:',
  header: 'Neden Önemli',
} as const;

const EN_LABELS = {
  build: 'Build:',
  invest: 'Invest:',
  watch: 'Watch:',
  verify: 'Verify:',
  header: 'Why It Matters',
} as const;

export function ImpactBox({ item, compact, region = 'global', viewMode }: ImpactBoxProps) {
  const l = region === 'turkey' ? TR_LABELS : EN_LABELS;
  const hasBuilderOrigin = typeof item.builder_takeaway_is_llm === 'boolean';
  const builderOriginLabel = item.builder_takeaway_is_llm ? 'LLM' : 'AUTO';

  // Structured impact rendering
  if (item.impact) {
    const { frame, kicker, builder_move, investor_angle, watchout, validation } = item.impact;
    // Override display mode when viewMode is set
    const baseMode = impactDisplayMode(item.impact, item.llm_confidence_score);
    const mode = viewMode === 'investor' ? 'compact'
      : viewMode === 'builder' ? 'full'
      : baseMode;
    const header = frameLabel(frame, region);

    return (
      <div className={`group/brief rounded-md border border-accent-info/25 bg-accent-info/10 px-2.5 py-2 transition-all duration-200 ${compact ? 'mt-2' : 'mt-3'}`}>
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <p className="text-[10px] uppercase tracking-wider text-accent-info font-medium">{header}</p>
            {kicker && (
              <span className="text-[10px] text-accent-info/70 truncate max-w-[180px]">{kicker}</span>
            )}
          </div>
          {hasBuilderOrigin && !compact ? (
            <span className="inline-flex items-center rounded-full border border-accent-info/25 bg-accent-info/10 px-2 py-0.5 text-[9px] uppercase tracking-wider text-accent-info">
              {builderOriginLabel}
            </span>
          ) : null}
        </div>

        {mode === 'full' && (
          <div className={`space-y-1 ${compact ? 'text-[11px]' : 'text-xs'} leading-relaxed text-foreground/90`}>
            {builder_move && (
              <p><span className="text-accent-info/80 font-medium">{l.build}</span> {builder_move}</p>
            )}
            {investor_angle && (
              <p><span className="text-accent-info/80 font-medium">{l.invest}</span> {investor_angle}</p>
            )}
            {watchout && (
              <p className={compact && viewMode !== 'builder' ? 'hidden group-hover/brief:block' : ''}><span className="text-accent-info/80 font-medium">{l.watch}</span> {watchout}</p>
            )}
            {validation && (
              <p className={compact && viewMode !== 'builder' ? 'hidden group-hover/brief:block' : ''}><span className="text-accent-info/80 font-medium">{l.verify}</span> {validation}</p>
            )}
          </div>
        )}

        {mode === 'compact' && (
          <div className={`${compact ? 'text-[11px]' : 'text-xs'} leading-relaxed text-foreground/90`}>
            {investor_angle && <p>{investor_angle}</p>}
          </div>
        )}

        {mode === 'early_signal' && (
          <div className={`space-y-1 ${compact ? 'text-[11px]' : 'text-xs'} leading-relaxed text-foreground/90`}>
            {validation && (
              <p><span className="text-accent-info/80 font-medium">{l.verify}</span> {validation}</p>
            )}
            {builder_move && (
              <p><span className="text-accent-info/80 font-medium">{l.build}</span> {builder_move}</p>
            )}
          </div>
        )}
      </div>
    );
  }

  // Legacy fallback: plain builder_takeaway text
  if (!item.builder_takeaway) return null;

  return (
    <div className={`group/brief rounded-md border border-accent-info/25 bg-accent-info/10 px-2.5 py-2 transition-all duration-200 ${compact ? 'mt-2' : 'mt-3'}`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-[10px] uppercase tracking-wider text-accent-info">{l.header}</p>
        {hasBuilderOrigin && !compact ? (
          <span className="inline-flex items-center rounded-full border border-accent-info/25 bg-accent-info/10 px-2 py-0.5 text-[9px] uppercase tracking-wider text-accent-info">
            {builderOriginLabel}
          </span>
        ) : null}
      </div>
      <p className={`${compact ? 'text-[11px]' : 'text-xs'} leading-relaxed text-foreground/90 line-clamp-3 group-hover/brief:line-clamp-none`}>
        {item.builder_takeaway}
      </p>
    </div>
  );
}
