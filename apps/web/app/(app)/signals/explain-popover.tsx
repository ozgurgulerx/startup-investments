'use client';

import * as Popover from '@radix-ui/react-popover';
import { Info, X } from 'lucide-react';
import type { SignalExplain } from '@/lib/api/types';

interface ExplainPopoverProps {
  explain: SignalExplain;
  region?: 'global' | 'turkey';
}

export function ExplainPopover({ explain, region = 'global' }: ExplainPopoverProps) {
  const l = region === 'turkey'
    ? {
      trigger: 'Sinyal aciklamasi',
      title: 'Sinyal Aciklamasi',
      whatMeans: 'Ne anlatir',
      whyMatters: 'Neden onemli',
      examples: 'Tipik ornekler',
      whereSeen: 'Nerede gorduk',
      horizon: 'Ufuk',
      risk: 'Risk',
      close: 'Kapat',
    }
    : {
      trigger: 'Signal explanation',
      title: 'Signal Explained',
      whatMeans: 'What this means',
      whyMatters: 'Why it matters',
      examples: 'Typical examples',
      whereSeen: 'Where we saw it',
      horizon: 'Horizon',
      risk: 'Risk',
      close: 'Close',
    };
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          className="p-1 rounded hover:bg-muted/30 transition-colors"
          aria-label={l.trigger}
        >
          <Info className="w-3.5 h-3.5 text-muted-foreground/50 hover:text-muted-foreground" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="right"
          sideOffset={8}
          align="start"
          className="z-50 w-80 max-h-[70vh] overflow-y-auto rounded-lg border border-border/40 bg-background p-4 shadow-xl animate-in fade-in-0 zoom-in-95 data-[side=right]:slide-in-from-left-2"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
              {l.title}
            </span>
            <Popover.Close asChild>
              <button className="p-0.5 rounded hover:bg-muted/30" aria-label={l.close}>
                <X className="w-3.5 h-3.5 text-muted-foreground/40" />
              </button>
            </Popover.Close>
          </div>

          <div className="space-y-3">
            {/* What this means */}
            <div>
              <span className="text-[10px] font-medium text-accent-info uppercase tracking-wider">
                {l.whatMeans}
              </span>
              <p className="text-xs text-foreground/80 mt-1 leading-relaxed">
                {explain.definition}
              </p>
            </div>

            {/* Why it matters */}
            <div>
              <span className="text-[10px] font-medium text-accent-info uppercase tracking-wider">
                {l.whyMatters}
              </span>
              <p className="text-xs text-foreground/80 mt-1 leading-relaxed">
                {explain.why}
              </p>
            </div>

            {/* Typical examples */}
            {explain.examples.length > 0 && (
              <div>
                <span className="text-[10px] font-medium text-accent-info uppercase tracking-wider">
                  {l.examples}
                </span>
                <ul className="mt-1 space-y-0.5">
                  {explain.examples.slice(0, 3).map((ex, i) => (
                    <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                      <span className="text-muted-foreground/40 mt-0.5">&#x2022;</span>
                      {ex}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Where we saw it */}
            {explain.top_evidence.length > 0 && (
              <div>
                <span className="text-[10px] font-medium text-accent-info uppercase tracking-wider">
                  {l.whereSeen}
                </span>
                <div className="mt-1 space-y-1.5">
                  {explain.top_evidence.slice(0, 3).map((ev, i) => (
                    <div key={i} className="text-xs text-muted-foreground">
                      <span className="text-foreground/70 line-clamp-1">
                        &ldquo;{ev.snippet}&rdquo;
                      </span>
                      <span className="text-muted-foreground/50">
                        {' '}&mdash; {ev.source}, {ev.date}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Risk + Time horizon */}
            {(explain.risk || explain.time_horizon) && (
              <div className="pt-2 border-t border-border/20 flex items-center gap-3 text-[10px] text-muted-foreground/60">
                {explain.time_horizon && (
                  <span>{l.horizon}: {explain.time_horizon}</span>
                )}
                {explain.risk && (
                  <span className="line-clamp-1">{l.risk}: {explain.risk}</span>
                )}
              </div>
            )}
          </div>

          <Popover.Arrow className="fill-border/40" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
