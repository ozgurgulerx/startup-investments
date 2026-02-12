'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import type { MoveItem, DeepDiveContent } from '@/lib/api/client';
import { MOVE_TYPE_LABELS } from './types';

interface CaseStudyCardProps {
  rank: number;
  study: DeepDiveContent['case_studies'][number];
  moves: MoveItem[];
  loading: boolean;
}

export function CaseStudyCard({ rank, study, moves, loading }: CaseStudyCardProps) {
  return (
    <div className="border border-border/30 rounded-lg bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border/20">
        <span className="text-xs font-mono text-muted-foreground/50">
          #{rank}
        </span>
        <div className="flex-1 min-w-0">
          <Link
            href={`/company/${study.startup_slug}`}
            className="text-sm font-medium text-foreground hover:text-accent-info transition-colors"
          >
            {study.startup_name}
          </Link>
        </div>
        <Link
          href={`/company/${study.startup_slug}`}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          View Company
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      {/* Body */}
      <div className="p-4 space-y-4">
        {/* Summary */}
        <p className="text-sm text-foreground/90 leading-relaxed">
          {study.summary}
        </p>

        {/* Key moves from synthesis */}
        {study.key_moves && study.key_moves.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
              Key Moves
            </p>
            <ul className="space-y-1.5">
              {study.key_moves.map((move, i) => (
                <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                  <span className="text-accent-info mt-0.5">-</span>
                  {move}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Extracted moves (from LLM pipeline) */}
        {!loading && moves.length > 0 && (
          <div className="space-y-3 pt-2 border-t border-border/20">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
              Extracted Strategic Moves
            </p>
            {moves.slice(0, 5).map((move) => (
              <div key={move.id} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground font-medium">
                    {MOVE_TYPE_LABELS[move.move_type] || move.move_type}
                  </span>
                  <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                    {(move.confidence * 100).toFixed(0)}% conf
                  </span>
                </div>

                <div className="pl-0.5 space-y-1">
                  <p className="text-xs text-foreground/90">
                    {move.what_happened}
                  </p>
                  {move.why_it_worked && (
                    <p className="text-xs text-muted-foreground">
                      {move.why_it_worked}
                    </p>
                  )}
                  {move.unique_angle && (
                    <p className="text-xs text-accent-info/80 italic">
                      {move.unique_angle}
                    </p>
                  )}
                </div>

                {move.evidence_ids.length > 0 && (
                  <p className="text-[10px] text-muted-foreground/40">
                    {move.evidence_ids.length} evidence {move.evidence_ids.length === 1 ? 'item' : 'items'}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {loading && moves.length === 0 && (
          <div className="animate-pulse space-y-2 pt-2 border-t border-border/20">
            <div className="h-3 w-24 bg-muted rounded" />
            <div className="h-4 w-full bg-muted rounded" />
            <div className="h-4 w-3/4 bg-muted rounded" />
          </div>
        )}
      </div>
    </div>
  );
}
