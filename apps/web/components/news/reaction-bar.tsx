'use client';

import { useCallback } from 'react';
import { ThumbsUp, Bookmark, EyeOff, ThumbsDown } from 'lucide-react';
import type { SignalActionType } from '@startup-intelligence/shared';
import { useSignalsOptional } from './signals-provider';

interface ReactionBarProps {
  clusterId: string;
  compact?: boolean;
  onHide?: (clusterId: string) => void;
}

export function ReactionBar({ clusterId, compact, onHide }: ReactionBarProps) {
  const signals = useSignalsOptional();
  const handleClick = useCallback(
    (e: React.MouseEvent, action: SignalActionType) => {
      e.stopPropagation();
      e.preventDefault();
      if (!signals) return;
      signals.toggle(clusterId, action).then((result) => {
        if (action === 'hide' && result.active && onHide) {
          onHide(clusterId);
        }
      });
    },
    [clusterId, signals, onHide]
  );

  if (!signals) return null;

  const actions = signals.getActions(clusterId);
  const upvoteCount = signals.getUpvoteCount(clusterId);

  const iconSize = compact ? 'h-3 w-3' : 'h-3.5 w-3.5';
  const btnBase = `inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-info/60 ${
    compact ? 'text-[9px]' : 'text-[10px]'
  }`;

  return (
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {/* Upvote */}
      <button
        type="button"
        onClick={(e) => handleClick(e, 'upvote')}
        title="Useful"
        className={`${btnBase} ${
          actions.includes('upvote')
            ? 'border-accent-info/40 bg-accent-info/15 text-accent-info'
            : 'border-border/30 bg-transparent text-muted-foreground hover:border-accent-info/30 hover:text-accent-info'
        }`}
      >
        <ThumbsUp className={iconSize} />
        {upvoteCount > 0 && (
          <span className="tabular-nums">{upvoteCount}</span>
        )}
      </button>

      {/* Save */}
      <button
        type="button"
        onClick={(e) => handleClick(e, 'save')}
        title="Save"
        className={`${btnBase} ${
          actions.includes('save')
            ? 'border-accent/40 bg-accent/15 text-accent'
            : 'border-border/30 bg-transparent text-muted-foreground hover:border-accent/30 hover:text-accent'
        }`}
      >
        <Bookmark className={iconSize} />
      </button>

      {/* Hide */}
      <button
        type="button"
        onClick={(e) => handleClick(e, 'hide')}
        title="Hide"
        className={`${btnBase} ${
          actions.includes('hide')
            ? 'border-warning/40 bg-warning/15 text-warning'
            : 'border-border/30 bg-transparent text-muted-foreground hover:border-warning/30 hover:text-warning'
        }`}
      >
        <EyeOff className={iconSize} />
      </button>

      {/* Not useful */}
      <button
        type="button"
        onClick={(e) => handleClick(e, 'not_useful')}
        title="Not useful"
        className={`${btnBase} ${
          actions.includes('not_useful')
            ? 'border-delta/40 bg-delta/15 text-delta'
            : 'border-border/30 bg-transparent text-muted-foreground hover:border-delta/30 hover:text-delta'
        }`}
      >
        <ThumbsDown className={iconSize} />
      </button>
    </div>
  );
}
