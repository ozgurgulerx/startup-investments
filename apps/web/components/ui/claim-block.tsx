'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { EvidencePopover, type EvidenceSource } from './evidence-popover';

export interface ClaimBlockProps {
  claim: string;
  confidence?: 'high' | 'medium' | 'low';
  sources?: EvidenceSource[];
  className?: string;
}

const confidenceLabels = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

const confidenceStyles = {
  high: 'border-l-foreground/40',
  medium: 'border-l-muted-foreground/40',
  low: 'border-l-muted-foreground/20',
};

export function ClaimBlock({
  claim,
  confidence = 'medium',
  sources = [],
  className,
}: ClaimBlockProps) {
  return (
    <div
      className={cn(
        'border-l-2 pl-4 py-2',
        confidenceStyles[confidence],
        className
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1">
          {sources.length > 0 ? (
            <EvidencePopover sources={sources}>
              <span className="text-sm text-foreground/90 leading-relaxed">
                {claim}
              </span>
            </EvidencePopover>
          ) : (
            <p className="text-sm text-foreground/90 leading-relaxed">{claim}</p>
          )}
        </div>
      </div>
      {confidence && (
        <div className="flex items-center gap-2 mt-2">
          <div
            className={cn(
              'w-1.5 h-1.5 rounded-full',
              confidence === 'high' && 'bg-foreground/60',
              confidence === 'medium' && 'bg-muted-foreground/60',
              confidence === 'low' && 'bg-muted-foreground/30'
            )}
          />
          <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
            {confidenceLabels[confidence]}
          </span>
          {sources.length > 0 && (
            <span className="text-[10px] text-muted-foreground/40">
              ({sources.length} source{sources.length !== 1 ? 's' : ''})
            </span>
          )}
        </div>
      )}
    </div>
  );
}
